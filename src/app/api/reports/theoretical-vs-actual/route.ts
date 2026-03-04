import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const range = dateRangeToUTC(startDate || defaultStart, endDate || defaultEnd, timezone)
    const dateFilter = { gte: range.start, lte: range.end }

    // 1. Get sold quantities by menuItemId — push aggregation to SQL to avoid loading
    //    all order items into memory (large date ranges can be 10k+ rows).
    const salesByMenuItem = await db.orderItem.groupBy({
      by: ['menuItemId'],
      where: {
        order: {
          locationId,
          status: { in: ['paid', 'closed'] },
          paidAt: dateFilter,
        },
        status: 'active',
      },
      _sum: { quantity: true },
    })

    // Build soldByItem map from the aggregated result
    const soldByItem = new Map<string, number>()
    for (const row of salesByMenuItem) {
      soldByItem.set(row.menuItemId, row._sum.quantity ?? 0)
    }

    // 2. Get recipes for all sold items
    const recipes = await db.menuItemRecipe.findMany({
      where: {
        locationId,
        menuItemId: { in: Array.from(soldByItem.keys()) },
        deletedAt: null,
      },
      include: {
        ingredients: {
          where: { deletedAt: null },
          include: {
            inventoryItem: {
              select: { id: true, name: true, costPerUnit: true, storageUnit: true },
            },
          },
        },
      },
    })

    // 3. Calculate theoretical usage per ingredient
    const theoreticalByIngredient = new Map<string, {
      inventoryItemId: string, name: string, unit: string,
      theoreticalQty: number, theoreticalCost: number, costPerUnit: number
    }>()

    let totalTheoreticalCost = 0

    for (const recipe of recipes) {
      const qtySold = soldByItem.get(recipe.menuItemId) || 0
      if (qtySold === 0) continue

      for (const ing of recipe.ingredients) {
        if (!ing.inventoryItem) continue

        const ingQty = Number(ing.quantity) * qtySold
        const costPerUnit = Number(ing.inventoryItem.costPerUnit)
        const ingCost = ingQty * costPerUnit

        totalTheoreticalCost += ingCost

        if (theoreticalByIngredient.has(ing.inventoryItem.id)) {
          const existing = theoreticalByIngredient.get(ing.inventoryItem.id)!
          existing.theoreticalQty += ingQty
          existing.theoreticalCost += ingCost
        } else {
          theoreticalByIngredient.set(ing.inventoryItem.id, {
            inventoryItemId: ing.inventoryItem.id,
            name: ing.inventoryItem.name,
            unit: ing.inventoryItem.storageUnit,
            theoreticalQty: ingQty,
            theoreticalCost: ingCost,
            costPerUnit,
          })
        }
      }
    }

    // 4. Get actual inventory depletion from InventoryItemTransaction (type='sale').
    //    These are created by liquor-inventory.ts (inventoryItemTransaction.create)
    //    and inventory/order-deduction.ts when items are paid. They are keyed on
    //    inventoryItemId, which is what we need to join against the theoretical side.
    const inventoryItemIds = Array.from(theoreticalByIngredient.keys())

    const actualTransactions = await db.inventoryItemTransaction.findMany({
      where: {
        locationId,
        type: 'sale',
        inventoryItemId: { in: inventoryItemIds },
        createdAt: dateFilter,
        deletedAt: null,
      },
      select: {
        inventoryItemId: true,
        quantityChange: true,
        totalCost: true,
      },
    })

    // Aggregate actual depletion by inventoryItemId
    const actualByIngredient = new Map<string, { qty: number; cost: number }>()
    for (const txn of actualTransactions) {
      const existing = actualByIngredient.get(txn.inventoryItemId) ?? { qty: 0, cost: 0 }
      // quantityChange is negative for deductions — negate to get positive depleted qty
      existing.qty += Math.abs(Number(txn.quantityChange))
      existing.cost += Math.abs(Number(txn.totalCost ?? 0))
      actualByIngredient.set(txn.inventoryItemId, existing)
    }

    const hasActualData = actualTransactions.length > 0
    const totalActualDepletion = Array.from(actualByIngredient.values()).reduce(
      (sum, a) => sum + a.cost,
      0
    )

    // 5. Get waste logs for the period
    const wasteLogs = await db.wasteLog.findMany({
      where: {
        locationId,
        businessDate: dateFilter,
        inventoryItemId: { not: null },
      },
      select: {
        inventoryItemId: true,
        quantity: true,
        cost: true,
      },
    })

    let totalWaste = 0
    const wasteByIngredient = new Map<string, number>()
    for (const wl of wasteLogs) {
      const cost = Number(wl.cost)
      totalWaste += cost
      if (wl.inventoryItemId) {
        wasteByIngredient.set(
          wl.inventoryItemId,
          (wasteByIngredient.get(wl.inventoryItemId) || 0) + cost
        )
      }
    }

    // 6. Build per-ingredient comparison
    const byIngredient = Array.from(theoreticalByIngredient.values()).map(ing => {
      const actual = actualByIngredient.get(ing.inventoryItemId) ?? { qty: 0, cost: 0 }
      const actualQty = actual.qty
      const actualCost = actual.cost
      const variance = actualCost - ing.theoreticalCost
      const variancePct = ing.theoreticalCost > 0 ? (variance / ing.theoreticalCost) * 100 : 0

      return {
        inventoryItemId: ing.inventoryItemId,
        name: ing.name,
        unit: ing.unit,
        theoreticalQty: ing.theoreticalQty,
        actualQty,
        variance: actualQty - ing.theoreticalQty,
        variancePct,
        theoreticalCost: ing.theoreticalCost,
        actualCost,
        costVariance: actualCost - ing.theoreticalCost,
      }
    }).sort((a, b) => Math.abs(b.costVariance) - Math.abs(a.costVariance))

    const totalVariance = totalActualDepletion - totalTheoreticalCost
    const variancePct = totalTheoreticalCost > 0 ? (totalVariance / totalTheoreticalCost) * 100 : 0
    const unexplainedVariance = totalVariance - totalWaste

    return NextResponse.json({
      data: {
        summary: {
          theoreticalCost: totalTheoreticalCost,
          actualInventoryDepletion: totalActualDepletion,
          variance: totalVariance,
          variancePct,
          wasteLogged: totalWaste,
          unexplainedVariance,
          hasActualData,
          note: !hasActualData
            ? 'Inventory tracking not yet active. Showing theoretical costs only.'
            : undefined,
        },
        byIngredient,
        dateRange: { start: range.start, end: range.end },
      },
    })
  } catch (error) {
    console.error('Failed to generate theoretical vs actual report:', error)
    return NextResponse.json({ error: 'Failed to generate theoretical vs actual report' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/reports/liquor
 * Comprehensive liquor/spirit reports including:
 * - Spirit sales by tier
 * - Spirit sales by category
 * - Bottle usage and pour tracking
 * - Pour cost analysis
 * - Upsell performance
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Build date filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // 1. Get spirit sales by tier from OrderItemModifier
    const orderItemsWithSpirits = await db.orderItemModifier.findMany({
      where: {
        spiritTier: { not: null },
        orderItem: {
          order: {
            locationId,
            status: { in: ['paid', 'completed'] },
            ...dateFilter,
          },
        },
      },
      include: {
        orderItem: {
          include: {
            order: {
              select: {
                id: true,
                orderNumber: true,
                employeeId: true,
                createdAt: true,
              },
            },
          },
        },
      },
    })

    // Aggregate by tier
    const tierSales: Record<string, { tier: string; count: number; revenue: number; orders: Set<string> }> = {}
    const TIER_ORDER = ['well', 'call', 'premium', 'top_shelf']

    for (const mod of orderItemsWithSpirits) {
      const tier = mod.spiritTier || 'well'
      if (!tierSales[tier]) {
        tierSales[tier] = { tier, count: 0, revenue: 0, orders: new Set() }
      }
      tierSales[tier].count += 1
      tierSales[tier].revenue += Number(mod.price)
      tierSales[tier].orders.add(mod.orderItem.order.id)
    }

    const byTier = TIER_ORDER
      .filter(tier => tierSales[tier])
      .map(tier => ({
        tier,
        label: tier.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        count: tierSales[tier].count,
        revenue: Math.round(tierSales[tier].revenue * 100) / 100,
        orderCount: tierSales[tier].orders.size,
      }))

    // 2. Get bottle usage from InventoryTransaction
    const inventoryTransactions = await db.inventoryTransaction.findMany({
      where: {
        locationId,
        type: 'sale',
        ...dateFilter,
      },
    })

    // Get bottle products for additional info
    const bottleIds = [...new Set(inventoryTransactions.map(t => t.menuItemId))]
    const bottles = await db.bottleProduct.findMany({
      where: { id: { in: bottleIds } },
      include: {
        spiritCategory: {
          select: { id: true, name: true },
        },
      },
    })
    const bottleMap = new Map(bottles.map(b => [b.id, b]))

    // Aggregate bottle usage
    const bottleUsage: Record<string, {
      bottleId: string
      name: string
      tier: string
      category: string
      totalPours: number
      totalCost: number
    }> = {}

    for (const txn of inventoryTransactions) {
      const bottle = bottleMap.get(txn.menuItemId)
      if (!bottle) continue

      if (!bottleUsage[txn.menuItemId]) {
        bottleUsage[txn.menuItemId] = {
          bottleId: txn.menuItemId,
          name: bottle.name,
          tier: bottle.tier,
          category: bottle.spiritCategory.name,
          totalPours: 0,
          totalCost: 0,
        }
      }
      // quantityChange is stored as negative for sales, convert pours from hundredths
      const pours = Math.abs(txn.quantityChange) / 100
      bottleUsage[txn.menuItemId].totalPours += pours
      bottleUsage[txn.menuItemId].totalCost += txn.totalCost ? Number(txn.totalCost) : 0
    }

    const byBottle = Object.values(bottleUsage)
      .map(b => ({
        ...b,
        totalPours: Math.round(b.totalPours * 100) / 100,
        totalCost: Math.round(b.totalCost * 100) / 100,
      }))
      .sort((a, b) => b.totalPours - a.totalPours)

    // 3. Aggregate by spirit category
    const categorySales: Record<string, {
      categoryId: string
      categoryName: string
      totalPours: number
      totalCost: number
      totalRevenue: number
    }> = {}

    for (const bottle of byBottle) {
      const catName = bottle.category
      if (!categorySales[catName]) {
        categorySales[catName] = {
          categoryId: catName,
          categoryName: catName,
          totalPours: 0,
          totalCost: 0,
          totalRevenue: 0,
        }
      }
      categorySales[catName].totalPours += bottle.totalPours
      categorySales[catName].totalCost += bottle.totalCost
    }

    // Add revenue from order modifiers by category
    for (const mod of orderItemsWithSpirits) {
      if (mod.linkedBottleProductId) {
        const bottle = bottleMap.get(mod.linkedBottleProductId)
        if (bottle) {
          const catName = bottle.spiritCategory.name
          if (categorySales[catName]) {
            categorySales[catName].totalRevenue += Number(mod.price)
          }
        }
      }
    }

    const byCategory = Object.values(categorySales)
      .map(c => ({
        ...c,
        totalPours: Math.round(c.totalPours * 100) / 100,
        totalCost: Math.round(c.totalCost * 100) / 100,
        totalRevenue: Math.round(c.totalRevenue * 100) / 100,
        margin: c.totalRevenue > 0
          ? Math.round(((c.totalRevenue - c.totalCost) / c.totalRevenue) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)

    // 4. Get upsell performance from SpiritUpsellEvent
    const upsellEvents = await db.spiritUpsellEvent.findMany({
      where: {
        locationId,
        ...dateFilter,
      },
    })

    const totalUpsellsShown = upsellEvents.filter(e => e.wasShown).length
    const totalUpsellsAccepted = upsellEvents.filter(e => e.wasAccepted).length
    const upsellRevenue = upsellEvents
      .filter(e => e.wasAccepted)
      .reduce((sum, e) => sum + Number(e.priceDifference), 0)

    // Upsell by tier
    const upsellByTier: Record<string, { tier: string; shown: number; accepted: number; revenue: number }> = {}
    for (const event of upsellEvents) {
      const tier = event.upsellTier
      if (!upsellByTier[tier]) {
        upsellByTier[tier] = { tier, shown: 0, accepted: 0, revenue: 0 }
      }
      if (event.wasShown) upsellByTier[tier].shown += 1
      if (event.wasAccepted) {
        upsellByTier[tier].accepted += 1
        upsellByTier[tier].revenue += Number(event.priceDifference)
      }
    }

    // Upsell by employee
    const upsellByEmployee: Record<string, { employeeId: string; shown: number; accepted: number; revenue: number }> = {}
    for (const event of upsellEvents) {
      const empId = event.employeeId
      if (!upsellByEmployee[empId]) {
        upsellByEmployee[empId] = { employeeId: empId, shown: 0, accepted: 0, revenue: 0 }
      }
      if (event.wasShown) upsellByEmployee[empId].shown += 1
      if (event.wasAccepted) {
        upsellByEmployee[empId].accepted += 1
        upsellByEmployee[empId].revenue += Number(event.priceDifference)
      }
    }

    // Get employee names
    const employeeIds = Object.keys(upsellByEmployee)
    const employees = await db.employee.findMany({
      where: { id: { in: employeeIds } },
      select: { id: true, displayName: true, firstName: true, lastName: true },
    })
    const employeeNameMap = new Map(
      employees.map(e => [e.id, e.displayName || `${e.firstName} ${e.lastName}`])
    )

    // 5. Pour cost analysis - get cocktails with recipes
    const cocktailsWithRecipes = await db.menuItem.findMany({
      where: {
        locationId,
        category: { categoryType: 'liquor' },
        recipeIngredients: { some: {} },
      },
      include: {
        recipeIngredients: {
          include: {
            bottleProduct: true,
          },
        },
      },
    })

    const pourCostAnalysis = cocktailsWithRecipes.map(cocktail => {
      const totalPourCost = cocktail.recipeIngredients.reduce((sum, ing) => {
        const pourCost = ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : 0
        return sum + (pourCost * Number(ing.pourCount))
      }, 0)

      const sellPrice = Number(cocktail.price)
      const margin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

      return {
        menuItemId: cocktail.id,
        name: cocktail.name,
        sellPrice: Math.round(sellPrice * 100) / 100,
        pourCost: Math.round(totalPourCost * 100) / 100,
        margin: Math.round(margin * 10) / 10,
        ingredientCount: cocktail.recipeIngredients.length,
      }
    }).sort((a, b) => a.margin - b.margin) // Sort by lowest margin first (potential issues)

    // 6. Calculate summary totals
    const totalPours = byBottle.reduce((sum, b) => sum + b.totalPours, 0)
    const totalPourCost = byBottle.reduce((sum, b) => sum + b.totalCost, 0)
    const totalSpiritRevenue = orderItemsWithSpirits.reduce((sum, m) => sum + Number(m.price), 0)

    return NextResponse.json({
      summary: {
        totalPours: Math.round(totalPours * 100) / 100,
        totalPourCost: Math.round(totalPourCost * 100) / 100,
        totalSpiritRevenue: Math.round(totalSpiritRevenue * 100) / 100,
        grossMargin: totalSpiritRevenue > 0
          ? Math.round(((totalSpiritRevenue - totalPourCost) / totalSpiritRevenue) * 1000) / 10
          : 0,
        uniqueBottlesUsed: byBottle.length,
        spiritSelectionCount: orderItemsWithSpirits.length,
      },
      byTier,
      byCategory,
      byBottle: byBottle.slice(0, 50), // Top 50 bottles
      pourCostAnalysis: pourCostAnalysis.slice(0, 30), // Top 30 cocktails
      upsells: {
        summary: {
          totalShown: totalUpsellsShown,
          totalAccepted: totalUpsellsAccepted,
          acceptanceRate: totalUpsellsShown > 0
            ? Math.round((totalUpsellsAccepted / totalUpsellsShown) * 1000) / 10
            : 0,
          totalRevenue: Math.round(upsellRevenue * 100) / 100,
        },
        byTier: Object.values(upsellByTier).map(t => ({
          ...t,
          revenue: Math.round(t.revenue * 100) / 100,
          acceptanceRate: t.shown > 0 ? Math.round((t.accepted / t.shown) * 1000) / 10 : 0,
        })),
        byEmployee: Object.values(upsellByEmployee)
          .map(e => ({
            ...e,
            employeeName: employeeNameMap.get(e.employeeId) || 'Unknown',
            revenue: Math.round(e.revenue * 100) / 100,
            acceptanceRate: e.shown > 0 ? Math.round((e.accepted / e.shown) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue),
      },
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
      },
    })
  } catch (error) {
    console.error('Failed to generate liquor report:', error)
    return NextResponse.json(
      { error: 'Failed to generate liquor report' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { InventoryCountStatus } from '@prisma/client'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateTheoreticalUsage, toNumber } from '@/lib/inventory-calculations'
import { varianceQuerySchema, validateRequest } from '@/lib/validations'
import { withVenue } from '@/lib/with-venue'

interface VarianceItem {
  inventoryItemId: string
  name: string
  sku: string | null
  category: string
  unit: string
  beginningStock: number
  purchases: number
  theoreticalUsage: number
  theoreticalEnding: number
  actualEnding: number
  variance: number
  variancePercent: number
  varianceCost: number
  costPerUnit: number
}

// GET - Calculate actual vs theoretical variance
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse and validate query parameters
    const queryParams = {
      locationId: searchParams.get('locationId'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      department: searchParams.get('department') || undefined,
      category: searchParams.get('category') || undefined,
    }

    const validation = validateRequest(varianceQuerySchema, queryParams)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { locationId, startDate, endDate, department, category } = validation.data

    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Parse dates
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    // Build inventory items filter
    const itemWhere: Record<string, unknown> = {
      locationId,
      trackInventory: true,
      isActive: true,
      deletedAt: null,
    }
    if (department) itemWhere.department = department
    if (category) itemWhere.category = category

    // Run queries in parallel for better performance
    const [items, theoreticalResult] = await Promise.all([
      db.inventoryItem.findMany({
        where: itemWhere,
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          storageUnit: true,
          costPerUnit: true,
          currentStock: true,
        },
      }),
      calculateTheoreticalUsage({
        locationId,
        startDate: start,
        endDate: end,
        department,
      }),
    ])

    // Build theoretical usage map
    const theoreticalMap = new Map<string, number>()
    for (const item of theoreticalResult.usage) {
      theoreticalMap.set(item.inventoryItemId, item.theoreticalUsage)
    }

    // Get transactions for the period
    const transactions = await db.inventoryItemTransaction.findMany({
      where: {
        inventoryItemId: { in: items.map(i => i.id) },
        createdAt: { gte: start, lte: end },
      },
    })

    // Get inventory counts to determine beginning/ending stock
    const [startCounts, endCounts] = await Promise.all([
      db.inventoryCount.findMany({
        where: {
          locationId,
          status: InventoryCountStatus.reviewed,
          countDate: { lt: start },
        },
        orderBy: { countDate: 'desc' },
        include: {
          items: true,
        },
      }),
      db.inventoryCount.findMany({
        where: {
          locationId,
          status: InventoryCountStatus.reviewed,
          countDate: { gte: start, lte: end },
        },
        orderBy: { countDate: 'desc' },
        include: {
          items: true,
        },
      }),
    ])

    // Build variance report
    const varianceItems: VarianceItem[] = []

    for (const item of items) {
      const itemTransactions = transactions.filter(t => t.inventoryItemId === item.id)

      // Calculate purchases (receives) - using 'type' field from schema
      const purchases = itemTransactions
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + toNumber(t.quantityChange), 0)

      // Get beginning stock from most recent count before period, or calculate back
      let beginningStock = 0
      const startCountItems = startCounts.flatMap(c => c.items)
      const startCount = startCountItems.find(ci => ci.inventoryItemId === item.id)

      if (startCount && startCount.countedQty !== undefined) {
        beginningStock = toNumber(startCount.countedQty)
      } else {
        // Estimate from current stock - all transaction changes
        const allChanges = itemTransactions.reduce((sum, t) => sum + toNumber(t.quantityChange), 0)
        beginningStock = toNumber(item.currentStock) - allChanges
      }

      // Get actual ending stock
      let actualEnding = toNumber(item.currentStock)
      const endCountItems = endCounts.flatMap(c => c.items)
      const endCount = endCountItems.find(ci => ci.inventoryItemId === item.id)

      if (endCount && endCount.countedQty !== undefined) {
        actualEnding = toNumber(endCount.countedQty)
      }

      // Get theoretical usage
      const theoreticalUsage = theoreticalMap.get(item.id) || 0

      // Calculate theoretical ending
      const theoreticalEnding = beginningStock + purchases - theoreticalUsage

      // Calculate variance (positive = over, negative = under/shrinkage)
      const variance = actualEnding - theoreticalEnding
      const variancePercent = theoreticalUsage > 0 ? (variance / theoreticalUsage) * 100 : 0
      const costPerUnit = toNumber(item.costPerUnit)
      const varianceCost = variance * costPerUnit

      varianceItems.push({
        inventoryItemId: item.id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        unit: item.storageUnit,
        beginningStock,
        purchases,
        theoreticalUsage,
        theoreticalEnding,
        actualEnding,
        variance,
        variancePercent,
        varianceCost,
        costPerUnit,
      })
    }

    // Sort by variance cost (worst first - highest absolute value)
    varianceItems.sort((a, b) => Math.abs(b.varianceCost) - Math.abs(a.varianceCost))

    // Calculate summary totals
    const totalTheoreticalCost = varianceItems.reduce(
      (sum, item) => sum + (item.theoreticalUsage * item.costPerUnit), 0
    )
    const totalVarianceCost = varianceItems.reduce(
      (sum, item) => sum + item.varianceCost, 0
    )
    const overallVariancePercent = totalTheoreticalCost > 0
      ? (totalVarianceCost / totalTheoreticalCost) * 100
      : 0

    return NextResponse.json({ data: {
      report: {
        locationId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        department: department || 'All',
        category: category || 'All',
        items: varianceItems,
        summary: {
          totalItems: varianceItems.length,
          totalTheoreticalCost,
          totalVarianceCost,
          overallVariancePercent,
          itemsWithVariance: varianceItems.filter(i => i.variance !== 0).length,
          itemsOverTheoretical: varianceItems.filter(i => i.variance > 0).length,
          itemsUnderTheoretical: varianceItems.filter(i => i.variance < 0).length,
        },
      },
    } })
  } catch (error) {
    console.error('Variance report error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
})

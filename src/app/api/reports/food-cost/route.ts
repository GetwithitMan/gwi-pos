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
    const groupBy = searchParams.get('groupBy') || 'category'
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

    // Default to current month
    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const range = dateRangeToUTC(startDate || defaultStart, endDate || defaultEnd, timezone)
    const dateFilter = { gte: range.start, lte: range.end }

    // Get all active order items in the date range
    const orderItems = await db.orderItem.findMany({
      where: {
        order: {
          locationId,
          status: { in: ['paid', 'closed'] },
          paidAt: dateFilter,
        },
        status: 'active',
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            cost: true,
            categoryId: true,
            category: { select: { id: true, name: true, categoryType: true } },
            recipe: { select: { totalCost: true } },
          },
        },
      },
    })

    // Build aggregations
    let totalRevenue = 0
    let totalCost = 0
    let itemsWithCost = 0
    let itemsWithoutCost = 0
    let revenueWithCost = 0

    const categoryMap = new Map<string, {
      categoryId: string, categoryName: string, categoryType: string,
      revenue: number, cost: number, itemCount: number
    }>()

    const itemMap = new Map<string, {
      menuItemId: string, menuItemName: string, categoryName: string,
      qtySold: number, revenue: number, unitPrice: number, unitCost: number,
      totalCost: number, hasCostData: boolean
    }>()

    for (const oi of orderItems) {
      const mi = oi.menuItem
      const itemTotal = Number(oi.itemTotal)
      const unitCost = oi.costAtSale != null
        ? Number(oi.costAtSale)
        : mi.recipe?.totalCost != null
          ? Number(mi.recipe.totalCost)
          : mi.cost != null
            ? Number(mi.cost)
            : null

      const hasCost = unitCost !== null && unitCost > 0
      const costForItem = hasCost ? unitCost! * oi.quantity : 0

      totalRevenue += itemTotal
      totalCost += costForItem

      if (hasCost) {
        itemsWithCost++
        revenueWithCost += itemTotal
      } else {
        itemsWithoutCost++
      }

      // Category aggregation
      const catKey = mi.categoryId
      if (categoryMap.has(catKey)) {
        const c = categoryMap.get(catKey)!
        c.revenue += itemTotal
        c.cost += costForItem
        c.itemCount++
      } else {
        categoryMap.set(catKey, {
          categoryId: mi.categoryId,
          categoryName: mi.category.name,
          categoryType: mi.category.categoryType || 'food',
          revenue: itemTotal,
          cost: costForItem,
          itemCount: 1,
        })
      }

      // Item aggregation
      const itemKey = oi.pricingOptionLabel
        ? `${mi.id}::${oi.pricingOptionLabel}`
        : mi.id
      if (itemMap.has(itemKey)) {
        const it = itemMap.get(itemKey)!
        it.qtySold += oi.quantity
        it.revenue += itemTotal
        it.totalCost += costForItem
        if (!it.hasCostData && hasCost) it.hasCostData = true
      } else {
        const displayName = oi.pricingOptionLabel
          ? `${mi.name} (${oi.pricingOptionLabel})`
          : mi.name
        itemMap.set(itemKey, {
          menuItemId: mi.id,
          menuItemName: displayName,
          categoryName: mi.category.name,
          qtySold: oi.quantity,
          revenue: itemTotal,
          unitPrice: Number(mi.price),
          unitCost: unitCost ?? 0,
          totalCost: costForItem,
          hasCostData: hasCost,
        })
      }
    }

    const foodCostPct = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : 0
    const grossProfit = totalRevenue - totalCost
    const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
    const coveragePercent = totalRevenue > 0 ? (revenueWithCost / totalRevenue) * 100 : 0

    const byCategory = Array.from(categoryMap.values()).map(c => ({
      ...c,
      foodCostPct: c.revenue > 0 ? (c.cost / c.revenue) * 100 : 0,
      grossProfit: c.revenue - c.cost,
    })).sort((a, b) => b.revenue - a.revenue)

    const byItem = Array.from(itemMap.values()).map(it => ({
      ...it,
      foodCostPct: it.revenue > 0 ? (it.totalCost / it.revenue) * 100 : 0,
      grossProfit: it.revenue - it.totalCost,
      contributionMargin: it.unitPrice - it.unitCost,
    })).sort((a, b) => b.revenue - a.revenue)

    return NextResponse.json({
      data: {
        summary: {
          totalRevenue,
          totalCost,
          foodCostPct,
          grossProfit,
          grossMargin,
          itemsWithCost,
          itemsWithoutCost,
          coveragePercent,
        },
        byCategory,
        byItem,
        dateRange: { start: range.start, end: range.end },
      },
    })
  } catch (error) {
    console.error('Failed to generate food cost report:', error)
    return NextResponse.json({ error: 'Failed to generate food cost report' }, { status: 500 })
  }
})

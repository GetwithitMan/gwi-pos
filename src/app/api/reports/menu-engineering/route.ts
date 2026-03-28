import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { err, ok } from '@/lib/api-response'

type Classification = 'star' | 'plow_horse' | 'puzzle' | 'dog'

function classify(qtySold: number, cm: number, avgQty: number, avgCM: number): Classification {
  const highPop = qtySold >= avgQty
  const highCM = cm >= avgCM
  if (highPop && highCM) return 'star'
  if (highPop && !highCM) return 'plow_horse'
  if (!highPop && highCM) return 'puzzle'
  return 'dog'
}

const RECOMMENDATIONS: Record<Classification, string> = {
  star: 'Feature prominently. Protect quality.',
  plow_horse: 'High volume — review cost structure or pricing.',
  puzzle: 'Market more aggressively. High margin opportunity.',
  dog: 'Consider removing, repricing, or repositioning.',
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const categoryId = searchParams.get('categoryId')
    const minQtySold = parseInt(searchParams.get('minQtySold') || '1')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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

    const orderItems = await db.orderItem.findMany({
      where: {
        order: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          isTraining: { not: true },
          paidAt: dateFilter,
        },
        status: 'active',
        ...(categoryId ? { menuItem: { categoryId } } : {}),
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            price: true,
            cost: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
            recipe: { select: { totalCost: true } },
          },
        },
      },
    })

    // Group by menuItemId
    const itemMap = new Map<string, {
      menuItemId: string, menuItemName: string, categoryId: string, categoryName: string,
      qtySold: number, revenue: number, sellPrice: number, unitCost: number,
      hasCostData: boolean
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
            : 0
      const hasCost = unitCost > 0

      if (itemMap.has(mi.id)) {
        const it = itemMap.get(mi.id)!
        it.qtySold += oi.quantity
        it.revenue += itemTotal
        if (!it.hasCostData && hasCost) {
          it.hasCostData = true
          it.unitCost = unitCost
        }
      } else {
        itemMap.set(mi.id, {
          menuItemId: mi.id,
          menuItemName: mi.name,
          categoryId: mi.categoryId,
          categoryName: mi.category.name,
          qtySold: oi.quantity,
          revenue: itemTotal,
          sellPrice: Number(mi.price),
          unitCost,
          hasCostData: hasCost,
        })
      }
    }

    // Filter by minQtySold
    const items = Array.from(itemMap.values()).filter(it => it.qtySold >= minQtySold)

    if (items.length === 0) {
      return ok({
          items: [],
          summary: { stars: 0, plowHorses: 0, puzzles: 0, dogs: 0, totalItems: 0 },
          averages: { avgQtySold: 0, avgContributionMargin: 0 },
          dateRange: { start: range.start, end: range.end },
        })
    }

    // Calculate averages from items WITH cost data
    const itemsWithCost = items.filter(it => it.hasCostData)
    const avgQtySold = items.reduce((s, it) => s + it.qtySold, 0) / items.length
    const avgCM = itemsWithCost.length > 0
      ? itemsWithCost.reduce((s, it) => s + (it.sellPrice - it.unitCost), 0) / itemsWithCost.length
      : 0

    // Classify each item
    const classified = items.map(it => {
      const contributionMargin = it.sellPrice - it.unitCost
      const classification = it.hasCostData
        ? classify(it.qtySold, contributionMargin, avgQtySold, avgCM)
        : (it.qtySold >= avgQtySold ? 'plow_horse' : 'dog') as Classification
      return {
        ...it,
        contributionMargin,
        classification,
        recommendation: RECOMMENDATIONS[classification],
        foodCostPct: it.sellPrice > 0 && it.hasCostData
          ? (it.unitCost / it.sellPrice) * 100
          : null,
      }
    })

    // Sort by classification priority then by revenue
    const classOrder: Record<Classification, number> = { star: 0, puzzle: 1, plow_horse: 2, dog: 3 }
    classified.sort((a, b) => classOrder[a.classification] - classOrder[b.classification] || b.revenue - a.revenue)

    const summary = {
      stars: classified.filter(i => i.classification === 'star').length,
      plowHorses: classified.filter(i => i.classification === 'plow_horse').length,
      puzzles: classified.filter(i => i.classification === 'puzzle').length,
      dogs: classified.filter(i => i.classification === 'dog').length,
      totalItems: classified.length,
      starsRevenue: classified.filter(i => i.classification === 'star').reduce((s, i) => s + i.revenue, 0),
      plowHorsesRevenue: classified.filter(i => i.classification === 'plow_horse').reduce((s, i) => s + i.revenue, 0),
      puzzlesRevenue: classified.filter(i => i.classification === 'puzzle').reduce((s, i) => s + i.revenue, 0),
      dogsRevenue: classified.filter(i => i.classification === 'dog').reduce((s, i) => s + i.revenue, 0),
    }

    // Get available categories for filter dropdown
    const categories = await db.category.findMany({
      where: { locationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return ok({
        items: classified,
        summary,
        averages: { avgQtySold, avgContributionMargin: avgCM },
        categories,
        dateRange: { start: range.start, end: range.end },
      })
  } catch (error) {
    console.error('Failed to generate menu engineering report:', error)
    return err('Failed to generate menu engineering report', 500)
  }
})

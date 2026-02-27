import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'

// GET - Product mix report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const categoryId = searchParams.get('categoryId')
    const groupBy = searchParams.get('groupBy') || 'item' // item, category, hour, day
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_PRODUCT_MIX)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Resolve venue timezone for correct date boundaries
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    // Build date filter — timezone-aware
    const dateFilter: Record<string, Date> = {}
    if (startDate) {
      const range = dateRangeToUTC(startDate, endDate, timezone)
      dateFilter.gte = range.start
      if (endDate) {
        dateFilter.lte = range.end
      }
    } else {
      // Default to last 30 days
      dateFilter.gte = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      if (endDate) {
        const range = dateRangeToUTC(endDate, null, timezone)
        dateFilter.lte = range.end
      }
    }

    // Get all order items in the date range
    const orderItems = await db.orderItem.findMany({
      where: {
        order: {
          locationId,
          status: { in: ['paid', 'closed'] },
          paidAt: dateFilter,
        },
        status: 'active',
        ...(categoryId ? { menuItem: { categoryId } } : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            paidAt: true,
            orderType: true,
          },
        },
        menuItem: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: {
              select: {
                id: true,
                name: true,
              },
            },
            price: true,
            cost: true,
          },
        },
        modifiers: true,
      },
    })

    // W2-R1: Voided/comped items for waste tracking
    const wasteItems = await db.orderItem.findMany({
      where: {
        order: {
          locationId,
          OR: [
            { paidAt: dateFilter },
            { createdAt: dateFilter },
          ],
        },
        status: { in: ['voided', 'comped'] },
        ...(categoryId ? { menuItem: { categoryId } } : {}),
      },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            categoryId: true,
            category: { select: { id: true, name: true } },
            price: true,
            cost: true,
          },
        },
      },
    })

    // Aggregate waste data
    const wasteMap = new Map<string, { name: string, categoryName: string, quantity: number, lostRevenue: number, lostCost: number, status: string }>()
    for (const item of wasteItems) {
      const key = item.pricingOptionLabel
        ? `${item.menuItemId}::${item.pricingOptionLabel}-${item.status}`
        : `${item.menuItemId}-${item.status}`
      const lostRevenue = Number(item.itemTotal)
      const wasteCostUnit = item.costAtSale != null ? Number(item.costAtSale) : (item.menuItem.cost ? Number(item.menuItem.cost) : 0)
      const lostCost = wasteCostUnit * item.quantity
      if (wasteMap.has(key)) {
        const existing = wasteMap.get(key)!
        existing.quantity += item.quantity
        existing.lostRevenue += lostRevenue
        existing.lostCost += lostCost
      } else {
        const wasteName = item.pricingOptionLabel
          ? `${item.menuItem.name} (${item.pricingOptionLabel})`
          : item.menuItem.name
        wasteMap.set(key, {
          name: wasteName,
          categoryName: item.menuItem.category.name,
          quantity: item.quantity,
          lostRevenue,
          lostCost,
          status: item.status || 'voided',
        })
      }
    }

    const wasteData = {
      totalItems: wasteItems.reduce((sum, i) => sum + i.quantity, 0),
      totalLostRevenue: wasteItems.reduce((sum, i) => sum + Number(i.itemTotal), 0),
      totalLostCost: wasteItems.reduce((sum, i) => {
        const cost = i.costAtSale != null ? Number(i.costAtSale) : (i.menuItem.cost ? Number(i.menuItem.cost) : 0)
        return sum + cost * i.quantity
      }, 0),
      items: Array.from(wasteMap.values()).sort((a, b) => b.lostRevenue - a.lostRevenue),
    }

    // Calculate totals
    let totalRevenue = 0
    let totalCost = 0
    let totalQuantity = 0

    // Group by item
    const itemMap = new Map<string, {
      menuItemId: string
      name: string
      pricingOptionLabel: string | null
      categoryId: string
      categoryName: string
      quantity: number
      revenue: number
      cost: number
      profit: number
      modifierRevenue: number
      soldByWeight: boolean
      totalWeight: number
      weightUnit: string | null
      orderTypes: Record<string, number>
      hourlyDistribution: Record<number, number>
    }>()

    for (const item of orderItems) {
      const menuItem = item.menuItem
      const key = item.pricingOptionLabel
        ? `${menuItem.id}::${item.pricingOptionLabel}`
        : menuItem.id
      const displayName = item.pricingOptionLabel
        ? `${menuItem.name} (${item.pricingOptionLabel})`
        : menuItem.name

      const itemTotal = Number(item.itemTotal)
      const unitCost = item.costAtSale != null ? Number(item.costAtSale) : (menuItem.cost ? Number(menuItem.cost) : 0)
      const itemCost = unitCost * item.quantity
      const modifierTotal = Number(item.modifierTotal)

      totalRevenue += itemTotal
      totalCost += itemCost
      totalQuantity += item.quantity

      const hour = item.order.paidAt ? new Date(item.order.paidAt).getHours() : 0
      const orderType = item.order.orderType || 'dine_in'

      const isByWeight = item.soldByWeight === true
      const itemWeight = isByWeight && item.weight ? Number(item.weight) * item.quantity : 0

      if (itemMap.has(key)) {
        const existing = itemMap.get(key)!
        existing.quantity += item.quantity
        existing.revenue += itemTotal
        existing.cost += itemCost
        existing.profit += (itemTotal - itemCost)
        existing.modifierRevenue += modifierTotal
        if (isByWeight) existing.totalWeight += itemWeight
        existing.orderTypes[orderType] = (existing.orderTypes[orderType] || 0) + item.quantity
        existing.hourlyDistribution[hour] = (existing.hourlyDistribution[hour] || 0) + item.quantity
      } else {
        itemMap.set(key, {
          menuItemId: menuItem.id,
          name: displayName,
          pricingOptionLabel: item.pricingOptionLabel || null,
          categoryId: menuItem.categoryId,
          categoryName: menuItem.category.name,
          quantity: item.quantity,
          revenue: itemTotal,
          cost: itemCost,
          profit: itemTotal - itemCost,
          modifierRevenue: modifierTotal,
          soldByWeight: isByWeight,
          totalWeight: itemWeight,
          weightUnit: isByWeight ? (item.weightUnit || 'lb') : null,
          orderTypes: { [orderType]: item.quantity },
          hourlyDistribution: { [hour]: item.quantity },
        })
      }
    }

    // Convert to array and calculate percentages
    const items = Array.from(itemMap.values()).map(item => ({
      ...item,
      revenuePercent: totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0,
      quantityPercent: totalQuantity > 0 ? (item.quantity / totalQuantity) * 100 : 0,
      profitMargin: item.revenue > 0 ? ((item.revenue - item.cost) / item.revenue) * 100 : 0,
      avgPrice: item.quantity > 0 ? item.revenue / item.quantity : 0,
    }))

    // Sort by revenue descending
    items.sort((a, b) => b.revenue - a.revenue)

    // Group by category
    const categoryMap = new Map<string, {
      categoryId: string
      categoryName: string
      itemCount: number
      quantity: number
      revenue: number
      cost: number
      profit: number
    }>()

    for (const item of items) {
      if (categoryMap.has(item.categoryId)) {
        const existing = categoryMap.get(item.categoryId)!
        existing.itemCount += 1
        existing.quantity += item.quantity
        existing.revenue += item.revenue
        existing.cost += item.cost
        existing.profit += item.profit
      } else {
        categoryMap.set(item.categoryId, {
          categoryId: item.categoryId,
          categoryName: item.categoryName,
          itemCount: 1,
          quantity: item.quantity,
          revenue: item.revenue,
          cost: item.cost,
          profit: item.profit,
        })
      }
    }

    const categories = Array.from(categoryMap.values()).map(cat => ({
      ...cat,
      revenuePercent: totalRevenue > 0 ? (cat.revenue / totalRevenue) * 100 : 0,
      quantityPercent: totalQuantity > 0 ? (cat.quantity / totalQuantity) * 100 : 0,
      profitMargin: cat.revenue > 0 ? ((cat.revenue - cat.cost) / cat.revenue) * 100 : 0,
    }))

    categories.sort((a, b) => b.revenue - a.revenue)

    // Calculate hourly distribution
    const hourlyDistribution: Record<number, { quantity: number; revenue: number }> = {}
    for (let h = 0; h < 24; h++) {
      hourlyDistribution[h] = { quantity: 0, revenue: 0 }
    }

    for (const item of items) {
      for (const [hour, qty] of Object.entries(item.hourlyDistribution)) {
        const h = parseInt(hour)
        hourlyDistribution[h].quantity += qty
        hourlyDistribution[h].revenue += (item.avgPrice * qty)
      }
    }

    // Top performers
    const topByQuantity = [...items].sort((a, b) => b.quantity - a.quantity).slice(0, 10)
    const topByRevenue = [...items].sort((a, b) => b.revenue - a.revenue).slice(0, 10)
    const topByProfit = [...items].sort((a, b) => b.profit - a.profit).slice(0, 10)
    const bottomPerformers = [...items].sort((a, b) => a.quantity - b.quantity).slice(0, 10)

    // Calculate item pairings (frequently ordered together)
    const pairings = await calculateItemPairings(orderItems)

    return NextResponse.json({ data: {
      summary: {
        totalRevenue,
        totalCost,
        totalProfit: totalRevenue - totalCost,
        totalQuantity,
        uniqueItems: items.length,
        avgItemPrice: totalQuantity > 0 ? totalRevenue / totalQuantity : 0,
        profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      },
      items,
      categories,
      hourlyDistribution,
      topPerformers: {
        byQuantity: topByQuantity,
        byRevenue: topByRevenue,
        byProfit: topByProfit,
        bottomPerformers,
      },
      pairings,
      waste: wasteData,
      dateRange: {
        start: dateFilter.gte,
        end: dateFilter.lte || new Date(),
      },
    } })
  } catch (error) {
    console.error('Failed to generate product mix report:', error)
    return NextResponse.json(
      { error: 'Failed to generate product mix report' },
      { status: 500 }
    )
  }
})

// Helper function to calculate item pairings
async function calculateItemPairings(orderItems: Array<{ order: { id: string; paidAt: Date | null }, menuItem: { id: string; name: string } }>) {
  // Group items by order ID (B18 fix: was grouping by paidAt timestamp which
  // merged orders paid at the same millisecond and split orders with different paidAt)
  const itemsByOrder = orderItems.reduce((acc, item) => {
    const orderKey = item.order.id
    if (!acc[orderKey]) {
      acc[orderKey] = []
    }
    acc[orderKey].push(item.menuItem.id)
    return acc
  }, {} as Record<string, string[]>)

  // Count pairings
  const pairingCounts = new Map<string, { items: [string, string], names: [string, string], count: number }>()

  // Build name lookup
  const nameMap = new Map<string, string>()
  for (const item of orderItems) {
    nameMap.set(item.menuItem.id, item.menuItem.name)
  }

  for (const items of Object.values(itemsByOrder)) {
    const uniqueItems = [...new Set(items)]

    // Generate all pairs
    for (let i = 0; i < uniqueItems.length; i++) {
      for (let j = i + 1; j < uniqueItems.length; j++) {
        const pair = [uniqueItems[i], uniqueItems[j]].sort() as [string, string]
        const key = pair.join('|')

        if (pairingCounts.has(key)) {
          pairingCounts.get(key)!.count++
        } else {
          pairingCounts.set(key, {
            items: pair,
            names: [nameMap.get(pair[0]) || '', nameMap.get(pair[1]) || ''],
            count: 1,
          })
        }
      }
    }
  }

  // Get top pairings
  const pairings = Array.from(pairingCounts.values())
    .filter(p => p.count >= 3) // At least 3 occurrences
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return pairings
}

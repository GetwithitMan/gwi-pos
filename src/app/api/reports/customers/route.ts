import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET customer analytics report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const customerId = searchParams.get('customerId')
    const minOrders = parseInt(searchParams.get('minOrders') || '0')
    const minSpent = parseFloat(searchParams.get('minSpent') || '0')
    const sortBy = searchParams.get('sortBy') || 'totalSpent'
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_CUSTOMERS, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter for orders
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // Get customers with their order data
    const customers = await db.customer.findMany({
      where: {
        locationId,
        isActive: true,
        ...(customerId ? { id: customerId } : {}),
        totalOrders: { gte: minOrders },
        totalSpent: { gte: minSpent },
      },
      include: {
        orders: {
          where: {
            status: { in: ['completed', 'paid'] },
            ...dateFilter,
          },
          select: {
            id: true,
            orderNumber: true,
            subtotal: true,
            total: true,
            tipTotal: true,
            guestCount: true,
            orderType: true,
            createdAt: true,
            paidAt: true,
            items: {
              select: {
                menuItemId: true,
                name: true,
                quantity: true,
                itemTotal: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    // Initialize summary
    let totalCustomers = 0
    let totalRevenue = 0
    let totalOrders = 0
    let totalGuests = 0
    let repeatCustomers = 0
    let newCustomers = 0

    // Group by order frequency
    const frequencyBuckets = {
      oneTime: 0,
      occasional: 0, // 2-5 orders
      regular: 0, // 6-15 orders
      vip: 0, // 16+ orders
    }

    // Group by spend tier
    const spendTiers = {
      low: 0, // $0-50
      medium: 0, // $51-200
      high: 0, // $201-500
      vip: 0, // $500+
    }

    // Top customers
    const customerStats: {
      id: string
      name: string
      email: string | null
      phone: string | null
      ordersInPeriod: number
      spentInPeriod: number
      tipsInPeriod: number
      avgTicketInPeriod: number
      totalOrders: number
      totalSpent: number
      averageTicket: number
      loyaltyPoints: number
      daysSinceLastVisit: number | null
      favoriteItems: { name: string; count: number }[]
      tags: string[]
    }[] = []

    // Tag analysis
    const tagStats: Record<string, {
      tag: string
      customerCount: number
      totalSpent: number
      totalOrders: number
    }> = {}

    // Order type preference
    const orderTypeStats: Record<string, {
      type: string
      customers: number
      orders: number
      revenue: number
    }> = {}

    // Day of week analysis
    const dayOfWeekStats: Record<number, {
      day: number
      dayName: string
      orders: number
      revenue: number
      uniqueCustomers: Set<string>
    }> = {}

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    // Process customers
    customers.forEach(customer => {
      totalCustomers += 1

      const ordersInPeriod = customer.orders.length
      const spentInPeriod = customer.orders.reduce((sum, o) => sum + Number(o.subtotal), 0)
      const tipsInPeriod = customer.orders.reduce((sum, o) => sum + Number(o.tipTotal), 0)
      const guestsInPeriod = customer.orders.reduce((sum, o) => sum + o.guestCount, 0)

      totalOrders += ordersInPeriod
      totalRevenue += spentInPeriod
      totalGuests += guestsInPeriod

      // New vs repeat
      if (customer.totalOrders === 1) {
        newCustomers += 1
      } else {
        repeatCustomers += 1
      }

      // Frequency buckets
      if (customer.totalOrders === 1) {
        frequencyBuckets.oneTime += 1
      } else if (customer.totalOrders <= 5) {
        frequencyBuckets.occasional += 1
      } else if (customer.totalOrders <= 15) {
        frequencyBuckets.regular += 1
      } else {
        frequencyBuckets.vip += 1
      }

      // Spend tiers
      const totalSpent = Number(customer.totalSpent)
      if (totalSpent <= 50) {
        spendTiers.low += 1
      } else if (totalSpent <= 200) {
        spendTiers.medium += 1
      } else if (totalSpent <= 500) {
        spendTiers.high += 1
      } else {
        spendTiers.vip += 1
      }

      // Tag analysis - tags is now Json (array stored as JSON)
      const customerTags = (customer.tags as string[] | null) || []
      customerTags.forEach(tag => {
        if (!tagStats[tag]) {
          tagStats[tag] = {
            tag,
            customerCount: 0,
            totalSpent: 0,
            totalOrders: 0,
          }
        }
        tagStats[tag].customerCount += 1
        tagStats[tag].totalSpent += spentInPeriod
        tagStats[tag].totalOrders += ordersInPeriod
      })

      // Order type preference
      customer.orders.forEach(order => {
        const type = order.orderType
        if (!orderTypeStats[type]) {
          orderTypeStats[type] = {
            type,
            customers: 0,
            orders: 0,
            revenue: 0,
          }
        }
        orderTypeStats[type].orders += 1
        orderTypeStats[type].revenue += Number(order.subtotal)

        // Day of week
        const day = order.createdAt.getDay()
        if (!dayOfWeekStats[day]) {
          dayOfWeekStats[day] = {
            day,
            dayName: dayNames[day],
            orders: 0,
            revenue: 0,
            uniqueCustomers: new Set(),
          }
        }
        dayOfWeekStats[day].orders += 1
        dayOfWeekStats[day].revenue += Number(order.subtotal)
        dayOfWeekStats[day].uniqueCustomers.add(customer.id)
      })

      // Favorite items
      const itemCounts: Record<string, { name: string; count: number }> = {}
      customer.orders.forEach(order => {
        order.items.forEach(item => {
          if (!itemCounts[item.name]) {
            itemCounts[item.name] = { name: item.name, count: 0 }
          }
          itemCounts[item.name].count += item.quantity
        })
      })
      const favoriteItems = Object.values(itemCounts)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)

      // Days since last visit
      const daysSinceLastVisit = customer.lastVisit
        ? Math.floor((Date.now() - customer.lastVisit.getTime()) / (1000 * 60 * 60 * 24))
        : null

      customerStats.push({
        id: customer.id,
        name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
        email: customer.email,
        phone: customer.phone,
        ordersInPeriod,
        spentInPeriod: Math.round(spentInPeriod * 100) / 100,
        tipsInPeriod: Math.round(tipsInPeriod * 100) / 100,
        avgTicketInPeriod: ordersInPeriod > 0 ? Math.round((spentInPeriod / ordersInPeriod) * 100) / 100 : 0,
        totalOrders: customer.totalOrders,
        totalSpent: Number(customer.totalSpent),
        averageTicket: Number(customer.averageTicket),
        loyaltyPoints: customer.loyaltyPoints,
        daysSinceLastVisit,
        favoriteItems,
        tags: (customer.tags as string[] | null) || [],
      })
    })

    // Count unique customers per order type
    const customerOrderTypes: Record<string, Set<string>> = {}
    customers.forEach(customer => {
      customer.orders.forEach(order => {
        if (!customerOrderTypes[order.orderType]) {
          customerOrderTypes[order.orderType] = new Set()
        }
        customerOrderTypes[order.orderType].add(customer.id)
      })
    })
    Object.keys(orderTypeStats).forEach(type => {
      orderTypeStats[type].customers = customerOrderTypes[type]?.size || 0
    })

    // Sort customers
    const sortedCustomers = [...customerStats].sort((a, b) => {
      switch (sortBy) {
        case 'totalOrders':
          return b.totalOrders - a.totalOrders
        case 'lastVisit':
          return (a.daysSinceLastVisit ?? Infinity) - (b.daysSinceLastVisit ?? Infinity)
        case 'averageTicket':
          return b.averageTicket - a.averageTicket
        case 'ordersInPeriod':
          return b.ordersInPeriod - a.ordersInPeriod
        case 'spentInPeriod':
          return b.spentInPeriod - a.spentInPeriod
        default: // totalSpent
          return b.totalSpent - a.totalSpent
      }
    })

    // Format reports
    const tagReport = Object.values(tagStats)
      .map(t => ({
        ...t,
        totalSpent: Math.round(t.totalSpent * 100) / 100,
        avgSpentPerCustomer: t.customerCount > 0
          ? Math.round((t.totalSpent / t.customerCount) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.customerCount - a.customerCount)

    const orderTypeReport = Object.values(orderTypeStats)
      .map(t => ({
        ...t,
        revenue: Math.round(t.revenue * 100) / 100,
        avgTicket: t.orders > 0 ? Math.round((t.revenue / t.orders) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    const dayOfWeekReport = Object.values(dayOfWeekStats)
      .map(d => ({
        day: d.day,
        dayName: d.dayName,
        orders: d.orders,
        revenue: Math.round(d.revenue * 100) / 100,
        uniqueCustomers: d.uniqueCustomers.size,
      }))
      .sort((a, b) => a.day - b.day)

    // At-risk customers (haven't visited in 30+ days)
    const atRiskCustomers = sortedCustomers.filter(
      c => c.daysSinceLastVisit !== null && c.daysSinceLastVisit >= 30 && c.totalOrders > 1
    )

    // Top 20 by spend
    const topBySpend = sortedCustomers.slice(0, 20)

    // VIP customers (top 10% or 16+ orders)
    const vipThreshold = Math.ceil(totalCustomers * 0.1)
    const vipCustomers = sortedCustomers.slice(0, Math.max(vipThreshold, frequencyBuckets.vip))

    return NextResponse.json({
      summary: {
        totalCustomers,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        totalGuests,
        avgOrdersPerCustomer: totalCustomers > 0
          ? Math.round((totalOrders / totalCustomers) * 100) / 100
          : 0,
        avgRevenuePerCustomer: totalCustomers > 0
          ? Math.round((totalRevenue / totalCustomers) * 100) / 100
          : 0,
        avgTicket: totalOrders > 0
          ? Math.round((totalRevenue / totalOrders) * 100) / 100
          : 0,
        repeatCustomerRate: totalCustomers > 0
          ? Math.round((repeatCustomers / totalCustomers) * 100)
          : 0,
        newCustomers,
        repeatCustomers,
      },
      frequencyDistribution: frequencyBuckets,
      spendTierDistribution: spendTiers,
      byTag: tagReport,
      byOrderType: orderTypeReport,
      byDayOfWeek: dayOfWeekReport,
      topCustomers: topBySpend,
      vipCustomers: vipCustomers.slice(0, 10),
      atRiskCustomers: atRiskCustomers.slice(0, 20),
      allCustomers: sortedCustomers,
      filters: {
        startDate,
        endDate,
        locationId,
        customerId,
        minOrders,
        minSpent,
        sortBy,
      },
    })
  } catch (error) {
    console.error('Failed to generate customer report:', error)
    return NextResponse.json(
      { error: 'Failed to generate customer report' },
      { status: 500 }
    )
  }
}

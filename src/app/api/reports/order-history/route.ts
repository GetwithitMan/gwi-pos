import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { dateRangeToUTC } from '@/lib/timezone'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const customerId = searchParams.get('customerId')
    const search = searchParams.get('search')
    const orderType = searchParams.get('orderType')
    const format = searchParams.get('format') || 'json'
    const page = parseInt(searchParams.get('page') || '1')
    const limit = format === 'csv' ? 10000 : parseInt(searchParams.get('limit') || '50')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return err('Location ID required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build where clause
    const where: Record<string, unknown> = {
      locationId,
    }

    // Date range — use venue timezone for correct boundaries
    if (startDate || endDate) {
      // Get location timezone
      const loc = await prisma.location.findFirst({
        where: { id: locationId },
        select: { timezone: true },
      })
      const timezone = loc?.timezone || 'America/New_York'
      const range = dateRangeToUTC(startDate || endDate!, endDate, timezone)
      where.createdAt = {}
      if (startDate) {
        (where.createdAt as Record<string, Date>).gte = range.start
      }
      if (endDate) {
        (where.createdAt as Record<string, Date>).lte = range.end
      }
    }

    // Status filter
    if (status) {
      where.status = status
    }

    // Employee filter (separate from auth employeeId — only apply if explicitly filtering by server)
    const serverId = searchParams.get('serverId')
    if (serverId) {
      where.employeeId = serverId
    }

    // Customer filter
    if (customerId) {
      where.customerId = customerId
    }

    // Order type filter
    if (orderType) {
      where.orderType = orderType
    }

    // Search by order number or table name
    if (search) {
      const searchNum = parseInt(search)
      if (!isNaN(searchNum)) {
        where.orderNumber = searchNum
      } else {
        where.OR = [
          { tableName: { contains: search } },
          { tabName: { contains: search } },
          { customer: { firstName: { contains: search } } },
          { customer: { lastName: { contains: search } } },
        ]
      }
    }

    // Fetch location tax settings for proper tax computation
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const taxRateDecimal = (locationSettings.tax?.defaultRate ?? 0) / 100
    const calculateAfterDiscount = locationSettings.tax?.calculateAfterDiscount ?? true

    // Run all queries in parallel (they're independent reads)
    const [totalCount, orders, stats, statusBreakdown, typeBreakdown, paymentBreakdown, cardPriceStats] = await Promise.all([
      // 1. Total count
      prisma.order.count({ where }),

      // 2. Paginated orders
      prisma.order.findMany({
        where,
        select: {
          id: true,
          orderNumber: true,
          orderType: true,
          status: true,
          tabName: true,
          guestCount: true,
          subtotal: true,
          taxTotal: true,
          taxFromInclusive: true,
          taxFromExclusive: true,
          discountTotal: true,
          total: true,
          createdAt: true,
          closedAt: true,
          employee: {
            select: { id: true, firstName: true, lastName: true },
          },
          customer: {
            select: { id: true, firstName: true, lastName: true, phone: true },
          },
          table: {
            select: { id: true, name: true },
          },
          payments: {
            select: {
              id: true,
              paymentMethod: true,
              amount: true,
              tipAmount: true,
              totalAmount: true,
              cardLast4: true,
              cardBrand: true,
            },
          },
          items: {
            where: { deletedAt: null },
            select: { cardPrice: true, price: true, itemTotal: true, status: true },
          },
          _count: {
            select: { items: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),

      // 3. Summary stats
      prisma.order.aggregate({
        where,
        _sum: {
          subtotal: true,
          taxTotal: true,
          taxFromInclusive: true,
          taxFromExclusive: true,
          total: true,
          discountTotal: true,
        },
        _count: true,
      }),

      // 4. Status breakdown (uses same filters for consistency)
      prisma.order.groupBy({
        by: ['status'],
        where,
        _count: true,
        _sum: { total: true },
      }),

      // 5. Order type breakdown
      prisma.order.groupBy({
        by: ['orderType'],
        where,
        _count: true,
        _sum: { total: true },
      }),

      // 6. Payment method breakdown (scoped to filtered orders)
      prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: {
          order: where,
        },
        _count: true,
        _sum: { amount: true, tipAmount: true },
      }),

      // 7. Card-price subtotal for dual pricing adjustment
      prisma.orderItem.aggregate({
        where: {
          order: where,
          deletedAt: null,
          status: 'active',
          cardPrice: { not: null },
        },
        _sum: { cardPrice: true, price: true, itemTotal: true },
        _count: true,
      }),
    ])

    const mappedOrders = orders.map(order => {
      // Compute card total from dual pricing multiplier (includes items + modifiers)
      const activeItems = order.items.filter(i => i.status === 'active')
      const hasCardPricing = activeItems.some(i => i.cardPrice != null)
      // Derive multiplier from any item with both prices
      const dpMultiplier = (() => {
        for (const i of activeItems) {
          const cp = Number(i.price)
          if (i.cardPrice != null && cp > 0) return Number(i.cardPrice) / cp
        }
        return 1
      })()
      // Compute from items (not stored subtotal which may diverge)
      const computedCashSubtotal = Math.round(
        activeItems.reduce((sum, i) => sum + Number(i.itemTotal), 0) * 100
      ) / 100
      const cardSubtotal = hasCardPricing
        ? Math.round(computedCashSubtotal * dpMultiplier * 100) / 100
        : null
      const displaySubtotal = cardSubtotal ?? computedCashSubtotal
      const discountTotal = Math.round(Number(order.discountTotal) * 100) / 100
      // Use stored split tax values (taxFromInclusive + taxFromExclusive) when available,
      // falling back to single-rate computation for legacy orders
      const storedTaxFromInclusive = Number(order.taxFromInclusive ?? 0)
      const storedTaxFromExclusive = Number(order.taxFromExclusive ?? 0)
      const hasStoredSplitTax = storedTaxFromInclusive > 0 || storedTaxFromExclusive > 0
      let computedCashTax: number
      let cardTax: number
      if (hasStoredSplitTax) {
        // Stored split tax is authoritative — use it directly
        computedCashTax = Math.round((storedTaxFromInclusive + storedTaxFromExclusive) * 100) / 100
        cardTax = computedCashTax // Split tax already correct for both pricing modes
      } else {
        // Legacy fallback: single-rate computation
        const cashTaxable = calculateAfterDiscount ? Math.max(0, computedCashSubtotal - discountTotal) : computedCashSubtotal
        computedCashTax = Math.round(cashTaxable * taxRateDecimal * 100) / 100
        const cardTaxable = calculateAfterDiscount ? Math.max(0, displaySubtotal - discountTotal) : displaySubtotal
        cardTax = Math.round(cardTaxable * taxRateDecimal * 100) / 100
      }
      const computedCashTotal = Math.round((computedCashSubtotal - discountTotal + computedCashTax) * 100) / 100
      const displayTotal = Math.round((displaySubtotal - discountTotal + cardTax) * 100) / 100

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        tableName: order.table?.name,
        tabName: order.tabName,
        guestCount: order.guestCount,
        subtotal: cardSubtotal ?? computedCashSubtotal,
        taxTotal: cardTax,
        discountTotal,
        total: displayTotal,
        cashTotal: hasCardPricing ? computedCashTotal : undefined,
        employee: order.employee,
        customer: order.customer,
        itemCount: order._count.items,
        payments: order.payments.map(p => ({
          id: p.id,
          method: p.paymentMethod,
          paymentMethod: p.paymentMethod,
          amount: Number(p.amount),
          tipAmount: Number(p.tipAmount),
          totalAmount: Number(p.totalAmount),
          cardLast4: p.cardLast4,
          cardBrand: p.cardBrand,
        })),
        createdAt: order.createdAt,
        closedAt: order.closedAt,
      }
    })

    // CSV export
    if (format === 'csv') {
      const csvEscape = (val: string) => {
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`
        }
        return val
      }

      const header = 'Order #,Date,Time,Status,Order Type,Server,Subtotal,Discount,Tax,Total,Payment Method,Tip Amount,Items'
      const rows = mappedOrders.map(o => {
        const d = new Date(o.createdAt)
        const dateStr = d.toLocaleDateString('en-US')
        const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        const serverName = o.employee ? `${o.employee.firstName} ${o.employee.lastName}` : ''
        const paymentMethods = o.payments.map(p => p.paymentMethod).join('; ')
        const tipTotal = o.payments.reduce((sum, p) => sum + p.tipAmount, 0)

        return [
          String(o.orderNumber),
          csvEscape(dateStr),
          csvEscape(timeStr),
          csvEscape(o.status),
          csvEscape(o.orderType),
          csvEscape(serverName),
          o.subtotal.toFixed(2),
          o.discountTotal.toFixed(2),
          o.taxTotal.toFixed(2),
          o.total.toFixed(2),
          csvEscape(paymentMethods),
          tipTotal.toFixed(2),
          String(o.itemCount),
        ].join(',')
      })

      const csv = [header, ...rows].join('\n')
      const dateLabel = startDate || 'all'
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="order-history-${dateLabel}.csv"`,
        },
      })
    }

    return ok({
      orders: mappedOrders,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
      summary: (() => {
        const cashSubtotal = Number(stats._sum.subtotal || 0)
        const discountTotalSum = Number(stats._sum.discountTotal || 0)
        // Dual pricing: derive multiplier from aggregate base prices, apply to full subtotals
        const cardBasePriceSum = Number(cardPriceStats._sum.cardPrice || 0)
        const cashBasePriceSum = Number(cardPriceStats._sum.price || 0)
        const summaryMultiplier = cashBasePriceSum > 0 ? cardBasePriceSum / cashBasePriceSum : 1
        const subtotal = summaryMultiplier > 1 ? Math.round(cashSubtotal * summaryMultiplier * 100) / 100 : cashSubtotal
        // Use stored split tax sums when available, fallback to single-rate computation
        const sumTaxFromInclusive = Number(stats._sum.taxFromInclusive || 0)
        const sumTaxFromExclusive = Number(stats._sum.taxFromExclusive || 0)
        const hasSumSplitTax = sumTaxFromInclusive > 0 || sumTaxFromExclusive > 0
        let taxTotal: number
        if (hasSumSplitTax) {
          taxTotal = Math.round((sumTaxFromInclusive + sumTaxFromExclusive) * 100) / 100
        } else {
          const taxableAmount = calculateAfterDiscount ? Math.max(0, subtotal - discountTotalSum) : subtotal
          taxTotal = Math.round(taxableAmount * taxRateDecimal * 100) / 100
        }
        const total = Math.round((subtotal - discountTotalSum + taxTotal) * 100) / 100
        return {
          orderCount: stats._count,
          subtotal: Math.round(subtotal * 100) / 100,
          taxTotal,
          discountTotal: discountTotalSum,
          total: Math.round(total * 100) / 100,
        }
      })(),
      statusBreakdown: statusBreakdown.map(s => ({
        status: s.status,
        count: s._count,
        total: Number(s._sum.total || 0),
      })),
      typeBreakdown: typeBreakdown.map(t => ({
        type: t.orderType,
        count: t._count,
        total: Number(t._sum.total || 0),
      })),
      paymentBreakdown: paymentBreakdown.map(p => ({
        method: p.paymentMethod,
        count: p._count,
        amount: Number(p._sum.amount || 0),
        tips: Number(p._sum.tipAmount || 0),
      })),
    })
  } catch (error) {
    console.error('Order history error:', error)
    return err('Failed to fetch order history', 500)
  }
})

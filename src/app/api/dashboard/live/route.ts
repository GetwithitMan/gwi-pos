import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime

    // Current business day range
    const current = getCurrentBusinessDay(dayStartTime)
    const startOfDay = current.start
    const endOfDay = current.end

    // Last week same day range (for pacing comparison)
    const lastWeekDate = new Date(current.date + 'T12:00:00')
    lastWeekDate.setDate(lastWeekDate.getDate() - 7)
    const lastWeekStr = `${lastWeekDate.getFullYear()}-${String(lastWeekDate.getMonth() + 1).padStart(2, '0')}-${String(lastWeekDate.getDate()).padStart(2, '0')}`
    const lastWeekRange = getBusinessDayRange(lastWeekStr, dayStartTime)

    // How far into the business day are we? Used for pacing projection.
    const now = new Date()
    const elapsedMs = now.getTime() - startOfDay.getTime()
    const totalDayMs = endOfDay.getTime() - startOfDay.getTime()
    const dayFraction = Math.min(Math.max(elapsedMs / totalDayMs, 0), 1)

    // All queries in parallel
    const [
      todayOrders,
      lastWeekOrders,
      openOrders,
      voidItems,
      compItems,
      discountedOrders,
      paidInOuts,
      pendingDeductionsFailed,
    ] = await Promise.all([
      // Today's closed/paid orders for sales metrics
      // Use businessDayDate as primary boundary, fall back to createdAt
      db.order.findMany({
        where: {
          locationId,
          deletedAt: null,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          parentOrderId: null,
          OR: [
            { businessDayDate: { gte: startOfDay, lte: endOfDay } },
            { businessDayDate: null, createdAt: { gte: startOfDay, lte: endOfDay } },
          ],
        },
        select: {
          id: true,
          subtotal: true,
          total: true,
          discountTotal: true,
          taxTotal: true,
        },
      }),

      // Last week same day - orders closed up to the equivalent time of day
      // Use businessDayDate as primary boundary, fall back to createdAt
      db.order.findMany({
        where: {
          locationId,
          deletedAt: null,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          parentOrderId: null,
          OR: [
            { businessDayDate: { gte: lastWeekRange.start, lte: new Date(lastWeekRange.start.getTime() + elapsedMs) } },
            { businessDayDate: null, createdAt: { gte: lastWeekRange.start, lte: new Date(lastWeekRange.start.getTime() + elapsedMs) } },
          ],
        },
        select: {
          id: true,
          total: true,
        },
      }),

      // Open tickets
      db.order.findMany({
        where: {
          locationId,
          deletedAt: null,
          status: { in: ['open', 'sent'] },
        },
        select: {
          id: true,
          total: true,
        },
      }),

      // Voided items today — use itemTotal (price * quantity) for accurate dollar impact
      db.orderItem.aggregate({
        where: {
          locationId,
          deletedAt: null,
          status: 'voided',
          updatedAt: { gte: startOfDay, lte: endOfDay },
        },
        _sum: { itemTotal: true },
        _count: { id: true },
      }),

      // Comped items today — use itemTotal (price * quantity) for accurate dollar impact
      db.orderItem.aggregate({
        where: {
          locationId,
          deletedAt: null,
          status: 'comped',
          updatedAt: { gte: startOfDay, lte: endOfDay },
        },
        _sum: { itemTotal: true },
        _count: { id: true },
      }),

      // Discount totals from orders today
      // Use businessDayDate as primary boundary, fall back to createdAt
      db.order.aggregate({
        where: {
          locationId,
          deletedAt: null,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          OR: [
            { businessDayDate: { gte: startOfDay, lte: endOfDay } },
            { businessDayDate: null, createdAt: { gte: startOfDay, lte: endOfDay } },
          ],
          discountTotal: { gt: 0 },
        },
        _sum: { discountTotal: true },
      }),

      // Paid in/out today
      db.paidInOut.findMany({
        where: {
          locationId,
          deletedAt: null,
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
        select: {
          type: true,
          amount: true,
        },
      }),

      // Failed deductions
      (async () => {
        try {
          return await db.pendingDeduction.count({
            where: {
              locationId,
              OR: [
                { status: 'dead' },
                { status: 'failed', attempts: { gt: 3 } },
              ],
            },
          })
        } catch {
          // PendingDeduction model may not be migrated yet
          return 0
        }
      })(),
    ])

    // Calculate metrics
    const netSalesToday = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0)
    const checksToday = todayOrders.length
    const avgCheckSize = checksToday > 0 ? netSalesToday / checksToday : 0

    const netSalesLastWeekSameTime = lastWeekOrders.reduce((sum, o) => sum + Number(o.total || 0), 0)

    // Pacing: compare today vs last week at the same point in the day
    let salesPacingPct = 0
    if (netSalesLastWeekSameTime > 0) {
      salesPacingPct = ((netSalesToday - netSalesLastWeekSameTime) / netSalesLastWeekSameTime) * 100
    }

    const openTicketCount = openOrders.length
    const openTicketValue = openOrders.reduce((sum, o) => sum + Number(o.total || 0), 0)

    const voidsTotalToday = Number(voidItems._sum.itemTotal || 0)
    const compsTotalToday = Number(compItems._sum.itemTotal || 0)
    const discountsTotalToday = Number(discountedOrders._sum.discountTotal || 0)

    // Paid in/out
    let paidInTotal = 0
    let paidOutTotal = 0
    for (const pio of paidInOuts) {
      if (pio.type === 'in') paidInTotal += Number(pio.amount || 0)
      else paidOutTotal += Number(pio.amount || 0)
    }

    return NextResponse.json({
      data: {
        netSalesToday: Math.round(netSalesToday * 100) / 100,
        netSalesLastWeekSameDay: Math.round(netSalesLastWeekSameTime * 100) / 100,
        salesPacingPct: Math.round(salesPacingPct * 10) / 10,
        checksToday,
        avgCheckSize: Math.round(avgCheckSize * 100) / 100,
        openTicketCount,
        openTicketValue: Math.round(openTicketValue * 100) / 100,
        voidsTotalToday: Math.round(voidsTotalToday * 100) / 100,
        compsTotalToday: Math.round(compsTotalToday * 100) / 100,
        discountsTotalToday: Math.round(discountsTotalToday * 100) / 100,
        paidInTotal: Math.round(paidInTotal * 100) / 100,
        paidOutTotal: Math.round(paidOutTotal * 100) / 100,
        paidNetTotal: Math.round((paidInTotal - paidOutTotal) * 100) / 100,
        pendingDeductionsFailed,
        dayFraction: Math.round(dayFraction * 1000) / 1000,
        businessDate: current.date,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('Dashboard live API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

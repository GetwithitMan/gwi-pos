import { NextRequest, NextResponse } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getCurrentBusinessDay, getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { roundMoney } from '@/lib/domain/reports'
import {
  getTodayRevenueOrders,
  getOpenOrders,
  getVoidedItemsAggregate,
  getCompedItemsAggregate,
  getDiscountTotalAggregate,
  getPaidInOutTotals,
  getFailedDeductionCount,
} from '@/lib/query-services'

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

    const todayRange = { start: startOfDay, end: endOfDay }
    const lastWeekPacingEnd = new Date(lastWeekRange.start.getTime() + elapsedMs)

    // All queries in parallel via query services
    const [
      todayOrders,
      lastWeekOrders,
      openOrders,
      voidItems,
      compItems,
      discountsTotalToday,
      paidInOutTotals,
      pendingDeductionsFailed,
    ] = await Promise.all([
      getTodayRevenueOrders(locationId, todayRange),

      // Last week same day - orders closed up to the equivalent time of day
      getTodayRevenueOrders(locationId, { start: lastWeekRange.start, end: lastWeekPacingEnd }),

      getOpenOrders(locationId),
      getVoidedItemsAggregate(locationId, todayRange),
      getCompedItemsAggregate(locationId, todayRange),
      getDiscountTotalAggregate(locationId, todayRange),
      getPaidInOutTotals(locationId, todayRange),
      getFailedDeductionCount(locationId),
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

    const voidsTotalToday = voidItems.total
    const compsTotalToday = compItems.total

    // Paid in/out (already calculated by query service)
    const paidInTotal = paidInOutTotals.paidIn
    const paidOutTotal = paidInOutTotals.paidOut

    return NextResponse.json({
      data: {
        netSalesToday: roundMoney(netSalesToday),
        netSalesLastWeekSameDay: roundMoney(netSalesLastWeekSameTime),
        salesPacingPct: Math.round(salesPacingPct * 10) / 10,
        checksToday,
        avgCheckSize: roundMoney(avgCheckSize),
        openTicketCount,
        openTicketValue: roundMoney(openTicketValue),
        voidsTotalToday: roundMoney(voidsTotalToday),
        compsTotalToday: roundMoney(compsTotalToday),
        discountsTotalToday: roundMoney(discountsTotalToday),
        paidInTotal: roundMoney(paidInTotal),
        paidOutTotal: roundMoney(paidOutTotal),
        paidNetTotal: roundMoney(paidInTotal - paidOutTotal),
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

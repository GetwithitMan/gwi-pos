import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

type DayName = (typeof DAY_NAMES)[number]

interface DayBucket {
  totalRevenue: number
  totalOrders: number
  dayOccurrences: Set<string> // unique date strings that fell on this weekday
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// GET /api/reports/forecasting
// Query params: locationId (required), lookbackDays (default 84), forecastDays (default 14)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId =
      searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.REPORTS_SALES
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const lookbackDays = Math.max(
      1,
      parseInt(searchParams.get('lookbackDays') ?? '84', 10) || 84
    )
    const forecastDays = Math.max(
      1,
      parseInt(searchParams.get('forecastDays') ?? '14', 10) || 14
    )

    // Calculate lookback date range
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const startDate = new Date(today)
    startDate.setDate(today.getDate() - lookbackDays)

    // Fetch paid/closed orders in the lookback window using the businessDayDate OR-fallback pattern
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['paid', 'closed'] },
        deletedAt: null,
        OR: [
          { businessDayDate: { gte: startDate, lte: today } },
          { businessDayDate: null, paidAt: { gte: startDate, lte: today } },
        ],
      },
      select: {
        paidAt: true,
        businessDayDate: true,
        total: true,
        tipTotal: true,
      },
    })

    // Group orders by day-of-week (0=Sunday … 6=Saturday)
    const buckets: DayBucket[] = Array.from({ length: 7 }, () => ({
      totalRevenue: 0,
      totalOrders: 0,
      dayOccurrences: new Set<string>(),
    }))

    for (const order of orders) {
      // Prefer businessDayDate; fall back to paidAt
      const dateSource: Date | null = order.businessDayDate ?? order.paidAt
      if (!dateSource) continue

      const dayIndex = dateSource.getDay() // 0-6
      const dateKey = dateSource.toISOString().split('T')[0]

      buckets[dayIndex].totalRevenue += Number(order.total) || 0
      buckets[dayIndex].totalOrders += 1
      buckets[dayIndex].dayOccurrences.add(dateKey)
    }

    // Build day-of-week pattern rows (ordered Mon-Sun per spec, i.e. 1,2,3,4,5,6,0)
    const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

    const dayOfWeekPatterns = DOW_ORDER.map((dayIndex) => {
      const bucket = buckets[dayIndex]
      const sampleWeeks = bucket.dayOccurrences.size
      const avgRevenue =
        sampleWeeks > 0 ? round2(bucket.totalRevenue / sampleWeeks) : 0
      const avgOrders =
        sampleWeeks > 0
          ? Math.round(bucket.totalOrders / sampleWeeks)
          : 0

      return {
        day: DAY_NAMES[dayIndex] as DayName,
        dayIndex,
        avgRevenue,
        avgOrders,
        sampleWeeks,
      }
    })

    // Build forecast array for the next forecastDays calendar days
    const forecast: Array<{
      date: string
      dayOfWeek: DayName
      projectedRevenue: number
      projectedOrders: number
    }> = []

    for (let i = 1; i <= forecastDays; i++) {
      const forecastDate = new Date(today)
      forecastDate.setDate(today.getDate() + i)
      const dayIndex = forecastDate.getDay()
      const bucket = buckets[dayIndex]
      const sampleWeeks = bucket.dayOccurrences.size

      forecast.push({
        date: forecastDate.toISOString().split('T')[0],
        dayOfWeek: DAY_NAMES[dayIndex],
        projectedRevenue:
          sampleWeeks > 0 ? round2(bucket.totalRevenue / sampleWeeks) : 0,
        projectedOrders:
          sampleWeeks > 0
            ? Math.round(bucket.totalOrders / sampleWeeks)
            : 0,
      })
    }

    // Summary: strongest / weakest day by avgRevenue (from all 7 day patterns)
    const allPatterns = [...dayOfWeekPatterns]
    const strongest = allPatterns.reduce(
      (best, d) => (d.avgRevenue > best.avgRevenue ? d : best),
      allPatterns[0]
    )
    const weakest = allPatterns.reduce(
      (low, d) => (d.avgRevenue < low.avgRevenue ? d : low),
      allPatterns[0]
    )

    // Projected 7-day revenue: sum Mon-Sun from day-of-week averages (one representative week)
    const projectedWeekRevenue = round2(
      dayOfWeekPatterns.reduce((sum, d) => sum + d.avgRevenue, 0)
    )

    return NextResponse.json({
      data: {
        historicalPeriod: {
          startDate: startDate.toISOString().split('T')[0],
          endDate: today.toISOString().split('T')[0],
          ordersAnalyzed: orders.length,
          lookbackDays,
        },
        dayOfWeekPatterns,
        forecast,
        summary: {
          strongestDay: {
            day: strongest.day,
            avgRevenue: strongest.avgRevenue,
          },
          weakestDay: {
            day: weakest.day,
            avgRevenue: weakest.avgRevenue,
          },
          projectedWeekRevenue,
        },
      },
    })
  } catch (error) {
    console.error('Failed to generate forecasting report:', error)
    return NextResponse.json(
      { error: 'Failed to generate forecasting report' },
      { status: 500 }
    )
  }
})

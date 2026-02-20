import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// Hour label lookup: 0 → "12 AM", 1 → "1 AM", ..., 12 → "12 PM", 13 → "1 PM", etc.
function hourLabel(hour: number): string {
  if (hour === 0) return '12 AM'
  if (hour < 12) return `${hour} AM`
  if (hour === 12) return '12 PM'
  return `${hour - 12} PM`
}

interface HourBucket {
  orderCount: number
  revenue: number
  tipTotal: number
}

function buildHourlyBuckets(
  orders: Array<{ paidAt: Date | null; total: unknown; tipTotal: unknown }>
): HourBucket[] {
  const buckets: HourBucket[] = Array.from({ length: 24 }, () => ({
    orderCount: 0,
    revenue: 0,
    tipTotal: 0,
  }))

  for (const order of orders) {
    if (!order.paidAt) continue
    const hour = order.paidAt.getHours() // server-local time (venue timezone on NUC)
    buckets[hour].orderCount += 1
    buckets[hour].revenue += Number(order.total) || 0
    buckets[hour].tipTotal += Number(order.tipTotal) || 0
  }

  return buckets
}

// GET /api/reports/hourly
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date')
    const compareDateStr = searchParams.get('compareDate')
    const requestingEmployeeId =
      searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.REPORTS_SALES
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Fetch location settings for business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime

    // Resolve primary date range
    let dayStart: Date
    let dayEnd: Date
    let resolvedDate: string

    if (dateStr) {
      const range = getBusinessDayRange(dateStr, dayStartTime)
      dayStart = range.start
      dayEnd = range.end
      resolvedDate = dateStr
    } else {
      const current = getCurrentBusinessDay(dayStartTime)
      dayStart = current.start
      dayEnd = current.end
      resolvedDate = current.date
    }

    // Fetch primary day orders
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['paid', 'closed'] },
        deletedAt: null,
        paidAt: { gte: dayStart, lt: dayEnd },
      },
      select: {
        paidAt: true,
        total: true,
        tipTotal: true,
      },
    })

    // Build primary hourly buckets
    const primaryBuckets = buildHourlyBuckets(orders)

    // Build hours array (all 24 hours)
    const hours = primaryBuckets.map((bucket, hour) => ({
      hour,
      label: hourLabel(hour),
      orderCount: bucket.orderCount,
      revenue: round(bucket.revenue),
      avgOrderValue: bucket.orderCount > 0 ? round(bucket.revenue / bucket.orderCount) : 0,
      tipTotal: round(bucket.tipTotal),
    }))

    // Summary
    const totalRevenue = hours.reduce((sum, h) => sum + h.revenue, 0)
    const totalOrders = hours.reduce((sum, h) => sum + h.orderCount, 0)
    const peakHourEntry = hours.reduce(
      (best, h) => (h.revenue > best.revenue ? h : best),
      hours[0]
    )

    const summary = {
      peakHour: peakHourEntry.hour,
      peakHourLabel: peakHourEntry.label,
      peakRevenue: round(peakHourEntry.revenue),
      totalRevenue: round(totalRevenue),
      totalOrders,
      avgOrderValue: totalOrders > 0 ? round(totalRevenue / totalOrders) : 0,
    }

    // Optional compare date
    let compareDate: string | undefined
    let compareHours: typeof hours | undefined

    if (compareDateStr) {
      const compareRange = getBusinessDayRange(compareDateStr, dayStartTime)
      const compareOrders = await db.order.findMany({
        where: {
          locationId,
          status: { in: ['paid', 'closed'] },
          deletedAt: null,
          paidAt: { gte: compareRange.start, lt: compareRange.end },
        },
        select: {
          paidAt: true,
          total: true,
          tipTotal: true,
        },
      })

      const compareBuckets = buildHourlyBuckets(compareOrders)
      compareDate = compareDateStr
      compareHours = compareBuckets.map((bucket, hour) => ({
        hour,
        label: hourLabel(hour),
        orderCount: bucket.orderCount,
        revenue: round(bucket.revenue),
        avgOrderValue: bucket.orderCount > 0 ? round(bucket.revenue / bucket.orderCount) : 0,
        tipTotal: round(bucket.tipTotal),
      }))
    }

    return NextResponse.json({
      data: {
        date: resolvedDate,
        hours,
        ...(compareDate !== undefined && { compareDate }),
        ...(compareHours !== undefined && { compareHours }),
        summary,
      },
    })
  } catch (error) {
    console.error('Failed to generate hourly sales report:', error)
    return NextResponse.json(
      { error: 'Failed to generate hourly sales report' },
      { status: 500 }
    )
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}

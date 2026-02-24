import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

interface DaypartConfig {
  name: string
  startHour: number
  endHour: number
}

const DEFAULT_DAYPARTS: DaypartConfig[] = [
  { name: 'Morning', startHour: 6, endHour: 11 },
  { name: 'Lunch', startHour: 11, endHour: 14 },
  { name: 'Afternoon', startHour: 14, endHour: 17 },
  { name: 'Dinner', startHour: 17, endHour: 21 },
  { name: 'Late Night', startHour: 21, endHour: 26 }, // 26 = 2 AM next day
  { name: 'Overnight', startHour: 2, endHour: 6 },
]

function getHourOfDay(date: Date): number {
  return date.getHours()
}

function getDaypartIndex(hour: number, dayparts: DaypartConfig[]): number {
  for (let i = 0; i < dayparts.length; i++) {
    const dp = dayparts[i]
    if (dp.endHour > 24) {
      // Wraps past midnight (e.g., 21-26 means 21:00 to 02:00)
      if (hour >= dp.startHour || hour < (dp.endHour - 24)) return i
    } else {
      if (hour >= dp.startHour && hour < dp.endHour) return i
    }
  }
  return -1
}

export const GET = withVenue(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const dayparts = DEFAULT_DAYPARTS

    // Date range
    const start = startDate
      ? new Date(startDate + 'T00:00:00')
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()
    const end = endDate
      ? new Date(endDate + 'T23:59:59.999')
      : new Date()

    // Fetch paid orders in range
    const orders = await db.order.findMany({
      where: {
        locationId,
        deletedAt: null,
        status: 'paid',
        paidAt: { gte: start, lte: end },
      },
      select: {
        id: true,
        paidAt: true,
        subtotal: true,
        total: true,
        tipTotal: true,
        guestCount: true,
      },
    })

    // Initialize buckets
    const buckets = dayparts.map(dp => ({
      name: dp.name,
      startHour: dp.startHour,
      endHour: dp.endHour > 24 ? dp.endHour - 24 : dp.endHour,
      orderCount: 0,
      revenue: 0,
      avgCheck: 0,
      covers: 0,
      tipTotal: 0,
    }))

    // Group orders into dayparts
    for (const order of orders) {
      if (!order.paidAt) continue
      const hour = getHourOfDay(order.paidAt)
      const idx = getDaypartIndex(hour, dayparts)
      if (idx >= 0) {
        buckets[idx].orderCount += 1
        buckets[idx].revenue += Number(order.subtotal || 0)
        buckets[idx].covers += Number(order.guestCount || 1)
        buckets[idx].tipTotal += Number(order.tipTotal || 0)
      }
    }

    // Calculate averages
    for (const bucket of buckets) {
      bucket.avgCheck = bucket.orderCount > 0 ? Math.round((bucket.revenue / bucket.orderCount) * 100) / 100 : 0
    }

    // Totals
    const totalOrders = buckets.reduce((s, b) => s + b.orderCount, 0)
    const totalRevenue = buckets.reduce((s, b) => s + b.revenue, 0)
    const totalCovers = buckets.reduce((s, b) => s + b.covers, 0)
    const totalTips = buckets.reduce((s, b) => s + b.tipTotal, 0)

    return NextResponse.json({
      data: {
        dayparts: buckets,
        totals: {
          orderCount: totalOrders,
          revenue: Math.round(totalRevenue * 100) / 100,
          covers: totalCovers,
          tipTotal: Math.round(totalTips * 100) / 100,
          avgCheck: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
        },
        filters: {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0],
        },
      },
    })
  } catch (error) {
    console.error('Daypart report error:', error)
    return NextResponse.json({ error: 'Failed to generate daypart report' }, { status: 500 })
  }
})

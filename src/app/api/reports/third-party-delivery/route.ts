/**
 * Third-Party Delivery Report API
 *
 * GET /api/reports/third-party-delivery?locationId=...&startDate=...&endDate=...
 *
 * Per platform: order count, revenue, average order value, cancellation rate.
 * Combined metrics: total third-party revenue, % of total sales.
 * Trend data by day.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'

function toNum(val: unknown): number {
  if (typeof val === 'object' && val && 'toNumber' in val) {
    return (val as { toNumber: () => number }).toNumber()
  }
  return Number(val) || 0
}

interface OrderRow {
  id: string
  platform: string
  status: string
  subtotal: unknown
  tax: unknown
  deliveryFee: unknown
  tip: unknown
  total: unknown
  createdAt: Date
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId') || searchParams.get('requestingEmployeeId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }
    if (!startDate) {
      return NextResponse.json({ error: 'startDate is required' }, { status: 400 })
    }

    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    const startRange = getBusinessDayRange(startDate, dayStartTime, timezone)
    const endRange = endDate
      ? getBusinessDayRange(endDate, dayStartTime, timezone)
      : startRange

    // Fetch all third-party orders in range
    const rows = await db.$queryRawUnsafe<OrderRow[]>(
      `SELECT "id", "platform", "status", "subtotal", "tax", "deliveryFee", "tip", "total", "createdAt"
       FROM "ThirdPartyOrder"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL
         AND "createdAt" >= $2 AND "createdAt" <= $3
       ORDER BY "createdAt" ASC`,
      locationId,
      startRange.start,
      endRange.end,
    )

    // ── Per-platform aggregation ────────────────────────────────────────────

    const platforms = ['doordash', 'ubereats', 'grubhub'] as const
    const platformStats: Record<string, {
      orderCount: number
      cancelledCount: number
      subtotal: number
      tax: number
      deliveryFee: number
      tip: number
      total: number
    }> = {}

    for (const p of platforms) {
      platformStats[p] = {
        orderCount: 0,
        cancelledCount: 0,
        subtotal: 0,
        tax: 0,
        deliveryFee: 0,
        tip: 0,
        total: 0,
      }
    }

    // Daily trend buckets
    const dailyMap = new Map<string, {
      date: string
      doordash: number
      ubereats: number
      grubhub: number
      total: number
    }>()

    for (const row of rows) {
      const p = row.platform
      if (!platformStats[p]) continue

      platformStats[p].orderCount++
      if (row.status === 'cancelled') {
        platformStats[p].cancelledCount++
      }

      const total = toNum(row.total)
      platformStats[p].subtotal += toNum(row.subtotal)
      platformStats[p].tax += toNum(row.tax)
      platformStats[p].deliveryFee += toNum(row.deliveryFee)
      platformStats[p].tip += toNum(row.tip)
      platformStats[p].total += total

      // Daily trend
      const dateKey = row.createdAt instanceof Date
        ? row.createdAt.toISOString().split('T')[0]
        : new Date(row.createdAt).toISOString().split('T')[0]

      if (!dailyMap.has(dateKey)) {
        dailyMap.set(dateKey, { date: dateKey, doordash: 0, ubereats: 0, grubhub: 0, total: 0 })
      }
      const day = dailyMap.get(dateKey)!
      if (p === 'doordash') day.doordash += total
      else if (p === 'ubereats') day.ubereats += total
      else if (p === 'grubhub') day.grubhub += total
      day.total += total
    }

    // Build per-platform summary
    const platformSummary = platforms.map(p => {
      const stats = platformStats[p]
      const nonCancelled = stats.orderCount - stats.cancelledCount
      return {
        platform: p,
        orderCount: stats.orderCount,
        cancelledCount: stats.cancelledCount,
        cancellationRate: stats.orderCount > 0
          ? Math.round((stats.cancelledCount / stats.orderCount) * 10000) / 100
          : 0,
        subtotal: Math.round(stats.subtotal * 100) / 100,
        tax: Math.round(stats.tax * 100) / 100,
        deliveryFee: Math.round(stats.deliveryFee * 100) / 100,
        tip: Math.round(stats.tip * 100) / 100,
        total: Math.round(stats.total * 100) / 100,
        averageOrderValue: nonCancelled > 0
          ? Math.round((stats.total / nonCancelled) * 100) / 100
          : 0,
      }
    })

    // Combined totals
    const totalOrders = rows.length
    const totalCancelled = rows.filter(r => r.status === 'cancelled').length
    const totalRevenue = rows.reduce((sum, r) => sum + toNum(r.total), 0)

    // Get total POS sales for percentage calculation
    let totalPosSales = 0
    try {
      const salesResult = await db.$queryRawUnsafe<Array<{ total: unknown }>>(
        `SELECT COALESCE(SUM("total"), 0) as total FROM "Order"
         WHERE "locationId" = $1 AND "deletedAt" IS NULL
           AND "createdAt" >= $2 AND "createdAt" <= $3
           AND "status" NOT IN ('voided', 'cancelled')`,
        locationId,
        startRange.start,
        endRange.end,
      )
      totalPosSales = toNum(salesResult[0]?.total || 0)
    } catch {
      // If Order table query fails, just skip percentage
    }

    const dailyTrend = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    return NextResponse.json({
      data: {
        summary: {
          totalOrders,
          totalCancelled,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          averageOrderValue: totalOrders > 0
            ? Math.round((totalRevenue / totalOrders) * 100) / 100
            : 0,
          percentOfTotalSales: totalPosSales > 0
            ? Math.round((totalRevenue / totalPosSales) * 10000) / 100
            : 0,
          cancellationRate: totalOrders > 0
            ? Math.round((totalCancelled / totalOrders) * 10000) / 100
            : 0,
        },
        platforms: platformSummary,
        dailyTrend,
        dateRange: {
          start: startRange.start.toISOString(),
          end: endRange.end.toISOString(),
        },
      },
    })
  } catch (error) {
    console.error('[GET /api/reports/third-party-delivery] Error:', error)
    return NextResponse.json({ error: 'Failed to generate delivery report' }, { status: 500 })
  }
})

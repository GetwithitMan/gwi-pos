import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/delivery — Delivery performance report
 *
 * Query params: dateFrom, dateTo
 *
 * Metrics: total deliveries, average delivery time, on-time %,
 *          per-driver stats, delivery revenue, fee revenue
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Default: today
    const startDate = dateFrom ? new Date(dateFrom) : new Date(new Date().setHours(0, 0, 0, 0))
    const endDate = dateTo ? new Date(dateTo) : new Date()

    // Overall metrics
    const overallStats: any[] = await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE status = 'delivered')::int as "completedDeliveries",
        COUNT(*) FILTER (WHERE status = 'cancelled')::int as "cancelledDeliveries",
        COUNT(*) FILTER (WHERE status IN ('pending', 'preparing', 'ready_for_pickup', 'out_for_delivery'))::int as "activeDeliveries",
        AVG(
          CASE WHEN "deliveredAt" IS NOT NULL AND "dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM ("deliveredAt" - "dispatchedAt")) / 60
          END
        )::float as "avgDeliveryMinutes",
        AVG(
          CASE WHEN "deliveredAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60
          END
        )::float as "avgTotalMinutes",
        COALESCE(SUM("deliveryFee"), 0)::float as "totalFeeRevenue",
        COUNT(*) FILTER (
          WHERE "deliveredAt" IS NOT NULL
          AND EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60 <= "estimatedMinutes"
        )::int as "onTimeCount"
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
    `, locationId, startDate, endDate)

    const stats = overallStats[0] || {}
    const completedCount = stats.completedDeliveries || 0
    const onTimePercent = completedCount > 0
      ? Math.round((stats.onTimeCount / completedCount) * 100)
      : 0

    // Per-driver stats
    const driverStats: any[] = await db.$queryRawUnsafe(`
      SELECT
        d."driverId",
        e."firstName",
        e."lastName",
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE d.status = 'delivered')::int as "completedDeliveries",
        AVG(
          CASE WHEN d."deliveredAt" IS NOT NULL AND d."dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (d."deliveredAt" - d."dispatchedAt")) / 60
          END
        )::float as "avgDeliveryMinutes",
        COUNT(*) FILTER (
          WHERE d."deliveredAt" IS NOT NULL
          AND EXTRACT(EPOCH FROM (d."deliveredAt" - d."createdAt")) / 60 <= d."estimatedMinutes"
        )::int as "onTimeCount"
      FROM "DeliveryOrder" d
      JOIN "Employee" e ON e.id = d."driverId"
      WHERE d."locationId" = $1
        AND d."createdAt" >= $2
        AND d."createdAt" <= $3
        AND d."driverId" IS NOT NULL
      GROUP BY d."driverId", e."firstName", e."lastName"
      ORDER BY "completedDeliveries" DESC
    `, locationId, startDate, endDate)

    const driverMetrics = driverStats.map(d => ({
      driverId: d.driverId,
      name: `${d.firstName} ${d.lastName}`.trim(),
      totalDeliveries: d.totalDeliveries,
      completedDeliveries: d.completedDeliveries,
      avgDeliveryMinutes: d.avgDeliveryMinutes ? Math.round(d.avgDeliveryMinutes) : null,
      onTimePercent: d.completedDeliveries > 0
        ? Math.round((d.onTimeCount / d.completedDeliveries) * 100)
        : 0,
    }))

    // Delivery revenue (order totals for delivered orders)
    const revenueResult: any[] = await db.$queryRawUnsafe(`
      SELECT COALESCE(SUM(sub.subtotal), 0)::float as "totalRevenue"
      FROM (
        SELECT COALESCE(SUM(oi.price * oi.quantity), 0) as subtotal
        FROM "DeliveryOrder" d
        JOIN "Order" o ON o.id = d."orderId"
        JOIN "OrderItem" oi ON oi."orderId" = o.id AND oi."deletedAt" IS NULL AND oi."voidedAt" IS NULL
        WHERE d."locationId" = $1
          AND d."createdAt" >= $2
          AND d."createdAt" <= $3
          AND d.status = 'delivered'
        GROUP BY d.id
      ) sub
    `, locationId, startDate, endDate)

    // Hourly distribution
    const hourlyDist: any[] = await db.$queryRawUnsafe(`
      SELECT
        EXTRACT(HOUR FROM "createdAt")::int as hour,
        COUNT(*)::int as count
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
      GROUP BY hour
      ORDER BY hour
    `, locationId, startDate, endDate)

    return NextResponse.json({
      data: {
        dateRange: {
          from: startDate.toISOString(),
          to: endDate.toISOString(),
        },
        summary: {
          totalDeliveries: stats.totalDeliveries || 0,
          completedDeliveries: completedCount,
          cancelledDeliveries: stats.cancelledDeliveries || 0,
          activeDeliveries: stats.activeDeliveries || 0,
          avgDeliveryMinutes: stats.avgDeliveryMinutes ? Math.round(stats.avgDeliveryMinutes) : null,
          avgTotalMinutes: stats.avgTotalMinutes ? Math.round(stats.avgTotalMinutes) : null,
          onTimePercent,
          totalFeeRevenue: stats.totalFeeRevenue || 0,
          totalDeliveryRevenue: revenueResult[0]?.totalRevenue || 0,
        },
        driverMetrics,
        hourlyDistribution: hourlyDist,
      },
    })
  } catch (error) {
    console.error('[Reports/Delivery] GET error:', error)
    return NextResponse.json({ error: 'Failed to generate delivery report' }, { status: 500 })
  }
})

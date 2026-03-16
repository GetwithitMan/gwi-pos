import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/delivery — Delivery analytics report
 *
 * Query params: startDate, endDate, groupBy? (zone|driver|day)
 *
 * Metrics:
 *   - Total deliveries, completed, failed, cancelled
 *   - On-time % (delivered within promisedAt or estimatedMinutes)
 *   - Avg door-to-door time (dispatchedAt -> deliveredAt)
 *   - Per-zone breakdown: count, avg time, revenue (deliveryFee sum)
 *   - Per-driver breakdown: count, avg time, on-time %
 *   - Cash variance total
 *   - Cost per delivery (mileage + per-delivery pay)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_REPORTS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'deliveryReportsProvisioned' })
    if (featureGate) return featureGate

    const searchParams = request.nextUrl.searchParams
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const groupBy = searchParams.get('groupBy') // zone | driver | day

    // Default: today
    const startDate = startDateParam ? new Date(startDateParam) : new Date(new Date().setHours(0, 0, 0, 0))
    const endDate = endDateParam ? new Date(endDateParam) : new Date()

    // ── Summary Metrics ────────────────────────────────────────────────────────
    const summaryRows: any[] = await db.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE status = 'delivered')::int as "completedDeliveries",
        COUNT(*) FILTER (WHERE status IN ('failed_delivery', 'returned_to_store'))::int as "failedDeliveries",
        COUNT(*) FILTER (WHERE status IN ('cancelled_before_dispatch', 'cancelled_after_dispatch'))::int as "cancelledDeliveries",
        COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'failed_delivery', 'returned_to_store', 'cancelled_before_dispatch', 'cancelled_after_dispatch'))::int as "activeDeliveries",
        AVG(
          CASE WHEN "deliveredAt" IS NOT NULL AND "dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM ("deliveredAt" - "dispatchedAt")) / 60
          END
        )::float as "avgDoorToDoorMinutes",
        AVG(
          CASE WHEN "deliveredAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60
          END
        )::float as "avgTotalMinutes",
        COALESCE(SUM("deliveryFee"), 0)::float as "totalFeeRevenue",
        COUNT(*) FILTER (
          WHERE "deliveredAt" IS NOT NULL
          AND (
            ("promisedAt" IS NOT NULL AND "deliveredAt" <= "promisedAt")
            OR
            ("promisedAt" IS NULL AND "estimatedMinutes" IS NOT NULL
             AND EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60 <= "estimatedMinutes")
          )
        )::int as "onTimeCount"
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
    `, locationId, startDate, endDate)

    const summary = summaryRows[0] || {}
    const completedCount = summary.completedDeliveries || 0
    const onTimePercent = completedCount > 0
      ? Math.round((summary.onTimeCount / completedCount) * 100)
      : 0

    // ── Cash Variance Total ─────────────────────────────────────────────────────
    const varianceRows: any[] = await db.$queryRawUnsafe(`
      SELECT COALESCE(SUM("cashCollectedCents" - "cashExpectedCents"), 0)::int as "totalVarianceCents"
      FROM "DeliveryDriverSession"
      WHERE "locationId" = $1
        AND "startedAt" >= $2
        AND "startedAt" <= $3
        AND "endedAt" IS NOT NULL
    `, locationId, startDate, endDate)
    const totalVarianceCents = varianceRows[0]?.totalVarianceCents || 0

    // ── Per-Zone Breakdown ──────────────────────────────────────────────────────
    const byZone: any[] = await db.$queryRawUnsafe(`
      SELECT
        dz.id as "zoneId",
        dz."name" as "zoneName",
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE do_.status = 'delivered')::int as "completedDeliveries",
        AVG(
          CASE WHEN do_."deliveredAt" IS NOT NULL AND do_."dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (do_."deliveredAt" - do_."dispatchedAt")) / 60
          END
        )::float as "avgDoorToDoorMinutes",
        COALESCE(SUM(do_."deliveryFee"), 0)::float as "feeRevenue"
      FROM "DeliveryOrder" do_
      LEFT JOIN "DeliveryZone" dz ON dz.id = do_."zoneId"
      WHERE do_."locationId" = $1
        AND do_."createdAt" >= $2
        AND do_."createdAt" <= $3
      GROUP BY dz.id, dz."name"
      ORDER BY "completedDeliveries" DESC
    `, locationId, startDate, endDate)

    const byZoneEnriched = byZone.map(z => ({
      zoneId: z.zoneId,
      zoneName: z.zoneName || 'Unzoned',
      totalDeliveries: z.totalDeliveries,
      completedDeliveries: z.completedDeliveries,
      avgDoorToDoorMinutes: z.avgDoorToDoorMinutes ? Math.round(z.avgDoorToDoorMinutes) : null,
      feeRevenue: z.feeRevenue,
    }))

    // ── Per-Driver Breakdown ────────────────────────────────────────────────────
    const byDriver: any[] = await db.$queryRawUnsafe(`
      SELECT
        dd.id as "driverId",
        e."firstName", e."lastName",
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE do_.status = 'delivered')::int as "completedDeliveries",
        AVG(
          CASE WHEN do_."deliveredAt" IS NOT NULL AND do_."dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (do_."deliveredAt" - do_."dispatchedAt")) / 60
          END
        )::float as "avgDoorToDoorMinutes",
        COUNT(*) FILTER (
          WHERE do_."deliveredAt" IS NOT NULL
          AND (
            (do_."promisedAt" IS NOT NULL AND do_."deliveredAt" <= do_."promisedAt")
            OR
            (do_."promisedAt" IS NULL AND do_."estimatedMinutes" IS NOT NULL
             AND EXTRACT(EPOCH FROM (do_."deliveredAt" - do_."createdAt")) / 60 <= do_."estimatedMinutes")
          )
        )::int as "onTimeCount"
      FROM "DeliveryOrder" do_
      JOIN "DeliveryDriver" dd ON dd.id = do_."driverId"
      JOIN "Employee" e ON e.id = dd."employeeId"
      WHERE do_."locationId" = $1
        AND do_."createdAt" >= $2
        AND do_."createdAt" <= $3
        AND do_."driverId" IS NOT NULL
      GROUP BY dd.id, e."firstName", e."lastName"
      ORDER BY "completedDeliveries" DESC
    `, locationId, startDate, endDate)

    const byDriverEnriched = byDriver.map(d => ({
      driverId: d.driverId,
      name: `${d.firstName} ${d.lastName}`.trim(),
      totalDeliveries: d.totalDeliveries,
      completedDeliveries: d.completedDeliveries,
      avgDoorToDoorMinutes: d.avgDoorToDoorMinutes ? Math.round(d.avgDoorToDoorMinutes) : null,
      onTimePercent: d.completedDeliveries > 0
        ? Math.round((d.onTimeCount / d.completedDeliveries) * 100)
        : 0,
    }))

    // ── Per-Day Breakdown ───────────────────────────────────────────────────────
    const byDay: any[] = await db.$queryRawUnsafe(`
      SELECT
        DATE("createdAt") as "date",
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE status = 'delivered')::int as "completedDeliveries",
        COUNT(*) FILTER (WHERE status IN ('failed_delivery', 'returned_to_store'))::int as "failedDeliveries",
        COUNT(*) FILTER (WHERE status IN ('cancelled_before_dispatch', 'cancelled_after_dispatch'))::int as "cancelledDeliveries",
        AVG(
          CASE WHEN "deliveredAt" IS NOT NULL AND "dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM ("deliveredAt" - "dispatchedAt")) / 60
          END
        )::float as "avgDoorToDoorMinutes",
        COALESCE(SUM("deliveryFee"), 0)::float as "feeRevenue"
      FROM "DeliveryOrder"
      WHERE "locationId" = $1
        AND "createdAt" >= $2
        AND "createdAt" <= $3
      GROUP BY DATE("createdAt")
      ORDER BY "date" ASC
    `, locationId, startDate, endDate)

    const byDayEnriched = byDay.map(d => ({
      date: d.date,
      totalDeliveries: d.totalDeliveries,
      completedDeliveries: d.completedDeliveries,
      failedDeliveries: d.failedDeliveries,
      cancelledDeliveries: d.cancelledDeliveries,
      avgDoorToDoorMinutes: d.avgDoorToDoorMinutes ? Math.round(d.avgDoorToDoorMinutes) : null,
      feeRevenue: d.feeRevenue,
    }))

    // ── Cost Per Delivery ───────────────────────────────────────────────────────
    // Sum of mileage cost + per-delivery pay from driver sessions in the period
    const costRows: any[] = await db.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(ds."totalMileageCostCents"), 0)::int as "totalMileageCostCents",
        COALESCE(SUM(ds."totalDeliveryPayCents"), 0)::int as "totalDeliveryPayCents"
      FROM "DeliveryDriverSession" ds
      WHERE ds."locationId" = $1
        AND ds."startedAt" >= $2
        AND ds."startedAt" <= $3
        AND ds."endedAt" IS NOT NULL
    `, locationId, startDate, endDate)

    const totalCostCents = (costRows[0]?.totalMileageCostCents || 0) + (costRows[0]?.totalDeliveryPayCents || 0)
    const costPerDelivery = completedCount > 0
      ? Math.round(totalCostCents / completedCount) / 100
      : 0

    return NextResponse.json({
      report: {
        dateRange: {
          from: startDate.toISOString(),
          to: endDate.toISOString(),
        },
        summary: {
          totalDeliveries: summary.totalDeliveries || 0,
          completedDeliveries: completedCount,
          failedDeliveries: summary.failedDeliveries || 0,
          cancelledDeliveries: summary.cancelledDeliveries || 0,
          activeDeliveries: summary.activeDeliveries || 0,
          onTimePercent,
          avgDoorToDoorMinutes: summary.avgDoorToDoorMinutes ? Math.round(summary.avgDoorToDoorMinutes) : null,
          avgTotalMinutes: summary.avgTotalMinutes ? Math.round(summary.avgTotalMinutes) : null,
          totalFeeRevenue: summary.totalFeeRevenue || 0,
          cashVarianceCents: totalVarianceCents,
          costPerDelivery,
        },
        byZone: byZoneEnriched,
        byDriver: byDriverEnriched,
        byDay: byDayEnriched,
      },
    })
  } catch (error) {
    console.error('[Reports/Delivery] GET error:', error)
    return NextResponse.json({ error: 'Failed to generate delivery report' }, { status: 500 })
  }
})

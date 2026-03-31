import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { err, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/drivers/[id]/scorecard — Driver performance scorecard
 *
 * Query params: dateFrom?, dateTo? (ISO strings, defaults to last 30 days)
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: driverId } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_REPORTS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Verify driver exists at this location
    const driverRows: any[] = await db.$queryRaw`
      SELECT id, "employeeId" FROM "DeliveryDriver"
      WHERE id = ${driverId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `

    if (!driverRows.length) {
      return notFound('Driver not found')
    }

    const driver = driverRows[0]

    // Date range
    const searchParams = request.nextUrl.searchParams
    const dateFrom = searchParams.get('dateFrom')
      ? new Date(searchParams.get('dateFrom')!)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    const dateTo = searchParams.get('dateTo')
      ? new Date(searchParams.get('dateTo')!)
      : new Date()

    // Total deliveries and on-time % from DeliveryOrder
    const deliveryStats: any[] = await db.$queryRaw`
      SELECT
        COUNT(*)::int as "totalDeliveries",
        COUNT(*) FILTER (WHERE dord."status" = 'delivered')::int as "completedDeliveries",
        COUNT(*) FILTER (
          WHERE dord."status" = 'delivered'
            AND dord."deliveredAt" IS NOT NULL
            AND dord."createdAt" IS NOT NULL
            AND EXTRACT(EPOCH FROM (dord."deliveredAt" - dord."createdAt")) / 60 <= dord."estimatedMinutes"
        )::int as "onTimeDeliveries",
        ROUND(AVG(
          CASE WHEN dord."status" = 'delivered' AND dord."deliveredAt" IS NOT NULL AND dord."dispatchedAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (dord."deliveredAt" - dord."dispatchedAt")) / 60
          END
        )::numeric, 1) as "avgDoorToDoorMinutes"
      FROM "DeliveryOrder" dord
      WHERE dord."driverId" = ${driver.employeeId}
        AND dord."locationId" = ${locationId}
        AND dord."createdAt" >= ${dateFrom}
        AND dord."createdAt" <= ${dateTo}
    `

    const stats = deliveryStats[0] || {}
    const completedDeliveries = stats.completedDeliveries ?? 0
    const onTimeDeliveries = stats.onTimeDeliveries ?? 0
    const onTimePercent = completedDeliveries > 0
      ? Math.round((onTimeDeliveries / completedDeliveries) * 100)
      : 0

    // Cash variance from sessions (sum of cashCollected - cashDropped - expected)
    const cashStats: any[] = await db.$queryRaw`
      SELECT
        COALESCE(SUM(ds."cashCollectedCents"), 0)::int as "totalCashCollectedCents",
        COALESCE(SUM(ds."cashDroppedCents"), 0)::int as "totalCashDroppedCents"
      FROM "DeliveryDriverSession" ds
      WHERE ds."driverId" = ${driverId}
        AND ds."locationId" = ${locationId}
        AND ds."startedAt" >= ${dateFrom}
        AND ds."startedAt" <= ${dateTo}
        AND ds."endedAt" IS NOT NULL
    `

    const cashData = cashStats[0] || {}
    const cashVarianceTotalCents =
      (cashData.totalCashCollectedCents ?? 0) - (cashData.totalCashDroppedCents ?? 0)

    // Proof compliance % — orders requiring proof vs orders with proof uploaded
    // Proof data lives in DeliveryProofOfDelivery table, not on DeliveryOrder columns
    const proofStats: any[] = await db.$queryRaw`
      SELECT
        COUNT(*) FILTER (WHERE dord."proofMode" IS NOT NULL AND dord."proofMode" != 'none')::int as "totalRequiringProof",
        COUNT(DISTINCT pod."deliveryOrderId") FILTER (WHERE pod."id" IS NOT NULL)::int as "proofProvided"
      FROM "DeliveryOrder" dord
      LEFT JOIN "DeliveryProofOfDelivery" pod ON pod."deliveryOrderId" = dord."id" AND pod."deletedAt" IS NULL
      WHERE dord."driverId" = ${driver.employeeId}
        AND dord."locationId" = ${locationId}
        AND dord."status" = 'delivered'
        AND dord."createdAt" >= ${dateFrom}
        AND dord."createdAt" <= ${dateTo}
    `

    const proofData = proofStats[0] || {}
    const proofCompliancePercent = (proofData.totalRequiringProof ?? 0) > 0
      ? Math.round(((proofData.proofProvided ?? 0) / proofData.totalRequiringProof) * 100)
      : 100

    // Deliveries per hour from sessions
    const sessionHours: any[] = await db.$queryRaw`
      SELECT
        COALESCE(SUM(EXTRACT(EPOCH FROM (ds."endedAt" - ds."startedAt")) / 3600), 0)::float as "totalHours"
      FROM "DeliveryDriverSession" ds
      WHERE ds."driverId" = ${driverId}
        AND ds."locationId" = ${locationId}
        AND ds."startedAt" >= ${dateFrom}
        AND ds."startedAt" <= ${dateTo}
        AND ds."endedAt" IS NOT NULL
    `

    const totalHours = sessionHours[0]?.totalHours ?? 0
    const deliveriesPerHour = totalHours > 0
      ? Math.round((completedDeliveries / totalHours) * 10) / 10
      : 0

    return ok({
      scorecard: {
        driverId,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        totalDeliveries: stats.totalDeliveries ?? 0,
        completedDeliveries,
        onTimePercent,
        avgDoorToDoorMinutes: stats.avgDoorToDoorMinutes != null ? Number(stats.avgDoorToDoorMinutes) : null,
        cashVarianceTotalCents,
        proofCompliancePercent,
        deliveriesPerHour,
        totalSessionHours: Math.round(totalHours * 10) / 10,
      },
    })
  } catch (error) {
    console.error('[Delivery/Drivers/Scorecard] GET error:', error)
    return err('Failed to fetch scorecard', 500)
  }
})

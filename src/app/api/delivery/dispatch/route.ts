import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/dispatch — Full dispatch board data (aggregate endpoint)
 *
 * Returns all data needed to render the dispatch board in a single request:
 * orders, runs, drivers, exceptions, zones, stats.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate — require dispatch board provisioned
    const featureGate = await requireDeliveryFeature(locationId, {
      subfeature: 'dispatchBoardProvisioned',
    })
    if (featureGate) return featureGate

    // Run all queries in parallel for speed
    const [
      ordersResult,
      runsResult,
      driversResult,
      exceptionsResult,
      zonesResult,
      statsResult,
    ] = await Promise.all([
      // 1. Active delivery orders (not terminal)
      db.$queryRawUnsafe<any[]>(`
        SELECT d.*,
               o."orderNumber", o."status" as "orderStatus", o."total" as "orderTotal",
               dz."name" as "zoneName", dz."color" as "zoneColor",
               e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
        FROM "DeliveryOrder" d
        LEFT JOIN "Order" o ON o.id = d."orderId"
        LEFT JOIN "DeliveryZone" dz ON dz.id = d."zoneId"
        LEFT JOIN "Employee" e ON e.id = d."driverId"
        WHERE d."locationId" = $1
          AND d.status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
        ORDER BY
          CASE d."status"
            WHEN 'pending' THEN 1
            WHEN 'confirmed' THEN 2
            WHEN 'preparing' THEN 3
            WHEN 'ready_for_pickup' THEN 4
            WHEN 'assigned' THEN 5
            WHEN 'dispatched' THEN 6
            WHEN 'en_route' THEN 7
            WHEN 'arrived' THEN 8
            WHEN 'attempted' THEN 9
            WHEN 'redelivery_pending' THEN 10
          END,
          d."createdAt" ASC
      `, locationId),

      // 2. Active runs with driver info
      db.$queryRawUnsafe<any[]>(`
        SELECT r.*,
               dd."vehicleType", dd."vehicleMake", dd."vehicleModel", dd."vehicleColor", dd."licensePlate",
               e."firstName" as "driverFirstName", e."lastName" as "driverLastName",
               (
                 SELECT COUNT(*)::int
                 FROM "DeliveryOrder" dord
                 WHERE dord."runId" = r.id
               ) as "orderCount"
        FROM "DeliveryRun" r
        LEFT JOIN "DeliveryDriver" dd ON dd.id = r."driverId"
        LEFT JOIN "Employee" e ON e.id = dd."employeeId"
        WHERE r."locationId" = $1
          AND r.status NOT IN ('completed', 'returned', 'cancelled')
        ORDER BY r."createdAt" ASC
      `, locationId),

      // 3. Active driver sessions with last GPS
      db.$queryRawUnsafe<any[]>(`
        SELECT ds.*,
               dd."vehicleType", dd."vehicleMake", dd."vehicleModel", dd."vehicleColor", dd."licensePlate",
               e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
        FROM "DeliveryDriverSession" ds
        JOIN "DeliveryDriver" dd ON dd.id = ds."driverId"
        JOIN "Employee" e ON e.id = dd."employeeId"
        WHERE ds."locationId" = $1
          AND ds."endedAt" IS NULL
          AND ds.status != 'off_duty'
        ORDER BY e."firstName" ASC
      `, locationId),

      // 4. Open exceptions
      db.$queryRawUnsafe<any[]>(`
        SELECT * FROM "DeliveryException"
        WHERE "locationId" = $1
          AND status IN ('open', 'acknowledged')
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 1
            WHEN 'high' THEN 2
            WHEN 'medium' THEN 3
            WHEN 'low' THEN 4
          END,
          "createdAt" ASC
      `, locationId),

      // 5. Active zones
      db.$queryRawUnsafe<any[]>(`
        SELECT * FROM "DeliveryZone"
        WHERE "locationId" = $1 AND "isActive" = true
        ORDER BY "name" ASC
      `, locationId),

      // 6. Today's stats
      db.$queryRawUnsafe<any[]>(`
        SELECT
          COUNT(*)::int as "totalToday",
          COUNT(*) FILTER (
            WHERE status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
          )::int as "activeCount",
          COUNT(*) FILTER (
            WHERE status = 'delivered'
              AND "deliveredAt" IS NOT NULL
              AND "estimatedMinutes" IS NOT NULL
              AND EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) / 60 <= "estimatedMinutes"
          )::int as "onTimeCount",
          COUNT(*) FILTER (
            WHERE status = 'delivered'
          )::int as "deliveredCount",
          COUNT(*) FILTER (
            WHERE status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
              AND "estimatedMinutes" IS NOT NULL
              AND EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "createdAt")) / 60 > "estimatedMinutes"
          )::int as "lateCount"
        FROM "DeliveryOrder"
        WHERE "locationId" = $1
          AND "createdAt" >= CURRENT_DATE
      `, locationId),
    ])

    // Enrich results
    const orders = ordersResult.map(row => ({
      ...row,
      deliveryFee: Number(row.deliveryFee),
      driverName: row.driverFirstName
        ? `${row.driverFirstName} ${row.driverLastName}`.trim()
        : null,
    }))

    const runs = runsResult.map(row => ({
      ...row,
      driverName: row.driverFirstName
        ? `${row.driverFirstName} ${row.driverLastName}`.trim()
        : null,
    }))

    const drivers = driversResult.map(row => ({
      ...row,
      driverName: `${row.driverFirstName} ${row.driverLastName}`.trim(),
    }))

    // Calculate on-time percentage
    const rawStats = statsResult[0] || {}
    const deliveredCount = rawStats.deliveredCount ?? 0
    const onTimeCount = rawStats.onTimeCount ?? 0
    const onTimePercent = deliveredCount > 0
      ? Math.round((onTimeCount / deliveredCount) * 100)
      : 100

    const stats = {
      totalToday: rawStats.totalToday ?? 0,
      activeCount: rawStats.activeCount ?? 0,
      onTimePercent,
      lateCount: rawStats.lateCount ?? 0,
      deliveredCount,
    }

    return ok({
      orders,
      runs,
      drivers,
      exceptions: exceptionsResult,
      zones: zonesResult,
      stats,
    })
  } catch (error) {
    console.error('[Delivery/Dispatch] GET error:', error)
    return err('Failed to fetch dispatch board data', 500)
  }
})

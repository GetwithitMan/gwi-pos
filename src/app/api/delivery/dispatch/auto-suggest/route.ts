import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { suggestDrivers, getMaxOrdersPerDriver } from '@/lib/delivery/dispatch-policy'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/dispatch/auto-suggest — Suggest optimal driver for order(s)
 *
 * Body: { orderIds: string[], zoneId?: string }
 *
 * Returns scored driver suggestions using dispatch policy scoring engine.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { orderIds, zoneId } = body

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      return err('orderIds must be a non-empty array')
    }

    // Load settings
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY
    const policy = deliveryConfig.dispatchPolicy

    // Timezone lives on Location, not LocationSettings
    const loc = await db.$queryRawUnsafe<{ timezone: string }[]>(
      'SELECT "timezone" FROM "Location" WHERE "id" = $1',
      locationId,
    )
    const timezone = loc[0]?.timezone ?? 'America/New_York'

    const maxPerDriver = getMaxOrdersPerDriver(
      policy,
      deliveryConfig.peakHours ?? [],
      timezone
    )

    // Resolve effective zoneId from orders if not provided
    let effectiveZoneId = zoneId || null
    if (!effectiveZoneId && orderIds.length > 0) {
      const orderZones: any[] = await db.$queryRawUnsafe(
        `SELECT DISTINCT "zoneId" FROM "DeliveryOrder"
         WHERE id = ANY($1::text[]) AND "locationId" = $2 AND "zoneId" IS NOT NULL`,
        orderIds,
        locationId,
      )
      if (orderZones.length === 1) {
        effectiveZoneId = orderZones[0].zoneId
      }
    }

    // Query available drivers:
    // - Have an active session (not off_duty, not ended)
    // - Not on an active run
    // - Not suspended
    const availableDrivers: any[] = await db.$queryRawUnsafe(`
      SELECT
        dd.id as "driverId",
        e."firstName", e."lastName",
        ds.status as "sessionStatus",
        dd."isSuspended",
        dd."preferredZoneIds",
        (
          SELECT COUNT(*)::int
          FROM "DeliveryOrder" dord
          WHERE dord."driverId" = dd.id
            AND dord."locationId" = $1
            AND dord.status NOT IN ('delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch', 'failed_delivery', 'returned_to_store')
        ) as "activeOrderCount",
        (
          SELECT MAX(r."completedAt")
          FROM "DeliveryRun" r
          WHERE r."driverId" = dd.id AND r."locationId" = $1
        ) as "lastRunCompletedAt"
      FROM "DeliveryDriver" dd
      JOIN "Employee" e ON e.id = dd."employeeId"
      JOIN "DeliveryDriverSession" ds ON ds."driverId" = dd.id
        AND ds."locationId" = $1
        AND ds."endedAt" IS NULL
        AND ds.status NOT IN ('off_duty')
      WHERE dd."locationId" = $1
        AND dd."isActive" = true
        AND (dd."isSuspended" IS NULL OR dd."isSuspended" = false)
        AND NOT EXISTS (
          SELECT 1 FROM "DeliveryRun" r
          WHERE r."driverId" = dd.id
            AND r."locationId" = $1
            AND r.status NOT IN ('completed', 'returned', 'cancelled')
        )
      ORDER BY e."firstName" ASC
    `, locationId)

    // Build candidates for scoring engine
    const now = Date.now()
    const candidates = availableDrivers.map(d => {
      // Zone affinity check
      let zoneMatch = false
      if (effectiveZoneId && d.preferredZoneIds) {
        try {
          const preferredZones = Array.isArray(d.preferredZoneIds)
            ? d.preferredZoneIds
            : JSON.parse(d.preferredZoneIds)
          zoneMatch = preferredZones.includes(effectiveZoneId)
        } catch {
          zoneMatch = false
        }
      }

      const lastRunTime = d.lastRunCompletedAt
        ? new Date(d.lastRunCompletedAt).getTime()
        : 0
      const minutesSinceLastRun = lastRunTime > 0
        ? Math.floor((now - lastRunTime) / 60_000)
        : 120 // If no previous run, treat as long idle (favors rotation)

      return {
        driverId: d.driverId,
        driverName: `${d.firstName} ${d.lastName}`.trim(),
        activeOrderCount: d.activeOrderCount ?? 0,
        zoneMatch,
        minutesSinceLastRun,
      }
    })

    const suggestions = suggestDrivers(candidates, maxPerDriver)

    return ok({ suggestions })
  } catch (error) {
    console.error('[Delivery/Dispatch/AutoSuggest] POST error:', error)
    return err('Failed to generate driver suggestions', 500)
  }
})

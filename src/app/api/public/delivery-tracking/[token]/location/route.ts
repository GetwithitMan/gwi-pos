import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

// ── Rate limiter (60 req/min/IP) ────────────────────────────────────────────
const limiter = createRateLimiter({ maxAttempts: 60, windowMs: 60_000 })

/** UUID v4 format regex */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Haversine distance in meters between two lat/lng points.
 */
function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000 // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * GET /api/public/delivery-tracking/[token]/location — Driver GPS for public tracking
 *
 * NO authentication required. Returns the driver's last known GPS coordinates
 * for real-time map display on the customer tracking page.
 *
 * If hideDriverLocationUntilNearby is enabled, calculates distance to the
 * customer address and returns { visible: false } until the driver is within
 * the configured nearbyThresholdMeters.
 *
 * Designed to be polled every 15 seconds by the tracking page.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    // Rate limit
    const ip = getClientIp(request)
    if (!limiter.check(ip).allowed) {
      return err('Too many requests', 429)
    }

    const { token } = await context.params

    // Validate token is UUID format
    if (!token || !UUID_REGEX.test(token)) {
      return notFound('Not found')
    }

    // Fetch delivery order by tracking token
    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT do_."locationId", do_."runId", do_."status",
             do_."latitude" as "customerLat", do_."longitude" as "customerLng"
      FROM "DeliveryOrder" do_
      WHERE do_."trackingToken" = $1
      LIMIT 1
    `, token)

    if (!rows.length) {
      return notFound('Not found')
    }

    const delivery = rows[0]
    const locationId = delivery.locationId

    // Feature gate (public mode)
    const featureGate = await requireDeliveryFeature(locationId, {
      isPublic: true,
      subfeature: 'customerTrackingProvisioned',
      operation: 'tracking',
    })
    if (featureGate) return featureGate

    // Only show location for active delivery statuses
    const trackableStatuses = ['dispatched', 'en_route', 'arrived']
    if (!trackableStatuses.includes(delivery.status)) {
      return ok({ visible: false })
    }

    if (!delivery.runId) {
      return ok({ visible: false })
    }

    // Get the driver session for this run
    const sessionRows: any[] = await db.$queryRawUnsafe(`
      SELECT ds."lastLocationLat", ds."lastLocationLng", ds."lastLocationAt"
      FROM "DeliveryRun" dr
      JOIN "DeliveryDriverSession" ds ON ds."driverId" = dr."driverId"
        AND ds."locationId" = $2
        AND ds."endedAt" IS NULL
      WHERE dr.id = $1 AND dr."locationId" = $2
      LIMIT 1
    `, delivery.runId, locationId)

    if (!sessionRows.length || sessionRows[0].lastLocationLat == null) {
      return ok({ visible: false })
    }

    const session = sessionRows[0]
    const driverLat = Number(session.lastLocationLat)
    const driverLng = Number(session.lastLocationLng)

    // Check hideDriverLocationUntilNearby setting
    const settingsRows: any[] = await db.$queryRawUnsafe(`
      SELECT settings FROM "Location" WHERE id = $1 LIMIT 1
    `, locationId)

    if (settingsRows.length) {
      let settings: any = settingsRows[0].settings
      if (typeof settings === 'string') {
        try { settings = JSON.parse(settings) } catch { settings = {} }
      }

      const deliverySettings = settings?.delivery || {}
      const hideUntilNearby = deliverySettings.hideDriverLocationUntilNearby === true
      const nearbyThreshold = deliverySettings.nearbyThresholdMeters || 1000 // default 1km

      if (hideUntilNearby && delivery.customerLat != null && delivery.customerLng != null) {
        const customerLat = Number(delivery.customerLat)
        const customerLng = Number(delivery.customerLng)

        const distanceMeters = haversineMeters(driverLat, driverLng, customerLat, customerLng)
        if (distanceMeters > nearbyThreshold) {
          return ok({ visible: false })
        }
      }
    }

    return ok({
      visible: true,
      lat: driverLat,
      lng: driverLng,
      updatedAt: session.lastLocationAt
        ? new Date(session.lastLocationAt).toISOString()
        : null,
    })
  } catch (error) {
    console.error('[public/delivery-tracking/location] Error:', error)
    return notFound('Not found')
  }
})

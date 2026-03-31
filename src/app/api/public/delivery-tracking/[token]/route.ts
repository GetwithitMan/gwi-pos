import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { isEmergencyDisabled } from '@/lib/delivery/feature-check'
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
 * GET /api/public/delivery-tracking/[token] — Public tracking page data
 *
 * NO authentication required. Public endpoint for customers to track their delivery.
 * Returns sanitized data — no internal IDs, no full driver info.
 *
 * The token is the DeliveryOrder.trackingToken (UUID). Orders in terminal
 * states for > 24 hours return 404 to prevent stale tracking pages.
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

    // Validate token is UUID format (prevent index scan attacks)
    if (!token || !UUID_REGEX.test(token)) {
      return notFound('Not found')
    }

    // Fetch delivery order by tracking token
    const rows: any[] = await db.$queryRaw`
      SELECT do_.*,
             o."orderNumber",
             l."name" as "restaurantName", l."phone" as "restaurantPhone",
             do_."locationId"
      FROM "DeliveryOrder" do_
      LEFT JOIN "Order" o ON o.id = do_."orderId"
      LEFT JOIN "Location" l ON l.id = do_."locationId"
      WHERE do_."trackingToken" = ${token}
      LIMIT 1
    `

    if (!rows.length) {
      return notFound('Not found')
    }

    const delivery = rows[0]
    const locationId = delivery.locationId

    // Feature gate (public mode — returns 404 on disabled)
    const featureGate = await requireDeliveryFeature(locationId, {
      isPublic: true,
      subfeature: 'customerTrackingProvisioned',
      operation: 'tracking',
    })
    if (featureGate) return featureGate

    // Check emergency disabled — return generic unavailable message
    const settings = await getLocationSettings(locationId)
    if (settings && isEmergencyDisabled(settings as any)) {
      return ok({
        status: 'unavailable',
        message: `Service temporarily unavailable — please contact ${delivery.restaurantPhone || 'the restaurant'}.`,
      })
    }

    // If terminal state > 24 hours ago: 404 (stale tracking link)
    const terminalStates = ['delivered', 'cancelled_before_dispatch', 'cancelled_after_dispatch']
    if (terminalStates.includes(delivery.status)) {
      const updatedAt = new Date(delivery.updatedAt).getTime()
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000
      if (updatedAt < twentyFourHoursAgo) {
        return notFound('Not found')
      }
    }

    // Build status timeline from timestamp columns
    const timeline: Array<{ status: string; at: string }> = []
    const timelineMap: Array<[string, string]> = [
      ['pending', 'createdAt'],
      ['confirmed', 'confirmedAt'],
      ['preparing', 'preparedAt'],
      ['ready_for_pickup', 'readyAt'],
      ['assigned', 'assignedAt'],
      ['dispatched', 'dispatchedAt'],
      ['en_route', 'enRouteAt'],
      ['arrived', 'arrivedAt'],
      ['delivered', 'deliveredAt'],
      ['attempted', 'attemptedAt'],
      ['cancelled', 'cancelledAt'],
    ]

    for (const [statusName, col] of timelineMap) {
      if (delivery[col]) {
        timeline.push({
          status: statusName,
          at: new Date(delivery[col]).toISOString(),
        })
      }
    }

    // Always include the creation as 'pending' if not already there
    if (!timeline.some(t => t.status === 'pending') && delivery.createdAt) {
      timeline.unshift({
        status: 'pending',
        at: new Date(delivery.createdAt).toISOString(),
      })
    }

    // Get driver info if shareDriverInfo is enabled
    let driverFirstName: string | null = null
    let vehicleDescription: string | null = null

    const deliveryFeatures = (settings as any)?.deliveryFeatures || {}
    const shareDriverInfo = (settings as any)?.delivery?.shareDriverInfo !== false // default true

    if (shareDriverInfo && delivery.driverId) {
      // Only fetch if order has been assigned to a driver
      const driverRows: any[] = await db.$queryRaw`
        SELECT e."firstName",
               dd."vehicleColor", dd."vehicleMake", dd."vehicleModel"
        FROM "DeliveryDriver" dd
        JOIN "Employee" e ON e.id = dd."employeeId"
        WHERE dd.id = ${delivery.driverId} AND dd."locationId" = ${locationId}
        LIMIT 1
      `

      if (driverRows.length) {
        const d = driverRows[0]
        driverFirstName = d.firstName || null
        const parts = [d.vehicleColor, d.vehicleMake, d.vehicleModel].filter(Boolean)
        vehicleDescription = parts.length > 0 ? parts.join(' ') : null
      }
    }

    // Sanitized response — NO internal IDs, NO full driver info
    return ok({
      status: delivery.status,
      orderNumber: delivery.orderNumber || null,
      statusTimeline: timeline,
      estimatedDeliveryAt: delivery.estimatedDeliveryAt
        ? new Date(delivery.estimatedDeliveryAt).toISOString()
        : null,
      driverFirstName,
      vehicleDescription,
      restaurantName: delivery.restaurantName || null,
      restaurantPhone: delivery.restaurantPhone || null,
    })
  } catch (error) {
    console.error('[public/delivery-tracking] Error:', error)
    return notFound('Not found')
  }
})

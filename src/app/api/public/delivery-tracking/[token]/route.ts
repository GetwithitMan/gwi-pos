import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationSettings } from '@/lib/location-cache'
import { isEmergencyDisabled } from '@/lib/delivery/feature-check'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'

export const dynamic = 'force-dynamic'

// ── Simple rate limiter for public endpoint ─────────────────────────────────
// Rate limit: 60 req/min/IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// Cleanup stale rate limit entries
const cleanup = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key)
  }
}, 60_000)
if (cleanup && typeof cleanup === 'object' && 'unref' in cleanup) (cleanup as NodeJS.Timeout).unref()

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
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { token } = await context.params

    // Validate token is UUID format (prevent index scan attacks)
    if (!token || !UUID_REGEX.test(token)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Fetch delivery order by tracking token
    const rows: any[] = await db.$queryRawUnsafe(`
      SELECT do_.*,
             o."orderNumber",
             l."name" as "restaurantName", l."phone" as "restaurantPhone",
             do_."locationId"
      FROM "DeliveryOrder" do_
      LEFT JOIN "Order" o ON o.id = do_."orderId"
      LEFT JOIN "Location" l ON l.id = do_."locationId"
      WHERE do_."trackingToken" = $1
      LIMIT 1
    `, token)

    if (!rows.length) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
      return NextResponse.json({
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
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
      const driverRows: any[] = await db.$queryRawUnsafe(`
        SELECT e."firstName",
               dd."vehicleColor", dd."vehicleMake", dd."vehicleModel"
        FROM "DeliveryDriver" dd
        JOIN "Employee" e ON e.id = dd."employeeId"
        WHERE dd.id = $1 AND dd."locationId" = $2
        LIMIT 1
      `, delivery.driverId, locationId)

      if (driverRows.length) {
        const d = driverRows[0]
        driverFirstName = d.firstName || null
        const parts = [d.vehicleColor, d.vehicleMake, d.vehicleModel].filter(Boolean)
        vehicleDescription = parts.length > 0 ? parts.join(' ') : null
      }
    }

    // Sanitized response — NO internal IDs, NO full driver info
    return NextResponse.json({
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
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
})

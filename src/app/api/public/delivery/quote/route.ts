/**
 * POST /api/public/delivery/quote
 *
 * Delivery eligibility + fee engine for online ordering.
 * Matches customer address (primarily by zip code) against venue delivery zones,
 * calculates fee, checks minimums, and returns quote.
 *
 * No authentication required — public endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

interface QuoteBody {
  slug: string
  address: string
  city?: string
  state?: string
  zip?: string
  subtotal?: number
}

interface DeliveryZoneRow {
  id: string
  name: string
  zoneType: string
  deliveryFee: number | string
  minimumOrder: number | string
  estimatedMinutes: number | null
  radiusMiles: number | string | null
  centerLat: number | string | null
  centerLng: number | string | null
  zipcodes: string[] | null
  isActive: boolean
}

export async function POST(request: NextRequest) {
  try {
    // ── Rate limit (menu bucket — 30/min) ──────────────────────────────
    const ip = getClientIp(request)

    const rateCheck = checkOnlineRateLimit(ip, 'delivery-quote', 'menu')
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds ?? 60) },
        }
      )
    }

    // ── Parse + validate body ──────────────────────────────────────────
    let body: QuoteBody
    try {
      body = (await request.json()) as QuoteBody
    } catch {
      return err('Invalid JSON body')
    }

    if (!body.slug) {
      return err('slug is required')
    }
    if (!body.address?.trim()) {
      return err('address is required')
    }

    // ── Resolve venue DB ───────────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(body.slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location + settings ────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, settings: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const settings = mergeWithDefaults((location.settings ?? {}) as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY

    // ── Check delivery enabled ─────────────────────────────────────────
    if (!deliveryConfig.enabled) {
      return ok({ serviceable: false, reason: 'Delivery is not available' })
    }

    // ── Query active delivery zones (raw SQL — not in Prisma schema) ──
    const zones: DeliveryZoneRow[] = await venueDb.$queryRawUnsafe(
      `SELECT id, name, "zoneType", "deliveryFee", "minimumOrder", "estimatedMinutes",
              "radiusMiles", "centerLat", "centerLng", zipcodes, "isActive"
       FROM "DeliveryZone"
       WHERE "locationId" = $1 AND "deletedAt" IS NULL AND "isActive" = true
       ORDER BY "sortOrder" ASC`,
      location.id
    )

    if (zones.length === 0) {
      return ok({ serviceable: false, reason: 'Delivery is not available at this time' })
    }

    // ── Match address against zones (priority: sortOrder ASC) ──────────
    const customerZip = body.zip?.trim() || ''
    let matchedZone: DeliveryZoneRow | null = null

    for (const zone of zones) {
      if (zone.zoneType === 'zipcode' && customerZip) {
        // zipcodes is stored as text[] in PG
        const zoneZips = Array.isArray(zone.zipcodes) ? zone.zipcodes : []
        if (zoneZips.includes(customerZip)) {
          matchedZone = zone
          break
        }
      } else if (zone.zoneType === 'radius') {
        // Radius matching requires geocoding the customer address — skip for online
        // (zipcode is the primary matching mode for online ordering)
        continue
      }
      // polygon zones also require geocoding — skip for online
    }

    // ── No match ───────────────────────────────────────────────────────
    if (!matchedZone) {
      // Collect all available zip codes to help the customer
      const availableZipcodes: string[] = []
      for (const zone of zones) {
        if (zone.zoneType === 'zipcode' && Array.isArray(zone.zipcodes)) {
          for (const z of zone.zipcodes) {
            if (!availableZipcodes.includes(z)) {
              availableZipcodes.push(z)
            }
          }
        }
      }

      return ok({
          serviceable: false,
          reason: 'Outside our delivery area',
          ...(availableZipcodes.length > 0 ? { availableZipcodes } : {}),
        })
    }

    // ── Calculate fee ──────────────────────────────────────────────────
    let fee = Number(matchedZone.deliveryFee)
    const minimumOrder = Number(matchedZone.minimumOrder)
    const subtotal = typeof body.subtotal === 'number' ? body.subtotal : null

    // Free delivery threshold
    if (
      deliveryConfig.freeDeliveryMinimum > 0 &&
      subtotal !== null &&
      subtotal >= deliveryConfig.freeDeliveryMinimum
    ) {
      fee = 0
    }

    // Minimum order check
    if (subtotal !== null && subtotal < minimumOrder && minimumOrder > 0) {
      return ok({
          serviceable: false,
          reason: `Minimum order of $${minimumOrder.toFixed(2)} required for delivery`,
          minimumOrder,
        })
    }

    // Estimated time: zone → settings → default 30
    const estimatedMinutes =
      matchedZone.estimatedMinutes ||
      deliveryConfig.estimatedDeliveryMinutes ||
      30

    // ── Return quote ───────────────────────────────────────────────────
    return ok({
        serviceable: true,
        fee,
        estimatedMinutes,
        minimumOrder,
        zoneId: matchedZone.id,
        zoneName: matchedZone.name,
        freeDeliveryMinimum: deliveryConfig.freeDeliveryMinimum || undefined,
      })
  } catch (error) {
    console.error('[Delivery/Quote] POST error:', error)
    return err('Failed to calculate delivery quote', 500)
  }
}

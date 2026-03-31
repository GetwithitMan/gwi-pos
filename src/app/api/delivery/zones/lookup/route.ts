import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

// ── Geo Math Utilities ───────────────────────────────────────────────────────

const EARTH_RADIUS_MILES = 3959

/** Convert degrees to radians */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * Haversine distance between two lat/lng points in miles.
 * Pure math — no external API or library.
 *
 * Formula:
 *   a = sin²(dlat/2) + cos(lat1) * cos(lat2) * sin²(dlng/2)
 *   d = 2R * atan2(sqrt(a), sqrt(1-a))
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * EARTH_RADIUS_MILES * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Ray casting point-in-polygon test.
 * Pure math — no external library.
 *
 * `polygon` is an array of [lng, lat] coordinate pairs (GeoJSON convention).
 * Cast a horizontal ray from the point to the right and count edge crossings.
 * Odd crossings = inside, even = outside.
 */
function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    // GeoJSON coordinates are [lng, lat]
    const xi = polygon[i][1] // lat
    const yi = polygon[i][0] // lng
    const xj = polygon[j][1] // lat
    const yj = polygon[j][0] // lng

    const intersect =
      ((yi > lng) !== (yj > lng)) &&
      (lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/**
 * Extract the outer ring of coordinates from a GeoJSON polygon.
 * Supports both Polygon and the first polygon of a MultiPolygon.
 */
function getPolygonRing(polygonJson: any): number[][] | null {
  if (!polygonJson || !polygonJson.type || !polygonJson.coordinates) return null

  if (polygonJson.type === 'Polygon') {
    return polygonJson.coordinates[0] ?? null
  }
  if (polygonJson.type === 'MultiPolygon') {
    return polygonJson.coordinates[0]?.[0] ?? null
  }
  return null
}

// ── Route Handler ────────────────────────────────────────────────────────────

/**
 * POST /api/delivery/zones/lookup — Find the matching delivery zone for an address
 *
 * Body: { address, city, state, zipCode, latitude?, longitude? }
 *
 * Zone matching priority (by sortOrder):
 *   1. If lat/lng provided: polygon zones (point-in-polygon), then radius zones (haversine)
 *   2. Always: zipcode zones (exact match on zipCode)
 *   3. Return first match or null
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { address, city, state, zipCode, latitude, longitude } = body

    if (!address && !zipCode && latitude == null) {
      return err('At least one of address, zipCode, or latitude/longitude is required')
    }

    // Fetch all active, non-deleted zones ordered by sortOrder
    const zones: any[] = await db.$queryRaw`
      SELECT * FROM "DeliveryZone"
      WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL AND "isActive" = true
      ORDER BY "sortOrder" ASC
    `

    if (!zones.length) {
      return ok({ zone: null, matchType: null })
    }

    const hasCoords = latitude != null && longitude != null
    const lat = hasCoords ? Number(latitude) : null
    const lng = hasCoords ? Number(longitude) : null

    // Iterate zones in sortOrder priority — first match wins
    for (const zone of zones) {
      // --- Polygon match ---
      if (zone.zoneType === 'polygon' && hasCoords && zone.polygonJson) {
        const ring = getPolygonRing(zone.polygonJson)
        if (ring && pointInPolygon(lat!, lng!, ring)) {
          return ok({
            zone: enrichZone(zone),
            matchType: 'polygon',
          })
        }
      }

      // --- Radius match ---
      if (zone.zoneType === 'radius' && hasCoords && zone.centerLat != null && zone.centerLng != null && zone.radiusMiles != null) {
        const centerLat = Number(zone.centerLat)
        const centerLng = Number(zone.centerLng)
        const radiusMiles = Number(zone.radiusMiles)
        const distance = haversineDistance(lat!, lng!, centerLat, centerLng)
        if (distance <= radiusMiles) {
          return ok({
            zone: enrichZone(zone),
            matchType: 'radius',
            distanceMiles: Math.round(distance * 100) / 100,
          })
        }
      }

      // --- Zipcode match ---
      if (zone.zoneType === 'zipcode' && zipCode && zone.zipCodes) {
        const zips: string[] = Array.isArray(zone.zipCodes) ? zone.zipCodes : []
        const normalizedInput = zipCode.toString().trim()
        if (zips.some((z: string) => z.trim() === normalizedInput)) {
          return ok({
            zone: enrichZone(zone),
            matchType: 'zipcode',
          })
        }
      }
    }

    // No match found
    return ok({ zone: null, matchType: null })
  } catch (error) {
    console.error('[Delivery/Zones/Lookup] POST error:', error)
    return err('Failed to look up delivery zone', 500)
  }
})

/** Convert Decimal fields to numbers for JSON response */
function enrichZone(zone: any) {
  return {
    ...zone,
    deliveryFee: Number(zone.deliveryFee),
    minimumOrder: Number(zone.minimumOrder),
    radiusMiles: zone.radiusMiles != null ? Number(zone.radiusMiles) : null,
    centerLat: zone.centerLat != null ? Number(zone.centerLat) : null,
    centerLng: zone.centerLng != null ? Number(zone.centerLng) : null,
  }
}

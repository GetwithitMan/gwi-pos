import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { createChildLogger } from '@/lib/logger'
import { created, err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-zones')

export const dynamic = 'force-dynamic'

/** Strip HTML tags from user input */
function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * GET /api/delivery/zones — List delivery zones for this location
 */
export const GET = withVenue(async function GET(request: NextRequest) {
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

    const zones: any[] = await db.$queryRaw`
      SELECT * FROM "DeliveryZone"
      WHERE "locationId" = ${locationId} AND "deletedAt" IS NULL
      ORDER BY "sortOrder" ASC
    `

    // Convert Decimal fields to numbers
    const enriched = zones.map(z => ({
      ...z,
      deliveryFee: Number(z.deliveryFee),
      minimumOrder: Number(z.minimumOrder),
      radiusMiles: z.radiusMiles != null ? Number(z.radiusMiles) : null,
      centerLat: z.centerLat != null ? Number(z.centerLat) : null,
      centerLng: z.centerLng != null ? Number(z.centerLng) : null,
    }))

    return ok({ zones: enriched })
  } catch (error) {
    console.error('[Delivery/Zones] GET error:', error)
    return err('Failed to fetch delivery zones', 500)
  }
})

/**
 * POST /api/delivery/zones — Create a new delivery zone
 *
 * Payload: { name, zoneType, deliveryFee, minimumOrder, estimatedMinutes,
 *            sortOrder?, isActive?, centerLat?, centerLng?, radiusMiles?,
 *            polygonJson?, zipCodes? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_ZONES_MANAGE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const {
      name,
      zoneType,
      deliveryFee,
      minimumOrder,
      estimatedMinutes,
      sortOrder,
      isActive,
      centerLat,
      centerLng,
      radiusMiles,
      polygonJson,
      zipCodes,
    } = body

    // --- Validation ---

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return err('Zone name is required')
    }

    const sanitizedName = sanitizeHtml(name)
    if (sanitizedName.length === 0) {
      return err('Zone name is required')
    }

    const validZoneTypes = ['radius', 'polygon', 'zipcode']
    if (!zoneType || !validZoneTypes.includes(zoneType)) {
      return err(`zoneType must be one of: ${validZoneTypes.join(', ')}`)
    }

    const fee = Number(deliveryFee)
    if (isNaN(fee) || fee < 0) {
      return err('deliveryFee must be >= 0')
    }

    const minOrder = Number(minimumOrder)
    if (isNaN(minOrder) || minOrder < 0) {
      return err('minimumOrder must be >= 0')
    }

    const estMinutes = Number(estimatedMinutes)
    if (isNaN(estMinutes) || estMinutes <= 0) {
      return err('estimatedMinutes must be > 0')
    }

    // Type-specific validation
    if (zoneType === 'radius') {
      if (centerLat == null || centerLng == null || radiusMiles == null) {
        return err('Radius zones require centerLat, centerLng, and radiusMiles')
      }
      const lat = Number(centerLat)
      const lng = Number(centerLng)
      const radius = Number(radiusMiles)
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return err('centerLat must be between -90 and 90')
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return err('centerLng must be between -180 and 180')
      }
      if (isNaN(radius) || radius <= 0) {
        return err('radiusMiles must be > 0')
      }
    }

    if (zoneType === 'polygon') {
      if (!polygonJson || typeof polygonJson !== 'object') {
        return err('Polygon zones require polygonJson (valid GeoJSON)')
      }
      // Basic GeoJSON validation
      if (!polygonJson.type || !polygonJson.coordinates || !Array.isArray(polygonJson.coordinates)) {
        return err('polygonJson must be valid GeoJSON with type and coordinates')
      }
    }

    if (zoneType === 'zipcode') {
      if (!zipCodes || !Array.isArray(zipCodes) || zipCodes.length === 0) {
        return err('Zipcode zones require a non-empty zipCodes array')
      }
      // Validate each zip code is a non-empty string
      for (const zip of zipCodes) {
        if (typeof zip !== 'string' || zip.trim().length === 0) {
          return err('Each zipCode must be a non-empty string')
        }
      }
    }

    // --- Insert ---

    const inserted: any[] = await db.$queryRaw`
      INSERT INTO "DeliveryZone" (
        "id", "locationId", "name", "zoneType", "deliveryFee", "minimumOrder",
        "estimatedMinutes", "sortOrder", "isActive",
        "centerLat", "centerLng", "radiusMiles",
        "polygonJson", "zipCodes",
        "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid()::text, ${locationId}, ${sanitizedName}, ${zoneType}, ${fee}, ${minOrder},
        ${estMinutes}, ${sortOrder ?? 0}, ${isActive !== false},
        ${// default true
      zoneType === 'radius' ? Number(centerLat) : null}, ${zoneType === 'radius' ? Number(centerLng) : null}, ${zoneType === 'radius' ? Number(radiusMiles) : null},
        ${zoneType === 'polygon' ? JSON.stringify(polygonJson) : null}::jsonb, ${zoneType === 'zipcode' ? zipCodes : null}::text[],
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `

    const zone = inserted[0]

    // Fire-and-forget audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'zone_created',
      employeeId: actor.employeeId ?? 'unknown',
      newValue: { id: zone.id, name: sanitizedName, zoneType },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return created({
      zone: {
        ...zone,
        deliveryFee: Number(zone.deliveryFee),
        minimumOrder: Number(zone.minimumOrder),
        radiusMiles: zone.radiusMiles != null ? Number(zone.radiusMiles) : null,
        centerLat: zone.centerLat != null ? Number(zone.centerLat) : null,
        centerLng: zone.centerLng != null ? Number(zone.centerLng) : null,
      },
    })
  } catch (error) {
    console.error('[Delivery/Zones] POST error:', error)
    return err('Failed to create delivery zone', 500)
  }
})

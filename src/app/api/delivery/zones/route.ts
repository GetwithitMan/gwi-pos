import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const zones: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryZone"
      WHERE "locationId" = $1 AND "deletedAt" IS NULL
      ORDER BY "sortOrder" ASC
    `, locationId)

    // Convert Decimal fields to numbers
    const enriched = zones.map(z => ({
      ...z,
      deliveryFee: Number(z.deliveryFee),
      minimumOrder: Number(z.minimumOrder),
      radiusMiles: z.radiusMiles != null ? Number(z.radiusMiles) : null,
      centerLat: z.centerLat != null ? Number(z.centerLat) : null,
      centerLng: z.centerLng != null ? Number(z.centerLng) : null,
    }))

    return NextResponse.json({ zones: enriched })
  } catch (error) {
    console.error('[Delivery/Zones] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch delivery zones' }, { status: 500 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_ZONES_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

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
      return NextResponse.json({ error: 'Zone name is required' }, { status: 400 })
    }

    const sanitizedName = sanitizeHtml(name)
    if (sanitizedName.length === 0) {
      return NextResponse.json({ error: 'Zone name is required' }, { status: 400 })
    }

    const validZoneTypes = ['radius', 'polygon', 'zipcode']
    if (!zoneType || !validZoneTypes.includes(zoneType)) {
      return NextResponse.json({ error: `zoneType must be one of: ${validZoneTypes.join(', ')}` }, { status: 400 })
    }

    const fee = Number(deliveryFee)
    if (isNaN(fee) || fee < 0) {
      return NextResponse.json({ error: 'deliveryFee must be >= 0' }, { status: 400 })
    }

    const minOrder = Number(minimumOrder)
    if (isNaN(minOrder) || minOrder < 0) {
      return NextResponse.json({ error: 'minimumOrder must be >= 0' }, { status: 400 })
    }

    const estMinutes = Number(estimatedMinutes)
    if (isNaN(estMinutes) || estMinutes <= 0) {
      return NextResponse.json({ error: 'estimatedMinutes must be > 0' }, { status: 400 })
    }

    // Type-specific validation
    if (zoneType === 'radius') {
      if (centerLat == null || centerLng == null || radiusMiles == null) {
        return NextResponse.json({ error: 'Radius zones require centerLat, centerLng, and radiusMiles' }, { status: 400 })
      }
      const lat = Number(centerLat)
      const lng = Number(centerLng)
      const radius = Number(radiusMiles)
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return NextResponse.json({ error: 'centerLat must be between -90 and 90' }, { status: 400 })
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return NextResponse.json({ error: 'centerLng must be between -180 and 180' }, { status: 400 })
      }
      if (isNaN(radius) || radius <= 0) {
        return NextResponse.json({ error: 'radiusMiles must be > 0' }, { status: 400 })
      }
    }

    if (zoneType === 'polygon') {
      if (!polygonJson || typeof polygonJson !== 'object') {
        return NextResponse.json({ error: 'Polygon zones require polygonJson (valid GeoJSON)' }, { status: 400 })
      }
      // Basic GeoJSON validation
      if (!polygonJson.type || !polygonJson.coordinates || !Array.isArray(polygonJson.coordinates)) {
        return NextResponse.json({ error: 'polygonJson must be valid GeoJSON with type and coordinates' }, { status: 400 })
      }
    }

    if (zoneType === 'zipcode') {
      if (!zipCodes || !Array.isArray(zipCodes) || zipCodes.length === 0) {
        return NextResponse.json({ error: 'Zipcode zones require a non-empty zipCodes array' }, { status: 400 })
      }
      // Validate each zip code is a non-empty string
      for (const zip of zipCodes) {
        if (typeof zip !== 'string' || zip.trim().length === 0) {
          return NextResponse.json({ error: 'Each zipCode must be a non-empty string' }, { status: 400 })
        }
      }
    }

    // --- Insert ---

    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryZone" (
        "id", "locationId", "name", "zoneType", "deliveryFee", "minimumOrder",
        "estimatedMinutes", "sortOrder", "isActive",
        "centerLat", "centerLng", "radiusMiles",
        "polygonJson", "zipCodes",
        "createdAt", "updatedAt"
      )
      VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5,
        $6, $7, $8,
        $9, $10, $11,
        $12::jsonb, $13::jsonb,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
      locationId,
      sanitizedName,
      zoneType,
      fee,
      minOrder,
      estMinutes,
      sortOrder ?? 0,
      isActive !== false, // default true
      zoneType === 'radius' ? Number(centerLat) : null,
      zoneType === 'radius' ? Number(centerLng) : null,
      zoneType === 'radius' ? Number(radiusMiles) : null,
      zoneType === 'polygon' ? JSON.stringify(polygonJson) : null,
      zoneType === 'zipcode' ? JSON.stringify(zipCodes) : null,
    )

    const zone = inserted[0]

    // Fire-and-forget audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'zone_created',
      employeeId: actor.employeeId,
      newValue: { id: zone.id, name: sanitizedName, zoneType },
    }).catch(console.error)

    return NextResponse.json({
      zone: {
        ...zone,
        deliveryFee: Number(zone.deliveryFee),
        minimumOrder: Number(zone.minimumOrder),
        radiusMiles: zone.radiusMiles != null ? Number(zone.radiusMiles) : null,
        centerLat: zone.centerLat != null ? Number(zone.centerLat) : null,
        centerLng: zone.centerLng != null ? Number(zone.centerLng) : null,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Zones] POST error:', error)
    return NextResponse.json({ error: 'Failed to create delivery zone' }, { status: 500 })
  }
})

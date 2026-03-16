import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/addresses/geocode — Standalone geocode + zone lookup WITHOUT saving
 *
 * Body: { address, city, state, zipCode, latitude?, longitude? }
 *
 * For v1 (no Google Geocoding API): performs zipcode-based zone lookup only.
 * If lat/lng are provided in the body, also checks radius zones.
 * Actual geocoding (address -> lat/lng) is deferred to when an API key is configured.
 *
 * Returns zone match info without persisting anything.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
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

    const body = await request.json()
    const { address, city, state, zipCode, latitude, longitude } = body

    if (!zipCode || typeof zipCode !== 'string' || zipCode.trim().length === 0) {
      return NextResponse.json({ error: 'zipCode is required' }, { status: 400 })
    }

    let matchedZone: any = null
    let matchType: string | null = null

    // 1. Try zipcode-based zone lookup
    const zipcodeZones: any[] = await db.$queryRawUnsafe(`
      SELECT id, "name", "deliveryFee", "estimatedMinutes", "minimumOrder", "zoneType"
      FROM "DeliveryZone"
      WHERE "locationId" = $1
        AND "deletedAt" IS NULL
        AND "isActive" = true
        AND "zoneType" = 'zipcode'
        AND "zipCodes"::jsonb ? $2
      LIMIT 1
    `, locationId, zipCode.trim())

    if (zipcodeZones.length) {
      matchedZone = zipcodeZones[0]
      matchType = 'zipcode'
    }

    // 2. If lat/lng provided and no zipcode match, try radius zones
    if (!matchedZone && latitude != null && longitude != null) {
      const latNum = Number(latitude)
      const lngNum = Number(longitude)

      if (!isNaN(latNum) && latNum >= -90 && latNum <= 90 &&
          !isNaN(lngNum) && lngNum >= -180 && lngNum <= 180) {
        // Haversine distance check against radius zones
        // Uses great-circle distance in miles
        const radiusZones: any[] = await db.$queryRawUnsafe(`
          SELECT id, "name", "deliveryFee", "estimatedMinutes", "minimumOrder", "zoneType",
                 "centerLat", "centerLng", "radiusMiles",
                 (
                   3959 * acos(
                     cos(radians($2)) * cos(radians("centerLat"::float)) *
                     cos(radians("centerLng"::float) - radians($3)) +
                     sin(radians($2)) * sin(radians("centerLat"::float))
                   )
                 ) as "distanceMiles"
          FROM "DeliveryZone"
          WHERE "locationId" = $1
            AND "deletedAt" IS NULL
            AND "isActive" = true
            AND "zoneType" = 'radius'
            AND "centerLat" IS NOT NULL
            AND "centerLng" IS NOT NULL
            AND "radiusMiles" IS NOT NULL
          HAVING (
            3959 * acos(
              cos(radians($2)) * cos(radians("centerLat"::float)) *
              cos(radians("centerLng"::float) - radians($3)) +
              sin(radians($2)) * sin(radians("centerLat"::float))
            )
          ) <= "radiusMiles"::float
          ORDER BY "distanceMiles" ASC
          LIMIT 1
        `, locationId, latNum, lngNum)

        if (radiusZones.length) {
          matchedZone = radiusZones[0]
          matchType = 'radius'
        }
      }
    }

    return NextResponse.json({
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      geocodePrecision: null, // Deferred: actual geocoding not yet implemented
      zone: matchedZone
        ? {
            id: matchedZone.id,
            name: matchedZone.name,
            deliveryFee: Number(matchedZone.deliveryFee),
            estimatedMinutes: matchedZone.estimatedMinutes,
            minimumOrder: Number(matchedZone.minimumOrder),
            zoneType: matchedZone.zoneType,
          }
        : null,
      matchType,
    })
  } catch (error) {
    console.error('[Delivery/Addresses/Geocode] POST error:', error)
    return NextResponse.json({ error: 'Failed to geocode address' }, { status: 500 })
  }
})

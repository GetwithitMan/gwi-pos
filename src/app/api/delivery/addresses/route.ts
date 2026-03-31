import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { created, err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

function sanitizeHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim()
}

/**
 * GET /api/delivery/addresses — List saved addresses for a customer
 *
 * Query params: customerId (required)
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

    const searchParams = request.nextUrl.searchParams
    const customerId = searchParams.get('customerId')

    if (!customerId || typeof customerId !== 'string') {
      return err('customerId query parameter is required')
    }

    const addresses: any[] = await db.$queryRaw`
      SELECT da.*,
             dz."name" as "zoneName", dz."deliveryFee" as "zoneDeliveryFee",
             dz."estimatedMinutes" as "zoneEstimatedMinutes"
      FROM "DeliveryAddress" da
      LEFT JOIN "DeliveryZone" dz ON dz.id = da."zoneId" AND dz."deletedAt" IS NULL
      WHERE da."locationId" = ${locationId}
        AND da."customerId" = ${customerId}
        AND da."deletedAt" IS NULL
      ORDER BY da."isDefault" DESC, da."createdAt" DESC
    `

    const enriched = addresses.map(a => ({
      ...a,
      latitude: a.latitude != null ? Number(a.latitude) : null,
      longitude: a.longitude != null ? Number(a.longitude) : null,
      zoneDeliveryFee: a.zoneDeliveryFee != null ? Number(a.zoneDeliveryFee) : null,
      zoneEstimatedMinutes: a.zoneEstimatedMinutes != null ? Number(a.zoneEstimatedMinutes) : null,
    }))

    return ok({ addresses: enriched })
  } catch (error) {
    console.error('[Delivery/Addresses] GET error:', error)
    return err('Failed to fetch addresses', 500)
  }
})

/**
 * POST /api/delivery/addresses — Save a new delivery address (with zone lookup)
 *
 * Body: { customerId?, label?, address, addressLine2?, city, state, zipCode,
 *         phone?, deliveryNotes?, latitude?, longitude?, isDefault? }
 *
 * Auto-resolves delivery zone by zipcode match. If isDefault is true,
 * clears other defaults for this customer within a transaction.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_CREATE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const {
      customerId,
      label,
      address,
      addressLine2,
      city,
      state,
      zipCode,
      phone,
      deliveryNotes,
      latitude,
      longitude,
      isDefault,
    } = body

    // Validation
    if (!address || typeof address !== 'string' || address.trim().length === 0) {
      return err('address is required')
    }
    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      return err('city is required')
    }
    if (!state || typeof state !== 'string' || state.trim().length === 0) {
      return err('state is required')
    }
    if (!zipCode || typeof zipCode !== 'string' || zipCode.trim().length === 0) {
      return err('zipCode is required')
    }

    // Auto zone lookup by zipcode
    let zone: any = null
    const zones: any[] = await db.$queryRaw`
      SELECT id, "name", "deliveryFee", "estimatedMinutes", "minimumOrder"
      FROM "DeliveryZone"
      WHERE "locationId" = ${locationId}
        AND "deletedAt" IS NULL
        AND "isActive" = true
        AND "zoneType" = 'zipcode'
        AND ${zipCode.trim()} = ANY("zipCodes")
      LIMIT 1
    `

    if (zones.length) {
      zone = {
        id: zones[0].id,
        name: zones[0].name,
        deliveryFee: Number(zones[0].deliveryFee),
        estimatedMinutes: zones[0].estimatedMinutes,
        minimumOrder: Number(zones[0].minimumOrder),
      }
    }

    // Validate lat/lng if provided
    let latNum: number | null = null
    let lngNum: number | null = null
    if (latitude != null && longitude != null) {
      latNum = Number(latitude)
      lngNum = Number(longitude)
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return err('latitude must be between -90 and 90')
      }
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        return err('longitude must be between -180 and 180')
      }
    }

    // Clear other defaults if setting this as default (within transaction)
    if (isDefault && customerId) {
      await db.$executeRaw`
        UPDATE "DeliveryAddress"
        SET "isDefault" = false, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "locationId" = ${locationId} AND "customerId" = ${customerId} AND "isDefault" = true AND "deletedAt" IS NULL
      `
    }

    // Insert the address
    const inserted: any[] = await db.$queryRaw`
      INSERT INTO "DeliveryAddress" (
        "id", "locationId", "customerId", "label",
        "address", "addressLine2", "city", "state", "zipCode",
        "phone", "deliveryNotes", "latitude", "longitude",
        "zoneId", "isDefault",
        "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${locationId}, ${customerId || null}, ${label ? sanitizeHtml(label) : null},
        ${address.trim()}, ${addressLine2?.trim() || null}, ${city.trim()}, ${state.trim()}, ${zipCode.trim()},
        ${phone?.trim() || null}, ${deliveryNotes ? sanitizeHtml(deliveryNotes) : null}, ${latNum}, ${lngNum},
        ${zone?.id || null}, ${isDefault === true},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `

    const saved = inserted[0]

    pushUpstream()

    return created({
      address: {
        ...saved,
        latitude: saved.latitude != null ? Number(saved.latitude) : null,
        longitude: saved.longitude != null ? Number(saved.longitude) : null,
      },
      zone,
    })
  } catch (error) {
    console.error('[Delivery/Addresses] POST error:', error)
    return err('Failed to save address', 500)
  }
})

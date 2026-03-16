import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

/**
 * POST /api/delivery/driver/proof — Upload proof of delivery (photo/signature)
 *
 * Body: { deliveryOrderId, type: 'photo' | 'signature', storageKey, lat?, lng?, idempotencyKey? }
 *
 * The actual file upload happens at a separate storage layer (S3 / local storage).
 * This route records the proof metadata and links it to the delivery order.
 * Idempotency key prevents duplicate proof records on retry.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_CREATE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate — proof of delivery subfeature
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'proofOfDeliveryProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { deliveryOrderId, type, storageKey, lat, lng, idempotencyKey } = body

    // Validation
    if (!deliveryOrderId || typeof deliveryOrderId !== 'string') {
      return NextResponse.json({ error: 'deliveryOrderId is required' }, { status: 400 })
    }

    const validTypes = ['photo', 'signature']
    if (!type || !validTypes.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${validTypes.join(', ')}` }, { status: 400 })
    }

    if (!storageKey || typeof storageKey !== 'string' || storageKey.trim().length === 0) {
      return NextResponse.json({ error: 'storageKey is required' }, { status: 400 })
    }

    // Find driver for this employee
    const drivers: any[] = await db.$queryRawUnsafe(`
      SELECT id FROM "DeliveryDriver"
      WHERE "employeeId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, actor.employeeId, locationId)

    if (!drivers.length) {
      return NextResponse.json({ error: 'No driver profile found' }, { status: 404 })
    }

    const driverId = drivers[0].id

    // Validate order belongs to driver's active run
    const orderRows: any[] = await db.$queryRawUnsafe(`
      SELECT do_.id, do_."runId"
      FROM "DeliveryOrder" do_
      JOIN "DeliveryRun" dr ON dr.id = do_."runId"
      WHERE do_.id = $1
        AND do_."locationId" = $2
        AND dr."driverId" = $3
        AND dr."status" IN ('assigned', 'handoff_ready', 'dispatched', 'in_progress')
      LIMIT 1
    `, deliveryOrderId, locationId, driverId)

    if (!orderRows.length) {
      return NextResponse.json(
        { error: 'Order not found or not assigned to your active run' },
        { status: 404 },
      )
    }

    // Idempotency check
    if (idempotencyKey && typeof idempotencyKey === 'string') {
      const existing: any[] = await db.$queryRawUnsafe(`
        SELECT id FROM "DeliveryProofOfDelivery"
        WHERE "idempotencyKey" = $1 AND "locationId" = $2
        LIMIT 1
      `, idempotencyKey, locationId)

      if (existing.length) {
        return NextResponse.json({ proof: existing[0], deduplicated: true })
      }
    }

    // Validate GPS if provided
    let latNum: number | null = null
    let lngNum: number | null = null
    if (lat != null && lng != null) {
      latNum = Number(lat)
      lngNum = Number(lng)
      if (isNaN(latNum) || latNum < -90 || latNum > 90) {
        return NextResponse.json({ error: 'lat must be between -90 and 90' }, { status: 400 })
      }
      if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
        return NextResponse.json({ error: 'lng must be between -180 and 180' }, { status: 400 })
      }
    }

    // Insert proof record
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryProofOfDelivery" (
        "id", "locationId", "deliveryOrderId", "driverId",
        "type", "storageKey", "lat", "lng",
        "idempotencyKey", "createdAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3,
        $4, $5, $6, $7,
        $8, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
      locationId,
      deliveryOrderId,
      driverId,
      type,
      storageKey.trim(),
      latNum,
      lngNum,
      idempotencyKey || null,
    )

    const proof = inserted[0]

    // Fire-and-forget audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'proof_uploaded',
      deliveryOrderId,
      driverId,
      employeeId: actor.employeeId,
      newValue: { type, storageKey: storageKey.trim(), proofId: proof.id },
    }).catch(console.error)

    return NextResponse.json({
      proof: {
        id: proof.id,
        deliveryOrderId: proof.deliveryOrderId,
        driverId: proof.driverId,
        type: proof.type,
        storageKey: proof.storageKey,
        lat: proof.lat != null ? Number(proof.lat) : null,
        lng: proof.lng != null ? Number(proof.lng) : null,
        createdAt: proof.createdAt,
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Driver/Proof] POST error:', error)
    return NextResponse.json({ error: 'Failed to upload proof of delivery' }, { status: 500 })
  }
})

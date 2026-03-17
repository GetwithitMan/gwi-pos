import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

const VALID_DOCUMENT_TYPES = [
  'drivers_license',
  'insurance',
  'vehicle_registration',
  'background_check',
  'other',
] as const

/**
 * GET /api/delivery/drivers/[id]/documents — List documents for driver
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: driverId } = await params
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

    // Verify driver exists at this location
    const driver: any[] = await db.$queryRawUnsafe(`
      SELECT id FROM "DeliveryDriver"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, driverId, locationId)

    if (!driver.length) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    const documents: any[] = await db.$queryRawUnsafe(`
      SELECT * FROM "DeliveryDriverDocument"
      WHERE "driverId" = $1 AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `, driverId)

    return NextResponse.json({ documents })
  } catch (error) {
    console.error('[Delivery/Drivers/Documents] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
  }
})

/**
 * POST /api/delivery/drivers/[id]/documents — Upload compliance document
 *
 * Body: { documentType, documentNumber?, expiresAt?, storageKey, notes? }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: driverId } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DRIVERS_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate — requires driverDocumentsProvisioned subfeature
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverDocumentsProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { documentType, documentNumber, expiresAt, storageKey, notes } = body

    // Validate required fields
    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return NextResponse.json(
        { error: `documentType must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    if (!storageKey || typeof storageKey !== 'string') {
      return NextResponse.json({ error: 'storageKey is required' }, { status: 400 })
    }

    // Verify driver exists at this location
    const driver: any[] = await db.$queryRawUnsafe(`
      SELECT id, "employeeId" FROM "DeliveryDriver"
      WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, driverId, locationId)

    if (!driver.length) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    // Insert document
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryDriverDocument" (
        "id", "locationId", "driverId", "documentType", "documentNumber",
        "expiresAt", "storageKey", "notes", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
      locationId,
      driverId,
      documentType,
      documentNumber?.trim() || null,
      expiresAt ? new Date(expiresAt) : null,
      storageKey.trim(),
      notes?.trim() || null,
    )

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'document_uploaded',
      driverId,
      employeeId: auth.authorized ? auth.employee.id : '',
      newValue: { documentType, documentNumber, storageKey },
    }).catch(console.error)

    return NextResponse.json({ document: inserted[0] }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Drivers/Documents] POST error:', error)
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
  }
})

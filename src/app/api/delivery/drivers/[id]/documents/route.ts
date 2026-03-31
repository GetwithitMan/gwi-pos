import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { createChildLogger } from '@/lib/logger'
import { created, err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-drivers-documents')

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
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_VIEW)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Verify driver exists at this location
    const driver: any[] = await db.$queryRaw`
      SELECT id FROM "DeliveryDriver"
      WHERE id = ${driverId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `

    if (!driver.length) {
      return notFound('Driver not found')
    }

    const documents: any[] = await db.$queryRaw`
      SELECT * FROM "DeliveryDriverDocument"
      WHERE "driverId" = ${driverId} AND "deletedAt" IS NULL
      ORDER BY "createdAt" DESC
    `

    return ok({ documents })
  } catch (error) {
    console.error('[Delivery/Drivers/Documents] GET error:', error)
    return err('Failed to fetch documents', 500)
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
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DRIVERS_MANAGE)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate — requires driverDocumentsProvisioned subfeature
    const featureGate = await requireDeliveryFeature(locationId, { subfeature: 'driverDocumentsProvisioned' })
    if (featureGate) return featureGate

    const body = await request.json()
    const { documentType, documentNumber, expiresAt, storageKey, notes } = body

    // Validate required fields
    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType)) {
      return err(`documentType must be one of: ${VALID_DOCUMENT_TYPES.join(', ')}`)
    }

    if (!storageKey || typeof storageKey !== 'string') {
      return err('storageKey is required')
    }

    // Verify driver exists at this location
    const driver: any[] = await db.$queryRaw`
      SELECT id, "employeeId" FROM "DeliveryDriver"
      WHERE id = ${driverId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
      LIMIT 1
    `

    if (!driver.length) {
      return notFound('Driver not found')
    }

    // Insert document
    const inserted: any[] = await db.$queryRaw`
      INSERT INTO "DeliveryDriverDocument" (
        "id", "locationId", "driverId", "documentType", "documentNumber",
        "expiresAt", "storageKey", "notes", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, ${locationId}, ${driverId}, ${documentType}, ${documentNumber?.trim() || null}, ${expiresAt ? new Date(expiresAt) : null}, ${storageKey.trim()}, ${notes?.trim() || null},
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `

    // Write audit log
    void writeDeliveryAuditLog({
      locationId,
      action: 'document_uploaded',
      driverId,
      employeeId: auth.authorized ? auth.employee.id : '',
      newValue: { documentType, documentNumber, storageKey },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return created({ document: inserted[0] })
  } catch (error) {
    console.error('[Delivery/Drivers/Documents] POST error:', error)
    return err('Failed to upload document', 500)
  }
})

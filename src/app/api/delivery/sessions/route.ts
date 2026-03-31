import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { created, err, ok } from '@/lib/api-response'
const log = createChildLogger('delivery-sessions')

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/sessions — List active driver sessions
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

    const rows: any[] = await db.$queryRaw`
      SELECT ds.*,
             e."firstName" as "employeeFirstName",
             e."lastName" as "employeeLastName",
             e."displayName" as "employeeDisplayName",
             dd."vehicleType",
             dd."vehicleMake",
             dd."vehicleModel",
             dd."vehicleColor",
             dd."licensePlate"
      FROM "DeliveryDriverSession" ds
      LEFT JOIN "Employee" e ON e.id = ds."employeeId"
      LEFT JOIN "DeliveryDriver" dd ON dd.id = ds."driverId"
      WHERE ds."locationId" = ${locationId}
        AND ds."endedAt" IS NULL
      ORDER BY ds."startedAt" ASC
    `

    const sessions = rows.map(row => ({
      ...row,
      employeeName: row.employeeFirstName
        ? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
        : null,
      employeeDisplayName: row.employeeDisplayName,
    }))

    return ok({ sessions })
  } catch (error) {
    console.error('[Delivery/Sessions] GET error:', error)
    return err('Failed to fetch sessions', 500)
  }
})

/**
 * POST /api/delivery/sessions — Start a new driver session
 *
 * Body: { employeeId, startingBankCents? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { employeeId } = body
    let { startingBankCents } = body

    if (!employeeId || typeof employeeId !== 'string') {
      return err('employeeId is required')
    }

    // Validate startingBankCents is non-negative if provided
    if (startingBankCents != null && startingBankCents < 0) {
      return err('startingBankCents must be >= 0')
    }

    // Get delivery settings for startingBank defaults
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY

    // Use transaction for atomicity
    const result = await db.$transaction(async (tx: any) => {
      // 1. Validate employee exists and belongs to location
      const employee: any[] = await tx.$queryRaw`
        SELECT id, "firstName", "lastName" FROM "Employee"
        WHERE id = ${employeeId} AND "locationId" = ${locationId} AND "isActive" = true AND "deletedAt" IS NULL
        LIMIT 1
      `

      if (!employee.length) {
        return { error: 'Employee not found or inactive at this location', status: 404 }
      }

      // 2. Validate DeliveryDriver record exists for this employee
      const driverRows: any[] = await tx.$queryRaw`
        SELECT id, "isActive", "isSuspended" FROM "DeliveryDriver"
        WHERE "employeeId" = ${employeeId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL
        LIMIT 1
      `

      if (!driverRows.length) {
        return { error: 'No driver profile found for this employee. Create a driver profile first.', status: 400 }
      }

      const driver = driverRows[0]

      // 4. Check driver is active and not suspended
      if (!driver.isActive) {
        return { error: 'Driver profile is inactive', status: 400 }
      }

      if (driver.isSuspended) {
        return { error: 'Driver is suspended and cannot start a session', status: 400 }
      }

      // 3. Check for existing active session
      const activeSessions: any[] = await tx.$queryRaw`
        SELECT id FROM "DeliveryDriverSession"
        WHERE "driverId" = ${driver.id} AND "locationId" = ${locationId} AND "endedAt" IS NULL
        LIMIT 1
      `

      if (activeSessions.length) {
        return { error: 'Driver already has an active session', status: 409 }
      }

      // Handle starting bank
      if (deliveryConfig.requireStartingBank && !startingBankCents) {
        startingBankCents = Math.round(deliveryConfig.defaultStartingBank * 100)
      }

      // Insert session
      const inserted: any[] = await tx.$queryRaw`
        INSERT INTO "DeliveryDriverSession" (
          "id", "locationId", "driverId", "employeeId", "status",
          "startedAt", "startingBankCents", "cashCollectedCents", "cashDroppedCents",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, ${locationId}, ${driver.id}, ${employeeId}, 'available',
          CURRENT_TIMESTAMP, ${startingBankCents || 0}, 0, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING *
      `

      return { session: inserted[0] }
    })

    // Check for error from transaction
    if ('error' in result) {
      return err(result.error!, result.status)
    }

    pushUpstream()

    // Write audit log (fire-and-forget, outside transaction)
    void writeDeliveryAuditLog({
      locationId,
      action: 'session_started',
      driverId: result.session.driverId,
      employeeId: auth.authorized ? auth.employee.id : '',
      newValue: {
        sessionId: result.session.id,
        startingBankCents: result.session.startingBankCents,
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return created({ session: result.session })
  } catch (error) {
    console.error('[Delivery/Sessions] POST error:', error)
    return err('Failed to start session', 500)
  }
})

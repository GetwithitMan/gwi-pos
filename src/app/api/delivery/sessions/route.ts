import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_DELIVERY } from '@/lib/settings'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/sessions — List active driver sessions
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

    const rows: any[] = await db.$queryRawUnsafe(`
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
      WHERE ds."locationId" = $1
        AND ds."endedAt" IS NULL
      ORDER BY ds."startedAt" ASC
    `, locationId)

    const sessions = rows.map(row => ({
      ...row,
      employeeName: row.employeeFirstName
        ? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
        : null,
      employeeDisplayName: row.employeeDisplayName,
    }))

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('[Delivery/Sessions] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
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
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const { employeeId } = body
    let { startingBankCents } = body

    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }

    // Validate startingBankCents is non-negative if provided
    if (startingBankCents != null && startingBankCents < 0) {
      return NextResponse.json({ error: 'startingBankCents must be >= 0' }, { status: 400 })
    }

    // Get delivery settings for startingBank defaults
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const deliveryConfig = settings.delivery ?? DEFAULT_DELIVERY

    // Use transaction for atomicity
    const result = await db.$transaction(async (tx: any) => {
      // 1. Validate employee exists and belongs to location
      const employee: any[] = await tx.$queryRawUnsafe(`
        SELECT id, "firstName", "lastName" FROM "Employee"
        WHERE id = $1 AND "locationId" = $2 AND "isActive" = true AND "deletedAt" IS NULL
        LIMIT 1
      `, employeeId, locationId)

      if (!employee.length) {
        return { error: 'Employee not found or inactive at this location', status: 404 }
      }

      // 2. Validate DeliveryDriver record exists for this employee
      const driverRows: any[] = await tx.$queryRawUnsafe(`
        SELECT id, "isActive", "isSuspended" FROM "DeliveryDriver"
        WHERE "employeeId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
        LIMIT 1
      `, employeeId, locationId)

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
      const activeSessions: any[] = await tx.$queryRawUnsafe(`
        SELECT id FROM "DeliveryDriverSession"
        WHERE "driverId" = $1 AND "locationId" = $2 AND "endedAt" IS NULL
        LIMIT 1
      `, driver.id, locationId)

      if (activeSessions.length) {
        return { error: 'Driver already has an active session', status: 409 }
      }

      // Handle starting bank
      if (deliveryConfig.requireStartingBank && !startingBankCents) {
        startingBankCents = Math.round(deliveryConfig.defaultStartingBank * 100)
      }

      // Insert session
      const inserted: any[] = await tx.$queryRawUnsafe(`
        INSERT INTO "DeliveryDriverSession" (
          "id", "locationId", "driverId", "employeeId", "status",
          "startedAt", "startingBankCents", "cashCollectedCents", "cashDroppedCents",
          "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, $2, $3, 'available',
          CURRENT_TIMESTAMP, $4, 0, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING *
      `,
        locationId,
        driver.id,
        employeeId,
        startingBankCents || 0,
      )

      return { session: inserted[0] }
    })

    // Check for error from transaction
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

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
    }).catch(console.error)

    return NextResponse.json({ session: result.session }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Sessions] POST error:', error)
    return NextResponse.json({ error: 'Failed to start session' }, { status: 500 })
  }
})

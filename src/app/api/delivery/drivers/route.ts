import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'

export const dynamic = 'force-dynamic'

/**
 * GET /api/delivery/drivers — List driver profiles enriched with active session status
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
      SELECT dd.*,
             e."firstName" as "employeeFirstName",
             e."lastName" as "employeeLastName",
             e."displayName" as "employeeDisplayName",
             e."phone" as "employeePhone",
             ds.id as "sessionId",
             ds.status as "sessionStatus",
             ds."startedAt" as "sessionStartedAt",
             ds."startingBankCents" as "sessionStartingBankCents",
             ds."cashCollectedCents" as "sessionCashCollectedCents",
             ds."cashDroppedCents" as "sessionCashDroppedCents"
      FROM "DeliveryDriver" dd
      LEFT JOIN "Employee" e ON e.id = dd."employeeId"
      LEFT JOIN "DeliveryDriverSession" ds
        ON ds."driverId" = dd.id
        AND ds."endedAt" IS NULL
        AND ds."locationId" = $1
      WHERE dd."locationId" = $1
        AND dd."deletedAt" IS NULL
      ORDER BY e."firstName" ASC, e."lastName" ASC
    `, locationId)

    const drivers = rows.map(row => ({
      id: row.id,
      employeeId: row.employeeId,
      vehicleType: row.vehicleType,
      vehicleMake: row.vehicleMake,
      vehicleModel: row.vehicleModel,
      vehicleColor: row.vehicleColor,
      licensePlate: row.licensePlate,
      isActive: row.isActive,
      isSuspended: row.isSuspended,
      suspendedAt: row.suspendedAt,
      suspendedReason: row.suspendedReason,
      mileageRateOverride: row.mileageRateOverride != null ? Number(row.mileageRateOverride) : null,
      preferredZoneIds: row.preferredZoneIds,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      employeeName: row.employeeFirstName
        ? `${row.employeeFirstName} ${row.employeeLastName}`.trim()
        : null,
      employeeDisplayName: row.employeeDisplayName,
      employeePhone: row.employeePhone,
      activeSession: row.sessionId
        ? {
            id: row.sessionId,
            status: row.sessionStatus,
            startedAt: row.sessionStartedAt,
            startingBankCents: row.sessionStartingBankCents,
            cashCollectedCents: row.sessionCashCollectedCents,
            cashDroppedCents: row.sessionCashDroppedCents,
          }
        : null,
    }))

    return NextResponse.json({ drivers })
  } catch (error) {
    console.error('[Delivery/Drivers] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch drivers' }, { status: 500 })
  }
})

/**
 * POST /api/delivery/drivers — Create a new driver profile
 *
 * Body: { employeeId, vehicleType?, vehicleMake?, vehicleModel?, vehicleColor?,
 *         licensePlate?, mileageRateOverride?, preferredZoneIds? }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DRIVERS_MANAGE)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    const body = await request.json()
    const {
      employeeId,
      vehicleType,
      vehicleMake,
      vehicleModel,
      vehicleColor,
      licensePlate,
      mileageRateOverride,
      preferredZoneIds,
    } = body

    if (!employeeId || typeof employeeId !== 'string') {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }

    // Validate vehicleType if provided
    const VALID_VEHICLE_TYPES = ['car', 'bike', 'scooter', 'other'] as const
    if (vehicleType != null && vehicleType !== '' && !(VALID_VEHICLE_TYPES as readonly string[]).includes(vehicleType)) {
      return NextResponse.json({ error: 'vehicleType must be one of: car, bike, scooter, other' }, { status: 400 })
    }

    // Validate employee exists and belongs to location
    const employee = await db.employee.findFirst({
      where: { id: employeeId, locationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found at this location' }, { status: 404 })
    }

    // Check for existing driver profile
    const existing: any[] = await db.$queryRawUnsafe(`
      SELECT id FROM "DeliveryDriver"
      WHERE "employeeId" = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
      LIMIT 1
    `, employeeId, locationId)

    if (existing.length) {
      return NextResponse.json({ error: 'Driver profile already exists for this employee' }, { status: 409 })
    }

    // Insert driver profile
    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "DeliveryDriver" (
        "id", "locationId", "employeeId", "vehicleType", "vehicleMake", "vehicleModel",
        "vehicleColor", "licensePlate", "mileageRateOverride", "preferredZoneIds",
        "isActive", "isSuspended", "createdAt", "updatedAt"
      ) VALUES (
        gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9::text[],
        true, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
      locationId,
      employeeId,
      vehicleType?.trim() || null,
      vehicleMake?.trim() || null,
      vehicleModel?.trim() || null,
      vehicleColor?.trim() || null,
      licensePlate?.trim() || null,
      mileageRateOverride != null ? Number(mileageRateOverride) : null,
      preferredZoneIds?.length ? `{${preferredZoneIds.join(',')}}` : null,
    )

    return NextResponse.json({ driver: inserted[0] }, { status: 201 })
  } catch (error) {
    console.error('[Delivery/Drivers] POST error:', error)
    return NextResponse.json({ error: 'Failed to create driver profile' }, { status: 500 })
  }
})

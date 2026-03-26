import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requireDeliveryFeature } from '@/lib/delivery/require-delivery-feature'
import { advanceDriverSessionStatus, type DriverSessionStatus } from '@/lib/delivery/state-machine'

export const dynamic = 'force-dynamic'

/**
 * Valid driver session statuses for input validation.
 */
const VALID_SESSION_STATUSES: DriverSessionStatus[] = [
  'available',
  'on_delivery',
  'returning',
  'break',
  'off_duty',
]

/**
 * PATCH /api/delivery/drivers/[id]/status — Update driver session status
 *
 * Body: { status: DriverSessionStatus }
 *
 * The [id] param is the DeliveryDriver ID (not the session ID).
 * Finds the driver's active session and advances status through the state machine.
 *
 * Designed for the Delivery KDS Android app (dispatch board).
 */
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: driverId } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Feature gate
    const featureGate = await requireDeliveryFeature(locationId)
    if (featureGate) return featureGate

    // Auth check — dispatch permission for managing driver status from KDS/dispatch board
    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.DELIVERY_DISPATCH)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const body = await request.json()
    const { status } = body

    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    if (!VALID_SESSION_STATUSES.includes(status as DriverSessionStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${VALID_SESSION_STATUSES.join(', ')}` },
        { status: 400 },
      )
    }

    // Verify driver exists
    const driverRows: any[] = await db.$queryRawUnsafe(
      `SELECT dd.*, e."firstName" as "driverFirstName", e."lastName" as "driverLastName"
       FROM "DeliveryDriver" dd
       LEFT JOIN "Employee" e ON e.id = dd."employeeId"
       WHERE dd.id = $1 AND dd."locationId" = $2 AND dd."deletedAt" IS NULL`,
      driverId, locationId,
    )

    if (!driverRows.length) {
      return NextResponse.json({ error: 'Driver not found' }, { status: 404 })
    }

    const driver = driverRows[0]

    // Find the driver's active session
    const sessions: any[] = await db.$queryRawUnsafe(
      `SELECT * FROM "DeliveryDriverSession"
       WHERE "driverId" = $1 AND "locationId" = $2 AND "endedAt" IS NULL
       ORDER BY "startedAt" DESC
       LIMIT 1`,
      driverId, locationId,
    )

    if (!sessions.length) {
      // If transitioning to available/on_delivery/break, we could auto-create a session
      // But for safety, require an active session to exist
      return NextResponse.json(
        { error: 'No active driver session found. Driver must clock in first.' },
        { status: 404 },
      )
    }

    const session = sessions[0]

    // Advance through state machine (validates transition, fires socket events)
    const result = await advanceDriverSessionStatus(
      session.id,
      locationId,
      status as DriverSessionStatus,
      auth.employee.id,
    )

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    const updatedSession = result.session

    return NextResponse.json({
      data: {
        sessionId: updatedSession.id,
        driverId: updatedSession.driverId,
        status: updatedSession.status,
        lastLocationLat: updatedSession.lastLocationLat != null ? Number(updatedSession.lastLocationLat) : null,
        lastLocationLng: updatedSession.lastLocationLng != null ? Number(updatedSession.lastLocationLng) : null,
        lastLocationAt: updatedSession.lastLocationAt,
        startedAt: updatedSession.startedAt,
        endedAt: updatedSession.endedAt,
        updatedAt: updatedSession.updatedAt,
        driverName: driver.driverFirstName
          ? `${driver.driverFirstName} ${driver.driverLastName}`.trim()
          : null,
      },
      message: `Driver session status updated to ${status}`,
    })
  } catch (error) {
    console.error('[Delivery/Drivers/Status] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update driver status' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { transition, TransitionError, type ReservationStatus, type OverrideType } from '@/lib/reservations/state-machine'
import { offerSlotToWaitlist } from '@/lib/reservations/waitlist-bridge'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { notifyDataChanged } from '@/lib/cloud-notify'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { to, reason, overrideType } = body as {
      to: ReservationStatus
      reason?: string
      overrideType?: OverrideType
    }

    if (!to) {
      return NextResponse.json({ error: 'Target status (to) is required' }, { status: 400 })
    }

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    // Load reservation with full details for potential waitlist bridge
    const reservation = await db.reservation.findUnique({
      where: { id },
      select: {
        locationId: true,
        guestName: true,
        reservationDate: true,
        reservationTime: true,
        partySize: true,
        tableId: true,
        duration: true,
        sectionPreference: true,
        status: true,
      },
    })

    if (!reservation || reservation.locationId !== callerLocationId) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    // Execute transition inside a transaction
    const updated = await db.$transaction(async (tx: any) => {
      return transition({
        reservationId: id,
        to,
        actor: { type: 'staff', id: actor.employeeId || undefined },
        reason,
        overrideType,
        db: tx,
        locationId: reservation.locationId,
      })
    })

    // Post-commit: socket dispatch (fire-and-forget)
    void dispatchReservationChanged(reservation.locationId, {
      reservationId: id, action: to, reservation: updated,
    }).catch(console.error)

    // Post-commit: if cancelled, offer slot to waitlist (fire-and-forget)
    if (to === 'cancelled') {
      void triggerWaitlistBridge(reservation, id).catch(console.error)
    }

    void notifyDataChanged({ locationId: reservation.locationId, domain: 'reservations', action: 'updated', entityId: id })

    return NextResponse.json({ data: updated })
  } catch (error) {
    if (error instanceof TransitionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 })
    }
    console.error('[reservations/[id]/transition] POST error:', error)
    return NextResponse.json({ error: 'Failed to transition reservation' }, { status: 500 })
  }
})

async function triggerWaitlistBridge(reservation: any, reservationId: string) {
  const location = await db.location.findUnique({
    where: { id: reservation.locationId },
    select: { name: true, phone: true, address: true, settings: true, timezone: true },
  })
  if (!location) return

  const settings = parseSettings(location.settings)
  const templates = settings.reservationTemplates
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006'

  await offerSlotToWaitlist({
    cancelledReservation: {
      id: reservationId,
      locationId: reservation.locationId,
      guestName: reservation.guestName,
      reservationDate: reservation.reservationDate,
      reservationTime: reservation.reservationTime,
      partySize: reservation.partySize,
      tableId: reservation.tableId,
      duration: reservation.duration ?? 90,
      sectionPreference: reservation.sectionPreference,
    },
    db,
    templates,
    venueInfo: {
      name: location.name,
      phone: location.phone || undefined,
      address: location.address || undefined,
      slug: '',
      baseUrl,
    },
  })
}

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
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('reservations-transition')

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
      return err('Target status (to) is required')
    }

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return err('No location found')
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
      return notFound('Reservation not found')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
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
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Post-commit: if cancelled, offer slot to waitlist (fire-and-forget)
    if (to === 'cancelled') {
      void triggerWaitlistBridge(reservation, id).catch(err => log.warn({ err }, 'Background task failed'))
    }

    void notifyDataChanged({ locationId: reservation.locationId, domain: 'reservations', action: 'updated', entityId: id })
    void pushUpstream()

    return ok(updated)
  } catch (error) {
    if (error instanceof TransitionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 422 })
    }
    console.error('[reservations/[id]/transition] POST error:', error)
    return err('Failed to transition reservation', 500)
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
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`

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

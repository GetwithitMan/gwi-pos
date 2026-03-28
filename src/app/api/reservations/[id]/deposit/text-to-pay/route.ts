import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { generateDepositToken } from '@/lib/reservations/deposit-rules'
import { sendReservationNotification } from '@/lib/reservations/notifications'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('reservations-deposit-text-to-pay')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const callerLocationId = await getLocationId()
    if (!callerLocationId) {
      return err('No location found')
    }

    // Load reservation
    const reservation = await db.reservation.findUnique({
      where: { id },
      include: {
        customer: true,
        table: true,
        location: { select: { id: true, name: true, settings: true, phone: true, address: true } },
      },
    })

    if (!reservation || reservation.locationId !== callerLocationId) {
      return notFound('Reservation not found')
    }

    if (reservation.depositStatus === 'paid') {
      return err('Deposit already paid')
    }

    if (reservation.depositStatus === 'not_required') {
      return err('No deposit required for this reservation')
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return forbidden(auth.error || 'Permission denied')
    }

    const settings = parseSettings(reservation.location.settings)
    const depositRules = settings.depositRules!
    const templates = settings.reservationTemplates!

    // Generate token
    const { token, expiresAt } = await generateDepositToken(
      id,
      depositRules.expirationMinutes,
      db
    )

    // Write audit event
    await db.reservationEvent.create({
      data: {
        locationId: reservation.locationId,
        reservationId: id,
        eventType: 'deposit_requested',
        actor: 'staff',
        actorId: actor.employeeId,
        details: {
          token,
          expiresAt: expiresAt.toISOString(),
          depositAmountCents: reservation.depositAmountCents,
        },
      },
    })

    pushUpstream()

    // Send SMS notification (fire-and-forget)
    void sendReservationNotification({
      reservation,
      templateKey: 'depositRequest',
      db,
      templates,
      venueInfo: {
        name: reservation.location.name,
        phone: reservation.location.phone || undefined,
        address: reservation.location.address || undefined,
        slug: '',
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`,
      },
      channels: ['sms'],
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ sent: true, expiresAt, token })
  } catch (error) {
    console.error('[reservations/[id]/deposit/text-to-pay] POST error:', error)
    return err('Failed to send deposit link', 500)
  }
})

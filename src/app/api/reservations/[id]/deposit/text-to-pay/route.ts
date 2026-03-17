import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { parseSettings } from '@/lib/settings'
import { generateDepositToken } from '@/lib/reservations/deposit-rules'
import { sendReservationNotification } from '@/lib/reservations/notifications'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Load reservation
    const reservation = await db.reservation.findUnique({
      where: { id },
      include: {
        customer: true,
        table: true,
        location: { select: { id: true, name: true, settings: true, phone: true, address: true } },
      },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    if (reservation.depositStatus === 'paid') {
      return NextResponse.json({ error: 'Deposit already paid' }, { status: 400 })
    }

    if (reservation.depositStatus === 'not_required') {
      return NextResponse.json({ error: 'No deposit required for this reservation' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, reservation.locationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
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
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006',
      },
      channels: ['sms'],
    }).catch(console.error)

    return NextResponse.json({
      data: { sent: true, expiresAt, token },
    })
  } catch (error) {
    console.error('[reservations/[id]/deposit/text-to-pay] POST error:', error)
    return NextResponse.json({ error: 'Failed to send deposit link' }, { status: 500 })
  }
})

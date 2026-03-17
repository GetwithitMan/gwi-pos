import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, parseSettings, DEFAULT_RESERVATION_SETTINGS, DEFAULT_DEPOSIT_RULES } from '@/lib/settings'
import { transition } from '@/lib/reservations/state-machine'
import { calculateRefund } from '@/lib/reservations/deposit-rules'
import { offerSlotToWaitlist } from '@/lib/reservations/waitlist-bridge'
import { createRateLimiter } from '@/lib/rate-limiter'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/[token]/cancel — Guest self-service cancel
 * Body: { confirm?: boolean, reason?: string }
 *
 * First call without confirm=true returns refund preview.
 * Second call with confirm=true executes the cancellation.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`cancel:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = params
    const body = await request.json()
    const { confirm = false, reason } = body

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const terminalStatuses = ['completed', 'cancelled', 'no_show']
    if (terminalStatuses.includes(reservation.status)) {
      return NextResponse.json(
        { error: `Reservation is already ${reservation.status}` },
        { status: 400 }
      )
    }

    // Load settings for cutoff + refund calculation
    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const resSetting = settings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
    const depositRules = settings.depositRules ?? DEFAULT_DEPOSIT_RULES

    // Cutoff check
    const reservationDateTime = new Date(reservation.reservationDate)
    const [h, m] = reservation.reservationTime.split(':').map(Number)
    reservationDateTime.setHours(h, m, 0, 0)
    const hoursUntil = Math.max(0, (reservationDateTime.getTime() - Date.now()) / (1000 * 60 * 60))

    if (hoursUntil < resSetting.cancellationCutoffHours) {
      return NextResponse.json({
        error: `Cannot cancel within ${resSetting.cancellationCutoffHours} hours of reservation. Please call us.`,
        callVenue: true,
      }, { status: 400 })
    }

    // Calculate refund
    const depositCents = reservation.depositAmountCents ?? 0
    const depositPaid = reservation.depositStatus === 'paid'
    let refund: { refundAmountCents: number; refundPercent: number; tier: string } = { refundAmountCents: 0, refundPercent: 0, tier: 'none' }

    if (depositPaid && depositCents > 0) {
      refund = calculateRefund({
        depositAmountCents: depositCents,
        hoursUntilReservation: hoursUntil,
        rules: depositRules,
      })
    }

    // Preview mode — return refund info without executing
    if (!confirm) {
      return NextResponse.json({
        preview: true,
        depositAmountCents: depositCents,
        depositPaid,
        refundAmountCents: refund.refundAmountCents,
        refundTier: refund.tier,
        nonRefundableCents: depositCents - refund.refundAmountCents,
        hoursUntilReservation: Math.round(hoursUntil * 10) / 10,
        message: refund.tier === 'full'
          ? 'Your deposit will be fully refunded.'
          : refund.tier === 'partial'
            ? `A partial refund of $${(refund.refundAmountCents / 100).toFixed(2)} will be issued.`
            : depositPaid
              ? 'Your deposit is non-refundable for this cancellation.'
              : 'No deposit to refund.',
      })
    }

    // Execute cancellation via state machine
    const updated = await db.$transaction(async (tx: any) => {
      return transition({
        reservationId: reservation.id,
        to: 'cancelled',
        actor: { type: 'guest' },
        reason: reason || 'Guest cancelled online',
        db: tx,
        locationId,
      })
    })

    // Post-commit: offer slot to waitlist (fire-and-forget)
    void (async () => {
      const location = await db.location.findUnique({
        where: { id: locationId },
        select: { name: true, phone: true, address: true, settings: true },
      })
      if (!location) return
      const s = parseSettings(location.settings)
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3006'
      await offerSlotToWaitlist({
        cancelledReservation: {
          id: reservation.id,
          locationId,
          guestName: reservation.guestName,
          reservationDate: reservation.reservationDate,
          reservationTime: reservation.reservationTime,
          partySize: reservation.partySize,
          tableId: reservation.tableId,
          duration: reservation.duration ?? 90,
          sectionPreference: reservation.sectionPreference,
        },
        db,
        templates: s.reservationTemplates,
        venueInfo: {
          name: location.name,
          phone: location.phone || undefined,
          address: location.address || undefined,
          slug: '',
          baseUrl,
        },
      })
    })().catch(console.error)

    // Post-commit: socket dispatch
    void dispatchReservationChanged(locationId, {
      reservationId: reservation.id, action: 'cancelled',
    }).catch(console.error)

    return NextResponse.json({
      id: updated.id,
      status: 'cancelled',
      refundAmountCents: refund.refundAmountCents,
      refundTier: refund.tier,
      message: 'Reservation cancelled successfully.',
    })
  } catch (error: any) {
    if (error?.code === 'PAST_CUTOFF') {
      return NextResponse.json({
        error: error.message,
        callVenue: true,
      }, { status: 400 })
    }
    if (error?.name === 'TransitionError') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Public Cancel] Error:', error)
    return NextResponse.json({ error: 'Failed to cancel reservation' }, { status: 500 })
  }
})

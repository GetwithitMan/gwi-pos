import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { transition } from '@/lib/reservations/state-machine'
import { createRateLimiter } from '@/lib/rate-limiter'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('public-reservations-confirm')

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/confirm — Confirm a pending reservation via manageToken
 * Body: { token: string }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`confirm:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = await request.json()
    if (!token) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Look up reservation by manageToken
    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    // Can only confirm if currently pending and deposit is paid (or not required)
    if (reservation.status !== 'pending') {
      return NextResponse.json({
        error: reservation.status === 'confirmed'
          ? 'Reservation is already confirmed'
          : `Cannot confirm reservation in ${reservation.status} status`,
      }, { status: 400 })
    }

    const depositPaid = reservation.depositStatus === 'paid' || reservation.depositStatus === 'not_required'
    if (!depositPaid) {
      return NextResponse.json(
        { error: 'Deposit payment is required before confirmation' },
        { status: 400 }
      )
    }

    // Transition to confirmed
    const updated = await db.$transaction(async (tx: any) => {
      return transition({
        reservationId: reservation.id,
        to: 'confirmed',
        actor: { type: 'guest' },
        db: tx,
        locationId,
      })
    })

    // Post-commit: socket dispatch
    void dispatchReservationChanged(locationId, {
      reservationId: reservation.id, action: 'confirmed',
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      id: updated.id,
      status: updated.status,
      message: 'Reservation confirmed!',
    })
  } catch (error: any) {
    if (error?.name === 'TransitionError') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Public Confirm] Error:', error)
    return NextResponse.json({ error: 'Failed to confirm reservation' }, { status: 500 })
  }
})

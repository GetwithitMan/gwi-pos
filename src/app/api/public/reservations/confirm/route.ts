import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { transition } from '@/lib/reservations/state-machine'
import { createRateLimiter } from '@/lib/rate-limiter'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
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
      return err('Token is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
    }

    // Look up reservation by manageToken
    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
    })

    if (!reservation) {
      return notFound('Reservation not found')
    }

    // Can only confirm if currently pending and deposit is paid (or not required)
    if (reservation.status !== 'pending') {
      return err(reservation.status === 'confirmed'
          ? 'Reservation is already confirmed'
          : `Cannot confirm reservation in ${reservation.status} status`)
    }

    const depositPaid = reservation.depositStatus === 'paid' || reservation.depositStatus === 'not_required'
    if (!depositPaid) {
      return err('Deposit payment is required before confirmation')
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

    return ok({
      id: updated.id,
      status: updated.status,
      message: 'Reservation confirmed!',
    })
  } catch (error: any) {
    if (error?.name === 'TransitionError') {
      return err(error.message)
    }
    console.error('[Public Confirm] Error:', error)
    return err('Failed to confirm reservation', 500)
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { transition } from '@/lib/reservations/state-machine'
import { createRateLimiter } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/[token]/deposit — Process deposit via manageToken
 * Body: { paymentMethod: 'card', cardToken?: string, ... }
 *
 * Processes deposit payment via Datacap, updates deposit status,
 * and transitions reservation from pending → confirmed.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`deposit:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = params
    const body = await request.json()

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

    if (reservation.status !== 'pending') {
      return NextResponse.json(
        { error: reservation.depositStatus === 'paid'
            ? 'Deposit has already been paid'
            : `Cannot process deposit for ${reservation.status} reservation` },
        { status: 400 }
      )
    }

    if (reservation.depositStatus !== 'required' && reservation.depositStatus !== 'pending') {
      return NextResponse.json(
        { error: 'No deposit is required for this reservation' },
        { status: 400 }
      )
    }

    // Check hold expiry
    if (reservation.holdExpiresAt && new Date() > reservation.holdExpiresAt) {
      return NextResponse.json(
        { error: 'Deposit hold has expired. Please create a new reservation.' },
        { status: 410 }
      )
    }

    const depositAmountCents = reservation.depositAmountCents ?? 0
    if (depositAmountCents <= 0) {
      return NextResponse.json({ error: 'Invalid deposit amount' }, { status: 400 })
    }

    // TODO: Process payment via Datacap PayAPI
    // For now, simulate successful payment. In production, this calls:
    //   const paymentResult = await processDatacapPayment({
    //     amount: depositAmountCents,
    //     cardToken: body.cardToken,
    //     ...
    //   })
    const paymentResult = {
      success: true,
      recordNo: `DEP-${reservation.id.slice(0, 8)}`,
      refNumber: `REF-${Date.now()}`,
      cardLast4: body.cardLast4 || '0000',
      cardBrand: body.cardBrand || 'visa',
    }

    if (!paymentResult.success) {
      return NextResponse.json({ error: 'Payment failed. Please try again.' }, { status: 402 })
    }

    // Record deposit + update reservation in transaction
    await db.$transaction(async (tx: any) => {
      // Create deposit record
      await tx.reservationDeposit.create({
        data: {
          locationId,
          reservationId: reservation.id,
          type: 'deposit',
          amount: depositAmountCents / 100, // Decimal field in dollars
          paymentMethod: 'card',
          cardLast4: paymentResult.cardLast4,
          cardBrand: paymentResult.cardBrand,
          datacapRecordNo: paymentResult.recordNo,
          datacapRefNumber: paymentResult.refNumber,
          status: 'completed',
        },
      })

      // Update reservation deposit status
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { depositStatus: 'paid', updatedAt: new Date() },
      })

      // Log deposit event
      await tx.reservationEvent.create({
        data: {
          locationId,
          reservationId: reservation.id,
          eventType: 'deposit_paid',
          actor: 'guest',
          details: {
            amountCents: depositAmountCents,
            cardLast4: paymentResult.cardLast4,
            datacapRecordNo: paymentResult.recordNo,
          },
        },
      })

      // Transition to confirmed
      await transition({
        reservationId: reservation.id,
        to: 'confirmed',
        actor: { type: 'guest' },
        db: tx,
        locationId,
      })
    })

    return NextResponse.json({
      id: reservation.id,
      status: 'confirmed',
      depositPaid: true,
      depositAmountCents,
      message: 'Deposit paid! Your reservation is confirmed.',
    })
  } catch (error: any) {
    if (error?.name === 'TransitionError') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Public Deposit] Error:', error)
    return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 })
  }
})

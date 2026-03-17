import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { validateDepositToken, markDepositTokenUsed } from '@/lib/reservations/deposit-rules'
import { transition } from '@/lib/reservations/state-machine'
import { createRateLimiter } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/deposit-token/[depositToken] — Pay deposit via token
 * Separate from manageToken routes — used for text-to-pay deposit links.
 * Body: { cardLast4?: string, cardBrand?: string }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: { depositToken: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`deptoken:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { depositToken } = params
    const body = await request.json()

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    // Validate the deposit token
    const tokenCheck = await validateDepositToken(depositToken, db)
    if (!tokenCheck.valid) {
      const messages: Record<string, string> = {
        not_found: 'Invalid deposit link',
        expired: 'This deposit link has expired. Please contact the venue for a new link.',
        used: 'This deposit has already been paid',
        reservation_cancelled: 'This reservation has been cancelled',
      }
      return NextResponse.json(
        { error: messages[tokenCheck.reason!] || 'Invalid token' },
        { status: tokenCheck.reason === 'expired' ? 410 : 400 }
      )
    }

    const reservation = tokenCheck.reservation
    if (reservation.locationId !== locationId) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    }

    const depositAmountCents = reservation.depositAmountCents ?? 0
    if (depositAmountCents <= 0) {
      return NextResponse.json({ error: 'No deposit required' }, { status: 400 })
    }

    // TODO: Process payment via Datacap PayAPI
    // In production: const paymentResult = await processDatacapPayment(...)
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

    // Record deposit, mark token used, update reservation, transition — all in one tx
    await db.$transaction(async (tx: any) => {
      // Create deposit record
      await tx.reservationDeposit.create({
        data: {
          locationId,
          reservationId: reservation.id,
          type: 'deposit',
          amount: depositAmountCents / 100,
          paymentMethod: 'card',
          cardLast4: paymentResult.cardLast4,
          cardBrand: paymentResult.cardBrand,
          datacapRecordNo: paymentResult.recordNo,
          datacapRefNumber: paymentResult.refNumber,
          status: 'completed',
        },
      })

      // Mark token as used
      await markDepositTokenUsed(depositToken, tx)

      // Update reservation deposit status
      await tx.$executeRawUnsafe(
        `UPDATE "Reservation" SET "depositStatus" = 'paid', "updatedAt" = NOW() WHERE id = $1`,
        reservation.id
      )

      // Log event
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
            via: 'deposit_token',
          },
        },
      })

      // Transition pending → confirmed
      if (reservation.status === 'pending') {
        await transition({
          reservationId: reservation.id,
          to: 'confirmed',
          actor: { type: 'guest' },
          db: tx,
          locationId,
        })
      }
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
    console.error('[Public Deposit Token] Error:', error)
    return NextResponse.json({ error: 'Failed to process deposit' }, { status: 500 })
  }
})

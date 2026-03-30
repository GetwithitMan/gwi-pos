import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { validateDepositToken, markDepositTokenUsed } from '@/lib/reservations/deposit-rules'
import { transition } from '@/lib/reservations/state-machine'
import { sendReservationNotification } from '@/lib/reservations/notifications'
import { getPayApiClient, isPayApiSuccess, PayApiError } from '@/lib/datacap/payapi-client'
import { parseSettings } from '@/lib/settings'
import { createRateLimiter } from '@/lib/rate-limiter'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('deposit-token-pay')

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/deposit-token/[depositToken] — Pay deposit via token
 * Separate from manageToken routes — used for text-to-pay deposit links.
 * Body: { token: string, cardLast4?: string, cardBrand?: string }
 *
 * `token` is the Datacap OTU/multi-use card token from the hosted tokenization iframe.
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

    const { token: cardToken, cardLast4, cardBrand } = body

    if (!cardToken) {
      return err('Payment token is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
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
      return err(messages[tokenCheck.reason!] || 'Invalid token', tokenCheck.reason === 'expired' ? 410 : 400)
    }

    const reservation = tokenCheck.reservation
    if (reservation.locationId !== locationId) {
      return err('Invalid token')
    }

    const depositAmountCents = reservation.depositAmountCents ?? 0
    if (depositAmountCents <= 0) {
      return err('No deposit required')
    }

    // ── Charge via Datacap PayAPI ─────────────────────────────────────────────

    const depositAmountDollars = (depositAmountCents / 100).toFixed(2)
    const invoiceNo = `DEP-${reservation.id.slice(0, 8)}-${Date.now().toString(36)}`

    let payApiResult
    try {
      payApiResult = await getPayApiClient().sale({
        token: cardToken,
        amount: depositAmountDollars,
        invoiceNo,
      })
    } catch (payErr) {
      log.error({ err: payErr }, 'PayAPI error during deposit charge')

      // If PayAPI returned a structured decline, surface the message
      if (payErr instanceof PayApiError && payErr.response) {
        return NextResponse.json(
          {
            error: 'Payment declined. Please try a different card.',
            declineMessage: payErr.response.message,
          },
          { status: 402 }
        )
      }

      return err('Payment processing failed. Please try again.', 502)
    }

    // ── Handle payment result ─────────────────────────────────────────────────

    if (!isPayApiSuccess(payApiResult.status)) {
      return NextResponse.json(
        {
          error: 'Payment declined. Please try a different card.',
          declineMessage: payApiResult.message,
        },
        { status: 402 }
      )
    }

    // ── Handle partial approval ───────────────────────────────────────────────
    // If the processor authorized less than requested, void it and tell the guest

    const authorizedAmount = parseFloat(payApiResult.authorized || '0')
    const requestedAmount = parseFloat(depositAmountDollars)
    if (authorizedAmount > 0 && authorizedAmount < requestedAmount) {
      // Partial approval — void and decline
      log.warn(
        { requested: requestedAmount, authorized: authorizedAmount, refNo: payApiResult.refNo },
        'Partial approval on deposit — voiding'
      )
      try {
        await getPayApiClient().voidSale({
          refNo: payApiResult.refNo,
          token: cardToken,
          invoiceNo,
        })
      } catch (voidErr) {
        log.error({ err: voidErr }, 'Failed to void partial deposit authorization')
      }
      return NextResponse.json(
        {
          error: `Your card was only approved for $${authorizedAmount.toFixed(2)} of the $${requestedAmount.toFixed(2)} deposit. The partial charge has been voided. Please use a different card.`,
          partialApproval: true,
        },
        { status: 402 }
      )
    }

    // ── Derive card info from PayAPI response (fallback to body) ──────────────

    const resolvedCardLast4 = payApiResult.account
      ? payApiResult.account.slice(-4)
      : (cardLast4 || '0000')
    const resolvedCardBrand = payApiResult.brand || cardBrand || null

    // ── Record deposit, mark token used, update reservation, transition ───────

    await db.$transaction(async (tx: any) => {
      // Create deposit record
      await tx.reservationDeposit.create({
        data: {
          locationId,
          reservationId: reservation.id,
          type: 'deposit',
          amount: depositAmountCents / 100,
          paymentMethod: 'card',
          cardLast4: resolvedCardLast4,
          cardBrand: resolvedCardBrand,
          datacapRecordNo: payApiResult.refNo || null,
          datacapRefNumber: payApiResult.refNo || null,
          authCode: payApiResult.authCode || null,
          invoiceNo,
          status: 'completed',
        },
      })

      // Mark token as used
      await markDepositTokenUsed(depositToken, tx)

      // Update reservation deposit status
      await tx.reservation.update({
        where: { id: reservation.id },
        data: { depositStatus: 'paid', updatedAt: new Date() },
      })

      // Log event
      await tx.reservationEvent.create({
        data: {
          locationId,
          reservationId: reservation.id,
          eventType: 'deposit_paid',
          actor: 'guest',
          details: {
            amountCents: depositAmountCents,
            cardLast4: resolvedCardLast4,
            cardBrand: resolvedCardBrand,
            datacapRefNo: payApiResult.refNo,
            authCode: payApiResult.authCode,
            invoiceNo,
            via: 'deposit_token',
          },
        },
      })

      // Transition pending -> confirmed
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

    // ── Send confirmation SMS (fire-and-forget) ───────────────────────────────

    void (async () => {
      try {
        // Load full reservation with relations for notification engine
        const fullReservation = await db.reservation.findUnique({
          where: { id: reservation.id },
          include: {
            customer: true,
            table: true,
            location: { select: { id: true, name: true, settings: true, phone: true, address: true } },
          },
        })
        if (!fullReservation) return

        const settings = parseSettings(fullReservation.location.settings)
        const templates = settings.reservationTemplates
        if (!templates) return

        await sendReservationNotification({
          reservation: fullReservation,
          templateKey: 'depositReceived',
          db,
          templates,
          venueInfo: {
            name: fullReservation.location.name,
            phone: fullReservation.location.phone || undefined,
            address: fullReservation.location.address || undefined,
            slug: '',
            baseUrl: process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`,
          },
          channels: ['sms'],
        })
      } catch (notifErr) {
        log.warn({ err: notifErr }, 'Failed to send deposit confirmation notification')
      }
    })()

    return ok({
      id: reservation.id,
      status: 'confirmed',
      depositPaid: true,
      depositAmountCents,
      message: 'Deposit paid! Your reservation is confirmed.',
    })
  } catch (error: any) {
    if (error?.name === 'TransitionError') {
      return err(error.message)
    }
    console.error('[Public Deposit Token] Error:', error)
    return err('Failed to process deposit', 500)
  }
})

/**
 * POST /api/public/gift-cards/purchase
 *
 * Virtual gift card purchase — public endpoint (no auth).
 * Charges via Datacap PayAPI, creates GiftCard + GiftCardTransaction,
 * sends email to recipient.
 *
 * Uses getDbForVenue(slug) for tenant isolation.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { getPayApiClient } from '@/lib/datacap/payapi-client'
import { sendEmail } from '@/lib/email-service'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { err, notFound, ok } from '@/lib/api-response'

// ─── Request Body Shape ──────────────────────────────────────────────────────

interface PurchaseBody {
  slug: string
  amount: number
  recipientName: string
  recipientEmail: string
  message?: string
  purchaserName: string
  purchaserEmail: string
  token: string
  cardBrand?: string
  cardLast4?: string
  idempotencyKey: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCardNumber(): string {
  const seg = () => String(crypto.randomInt(1000, 10000))
  return `GC-${seg()}-${seg()}-${seg()}`
}

function generatePin(): string {
  return String(crypto.randomInt(1000, 10000))
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  let body: PurchaseBody
  try {
    body = (await request.json()) as PurchaseBody
  } catch {
    return err('Invalid JSON body')
  }

  const {
    slug,
    amount,
    recipientName,
    recipientEmail,
    message,
    purchaserName,
    purchaserEmail,
    token,
    cardBrand,
    cardLast4,
    idempotencyKey,
  } = body

  // ── 1. Validate required fields ────────────────────────────────────────────

  if (!slug) {
    return err('slug is required')
  }
  if (!token) {
    return err('Payment token is required')
  }
  if (!idempotencyKey) {
    return err('idempotencyKey is required')
  }
  if (!recipientName?.trim()) {
    return err('Recipient name is required')
  }
  if (!recipientEmail?.trim()) {
    return err('Recipient email is required')
  }
  if (!purchaserName?.trim()) {
    return err('Purchaser name is required')
  }
  if (!purchaserEmail?.trim()) {
    return err('Purchaser email is required')
  }

  // ── 2. Validate amount ─────────────────────────────────────────────────────

  if (typeof amount !== 'number' || amount <= 0 || amount > 500) {
    return err('Amount must be between $0.01 and $500.00')
  }
  const roundedAmount = Math.round(amount * 100) / 100

  // ── 3. Rate limit ──────────────────────────────────────────────────────────

  const rateCheck = checkOnlineRateLimit(ip, 'gift-card-purchase', 'checkout')
  if (!rateCheck.allowed) {
    const resp = NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 }
    )
    resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
    return resp
  }

  // ── 4. Resolve venue DB + location ─────────────────────────────────────────

  let venueDb
  try {
    venueDb = await getDbForVenue(slug)
  } catch {
    return notFound('Venue not found')
  }

  const location = await venueDb.location.findFirst({
    where: { isActive: true },
    select: { id: true, name: true },
  })

  if (!location) {
    return notFound('Location not found')
  }

  const locationId = location.id

  try {
    // ── 5. Idempotency check ───────────────────────────────────────────────────

    const existingTx = await venueDb.giftCardTransaction.findFirst({
      where: {
        locationId,
        type: 'purchase',
        notes: { contains: idempotencyKey },
      },
      select: {
        giftCard: {
          select: { id: true, cardNumber: true },
        },
      },
    })

    if (existingTx?.giftCard) {
      return ok({
        success: true,
        giftCardId: existingTx.giftCard.id,
        cardNumberLast4: existingTx.giftCard.cardNumber.slice(-4),
        duplicate: true,
      })
    }

    // ── 6. Charge via Datacap PayAPI ───────────────────────────────────────────

    const invoiceNo = `GC-${Date.now()}`
    let payApiResult
    try {
      payApiResult = await getPayApiClient().sale({
        token,
        amount: roundedAmount.toFixed(2),
        invoiceNo,
      })
    } catch (payErr) {
      console.error('[gift-card-purchase] PayAPI error:', payErr)
      return err('Payment processing failed. Please try again.', 502)
    }

    if (payApiResult.status !== 'Approved') {
      return NextResponse.json(
        {
          error: 'Payment declined. Please try a different card.',
          declineMessage: payApiResult.message,
        },
        { status: 402 }
      )
    }

    // ── 7. Generate unique card number (retry on collision) ─────────────────────

    let cardNumber = generateCardNumber()
    let retries = 0
    while (retries < 5) {
      const collision = await venueDb.giftCard.findFirst({
        where: { cardNumber },
        select: { id: true },
      })
      if (!collision) break
      cardNumber = generateCardNumber()
      retries++
    }

    const pin = generatePin()

    // ── 8. Create GiftCard + GiftCardTransaction ───────────────────────────────

    const giftCard = await venueDb.giftCard.create({
      data: {
        locationId,
        cardNumber,
        pin,
        initialBalance: roundedAmount,
        currentBalance: roundedAmount,
        status: 'active',
        recipientName: recipientName.trim(),
        recipientEmail: recipientEmail.trim(),
        purchaserName: purchaserName.trim(),
        message: message?.trim() || null,
        lastMutatedBy: 'cloud',
        transactions: {
          create: {
            locationId,
            type: 'purchase',
            amount: roundedAmount,
            balanceBefore: 0,
            balanceAfter: roundedAmount,
            notes: `Online purchase by ${purchaserName.trim()} (key: ${idempotencyKey})`,
          },
        },
      },
      select: { id: true, cardNumber: true },
    })

    // ── 9. Send email to recipient (fire-and-forget) ───────────────────────────

    void sendEmail({
      to: recipientEmail.trim(),
      subject: `You've received a ${formatDollar(roundedAmount)} gift card from ${location.name}!`,
      html: buildGiftCardEmail({
        venueName: location.name,
        recipientName: recipientName.trim(),
        purchaserName: purchaserName.trim(),
        amount: roundedAmount,
        cardNumber,
        pin,
        message: message?.trim() || null,
      }),
    }).catch((err) => {
      console.error('[gift-card-purchase] Email send error:', err)
    })

    // ── 10. Return success ─────────────────────────────────────────────────────

    return ok({
      success: true,
      giftCardId: giftCard.id,
      cardNumberLast4: giftCard.cardNumber.slice(-4),
    })
  } catch (error) {
    console.error('[POST /api/public/gift-cards/purchase] Error:', error)
    return err('An unexpected error occurred. Please try again.', 500)
  }
}

// ─── Email Template ──────────────────────────────────────────────────────────

function formatDollar(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function buildGiftCardEmail(data: {
  venueName: string
  recipientName: string
  purchaserName: string
  amount: number
  cardNumber: string
  pin: string
  message: string | null
}): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
      <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <div style="background: linear-gradient(135deg, #3B82F6, #8B5CF6); color: white; padding: 32px 24px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700;">Gift Card</h1>
          <p style="margin: 8px 0 0; font-size: 40px; font-weight: 800;">${formatDollar(data.amount)}</p>
          <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">from ${escapeHtml(data.venueName)}</p>
        </div>

        <!-- Content -->
        <div style="padding: 24px;">
          <p style="margin: 0 0 16px; font-size: 16px; color: #1f2937;">
            Hi ${escapeHtml(data.recipientName)},
          </p>

          <p style="margin: 0 0 16px; font-size: 16px; color: #1f2937;">
            ${escapeHtml(data.purchaserName)} sent you a gift card to ${escapeHtml(data.venueName)}!
          </p>

          ${data.message ? `
            <div style="margin: 0 0 20px; padding: 16px; background: #f9fafb; border-left: 3px solid #3B82F6; border-radius: 4px; font-style: italic; color: #4b5563;">
              "${escapeHtml(data.message)}"
            </div>
          ` : ''}

          <!-- Card details -->
          <div style="margin: 20px 0; padding: 20px; background: #f9fafb; border-radius: 8px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Card Number</td>
                <td style="padding: 6px 0; text-align: right; font-family: monospace; font-size: 16px; font-weight: 600; color: #1f2937;">${data.cardNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">PIN</td>
                <td style="padding: 6px 0; text-align: right; font-family: monospace; font-size: 16px; font-weight: 600; color: #1f2937;">${data.pin}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280; font-size: 14px;">Balance</td>
                <td style="padding: 6px 0; text-align: right; font-size: 16px; font-weight: 600; color: #1f2937;">${formatDollar(data.amount)}</td>
              </tr>
            </table>
          </div>

          <p style="margin: 0; font-size: 13px; color: #9ca3af; text-align: center;">
            Use this gift card when ordering online or in-store at ${escapeHtml(data.venueName)}.
          </p>
        </div>

      </div>
    </body>
    </html>
  `
}

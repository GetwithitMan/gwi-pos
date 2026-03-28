/**
 * POST /api/public/gift-cards/balance
 *
 * Checks balance and validity of a gift card.
 * POST (not GET) because PIN is in the body — not safe for query params.
 * No authentication required — public endpoint for online ordering.
 *
 * Uses getDbForVenue(slug) for tenant isolation.
 */

import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { GiftCardBalanceSchema } from '@/lib/site-api-schemas'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('public.gift-cards.balance')

export async function POST(request: NextRequest) {
  const ip = getClientIp(request)

  // Rate limit: reuse 'menu' bucket (30/min)
  const rateCheck = checkOnlineRateLimit(ip, 'gift-card-balance', 'menu')
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again shortly.' },
      { status: 429 }
    )
  }

  let parsed
  try {
    const body = await request.json()
    parsed = GiftCardBalanceSchema.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { number: cardNumber, pin, slug } = parsed

  try {
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ valid: false, reason: 'Location not found' })
    }

    // Sanitize card number
    const sanitized = cardNumber.trim().toUpperCase()
    if (sanitized.length < 4 || sanitized.length > 30) {
      return NextResponse.json({ valid: false, reason: 'Invalid card number format' })
    }

    // Find the location for this venue
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true },
    })
    if (!location) {
      return NextResponse.json({ valid: false, reason: 'Location not found' })
    }

    // Look up gift card — case-insensitive via uppercase normalization
    const giftCard = await venueDb.giftCard.findFirst({
      where: {
        cardNumber: sanitized,
        locationId: location.id,
        deletedAt: null,
      },
      select: {
        id: true,
        cardNumber: true,
        currentBalance: true,
        status: true,
        expiresAt: true,
        frozenAt: true,
        pin: true,
      },
    })

    if (!giftCard) {
      return NextResponse.json({ valid: false, reason: 'Gift card not found' })
    }

    // Check status
    if (giftCard.status !== 'active') {
      const statusMessages: Record<string, string> = {
        depleted: 'This gift card has a zero balance',
        expired: 'This gift card has expired',
        frozen: 'This gift card has been suspended',
      }
      return NextResponse.json({
        valid: false,
        reason: statusMessages[giftCard.status] || 'This gift card is not active',
      })
    }

    // Lazy expiry check
    if (giftCard.expiresAt && new Date() > giftCard.expiresAt) {
      // Fire-and-forget lazy status update
      void venueDb.giftCard.updateMany({
        where: { cardNumber: sanitized, status: 'active', deletedAt: null },
        data: { status: 'expired' },
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in public.gift-cards.balance'))
      return NextResponse.json({ valid: false, reason: 'This gift card has expired' })
    }

    // Check frozen
    if (giftCard.frozenAt) {
      return NextResponse.json({ valid: false, reason: 'This gift card has been suspended' })
    }

    // PIN validation — timing-safe comparison to prevent side-channel attacks
    if (giftCard.pin) {
      const pinStr = pin || ''
      const pinMatch = giftCard.pin.length === pinStr.length &&
        crypto.timingSafeEqual(Buffer.from(giftCard.pin), Buffer.from(pinStr))
      if (!pinMatch) {
        return NextResponse.json({ valid: false, reason: 'Invalid PIN' })
      }
    }

    return NextResponse.json({
      valid: true,
      balance: Number(giftCard.currentBalance),
      last4: giftCard.cardNumber.slice(-4),
    })
  } catch (error) {
    console.error('[POST /api/public/gift-cards/balance] Error:', error)
    return NextResponse.json(
      { error: 'Failed to check gift card balance' },
      { status: 500 }
    )
  }
}

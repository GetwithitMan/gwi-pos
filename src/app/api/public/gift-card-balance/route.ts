/**
 * Public: Gift Card Balance Lookup
 *
 * GET /api/public/gift-card-balance?cardNumber=GC-XXXX-XXXX-XXXX&slug=venue-slug
 *
 * Returns the current balance and status of a gift card.
 * No authentication required (public-facing).
 *
 * Architectural note:
 *   Does NOT use withVenue() — public route, no authenticated venue context.
 *   Uses getDbForVenue(slug) directly (same pattern as /api/public/resolve-order-code).
 *   The slug provides tenant isolation: only the matching location's gift cards are queried.
 *
 * Rate limiting:
 *   In-memory IP rate limiter — max 10 lookups per IP per minute.
 *   Resets per-IP after 60 seconds of no requests.
 *
 * Security:
 *   Returns ONLY: balance, lastUsed, isActive.
 *   Does NOT return: internal IDs, locationId, transaction history, purchaser info.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'

// ─── In-memory rate limiter ───────────────────────────────────────────────────

const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()

// Periodic cleanup — evict expired entries every 5 minutes to prevent memory leak
let lastCleanup = Date.now()
const CLEANUP_INTERVAL_MS = 5 * 60_000

function cleanupRateLimitMap() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}

function checkRateLimit(ip: string): boolean {
  cleanupRateLimitMap()

  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return false
  }

  entry.count++
  return true
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Rate limit by IP
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown'

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in a minute.' },
        { status: 429 }
      )
    }

    const { searchParams } = request.nextUrl
    const cardNumber = searchParams.get('cardNumber') || searchParams.get('code')
    const slug = searchParams.get('slug')

    if (!cardNumber) {
      return NextResponse.json(
        { error: 'cardNumber or code query parameter is required' },
        { status: 400 }
      )
    }

    if (!slug) {
      return NextResponse.json(
        { error: 'slug query parameter is required' },
        { status: 400 }
      )
    }

    // Validate card number format (prevent injection, limit length)
    const sanitized = cardNumber.trim().toUpperCase()
    if (sanitized.length < 4 || sanitized.length > 30) {
      return NextResponse.json(
        { error: 'Invalid card number format' },
        { status: 400 }
      )
    }

    // Route to venue database
    let venueDb
    try {
      venueDb = getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // Look up gift card by cardNumber
    const giftCard = await venueDb.giftCard.findFirst({
      where: {
        cardNumber: sanitized,
        deletedAt: null,
      },
      select: {
        currentBalance: true,
        status: true,
        expiresAt: true,
        // Find the most recent redemption for lastUsed
        transactions: {
          where: { type: 'redemption' },
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { createdAt: true },
        },
      },
    })

    if (!giftCard) {
      return NextResponse.json(
        { error: 'Gift card not found' },
        { status: 404 }
      )
    }

    // Lazy expiry check — update status if expired but still marked active
    let effectiveStatus = giftCard.status
    if (
      giftCard.expiresAt &&
      new Date() > giftCard.expiresAt &&
      giftCard.status === 'active'
    ) {
      effectiveStatus = 'expired'
      // Fire-and-forget lazy status update
      void venueDb.giftCard.updateMany({
        where: { cardNumber: sanitized, status: 'active', deletedAt: null },
        data: { status: 'expired' },
      }).catch(() => {})
    }

    const lastRedemption = giftCard.transactions[0]
    const isActive = effectiveStatus === 'active'

    return NextResponse.json({
      balance: Number(giftCard.currentBalance),
      lastUsed: lastRedemption ? lastRedemption.createdAt.toISOString() : null,
      isActive,
    })
  } catch (error) {
    console.error('[GET /api/public/gift-card-balance] Error:', error)
    return NextResponse.json(
      { error: 'Failed to look up gift card balance' },
      { status: 500 }
    )
  }
}

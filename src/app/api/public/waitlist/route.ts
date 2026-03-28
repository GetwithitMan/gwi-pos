import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_WAITLIST_SETTINGS } from '@/lib/settings'
import { dispatchWaitlistChanged } from '@/lib/socket-dispatch'
import { createRateLimiter } from '@/lib/rate-limiter'
import { getClientIp } from '@/lib/get-client-ip'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('public-waitlist')

export const dynamic = 'force-dynamic'

// ─── Rate limiter (per IP, 3 per minute) ────────────────────────────────────
const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * GET /api/public/waitlist — Check waitlist position by phone number (no auth)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return err('Waitlist is not enabled')
    }

    const { searchParams } = new URL(request.url)
    const phone = searchParams.get('phone')?.trim()

    if (!phone) {
      return err('Phone number is required (?phone=XXX)')
    }

    // Look up active entry by phone
    const entries: any[] = await db.$queryRawUnsafe(`
      SELECT id, "customerName", "partySize", status, position, "quotedWaitMinutes", "createdAt"
      FROM "WaitlistEntry"
      WHERE "locationId" = $1
        AND phone = $2
        AND status IN ('waiting', 'notified')
      ORDER BY "createdAt" DESC
      LIMIT 1
    `, locationId, phone)

    if (!entries.length) {
      return ok({
        found: false,
        message: 'No active waitlist entry found for this phone number.',
      })
    }

    const entry = entries[0]

    // Calculate live position among active entries
    const positionResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int + 1 as position
      FROM "WaitlistEntry"
      WHERE "locationId" = $1
        AND status IN ('waiting', 'notified')
        AND position < $2
    `, locationId, entry.position)

    const livePosition = positionResult[0]?.position ?? entry.position
    const estimatedWaitMinutes = Math.max(0, (livePosition - 1) * waitlistConfig.estimateMinutesPerTurn)

    return ok({
      found: true,
      position: livePosition,
      status: entry.status,
      estimatedWaitMinutes,
      partySize: entry.partySize,
      customerName: entry.customerName,
    })
  } catch (error) {
    console.error('[PublicWaitlist] GET error:', error)
    return err('Failed to check waitlist', 500)
  }
})

/**
 * POST /api/public/waitlist — Public endpoint for guests to add themselves (no auth)
 * Rate limited: 3 per minute per IP
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Rate limit check
    const ip = getClientIp(request)

    const rateCheck = limiter.check(ip)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        { status: 429, headers: rateCheck.retryAfter ? { 'Retry-After': String(rateCheck.retryAfter) } : undefined }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const waitlistConfig = settings.waitlist ?? DEFAULT_WAITLIST_SETTINGS

    if (!waitlistConfig.enabled) {
      return err('Waitlist is not available at this time.')
    }

    const body = await request.json()
    const { customerName, partySize, phone, notes } = body

    if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
      return err('Your name is required.')
    }

    const size = Number(partySize)
    if (!size || size < 1 || size > waitlistConfig.maxPartySize) {
      return err(`Party size must be between 1 and ${waitlistConfig.maxPartySize}.`)
    }

    // Check waitlist capacity
    const countResult: any[] = await db.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count
      FROM "WaitlistEntry"
      WHERE "locationId" = $1
        AND status IN ('waiting', 'notified')
    `, locationId)

    const currentCount = countResult[0]?.count ?? 0
    if (currentCount >= waitlistConfig.maxWaitlistSize) {
      return err('The waitlist is currently full. Please try again later.', 409)
    }

    const position = currentCount + 1
    const quotedWaitMinutes = (position - 1) * waitlistConfig.estimateMinutesPerTurn

    const inserted: any[] = await db.$queryRawUnsafe(`
      INSERT INTO "WaitlistEntry" ("locationId", "customerName", "partySize", phone, notes, status, position, "quotedWaitMinutes")
      VALUES ($1, $2, $3, $4, $5, 'waiting', $6, $7)
      RETURNING id, "customerName", "partySize", phone, status, position, "quotedWaitMinutes", "createdAt"
    `, locationId, customerName.trim(), size, phone?.trim() || null, notes?.trim() || null, position, quotedWaitMinutes)

    const entry = inserted[0]

    // Fire-and-forget socket dispatch
    void dispatchWaitlistChanged(locationId, {
      action: 'added',
      entryId: entry.id,
      customerName: entry.customerName,
      partySize: entry.partySize,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        position,
        estimatedWaitMinutes: quotedWaitMinutes,
        customerName: entry.customerName,
        partySize: entry.partySize,
      },
      message: quotedWaitMinutes > 0
        ? `You're #${position} on the waitlist! Estimated wait: ~${quotedWaitMinutes} minutes.`
        : `You're next! We'll seat you shortly.`,
    }, { status: 201 })
  } catch (error) {
    console.error('[PublicWaitlist] POST error:', error)
    return err('Failed to join waitlist', 500)
  }
})

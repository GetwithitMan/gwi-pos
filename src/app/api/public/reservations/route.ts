import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_RESERVATION_SETTINGS, DEFAULT_DEPOSIT_RULES } from '@/lib/settings'
import { createReservationWithRules } from '@/lib/reservations/create-reservation'
import { createRateLimiter } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations — Create a reservation (guest-facing)
 * Requires X-Idempotency-Key header.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`book:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait before trying again.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const idempotencyKey = request.headers.get('x-idempotency-key')?.trim()
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 256) {
      return NextResponse.json(
        { error: 'Valid X-Idempotency-Key header is required (16-256 chars)' },
        { status: 400 }
      )
    }

    const body = await request.json()

    // Honeypot check — hidden field should not exist at all
    if ('website' in body) {
      return NextResponse.json({ error: 'Invalid submission' }, { status: 422 })
    }

    const { guestName, guestPhone, guestEmail, partySize, date, time, duration, specialRequests, occasion, dietaryRestrictions, sectionPreference, smsOptIn } = body

    // Input length validation
    if (specialRequests && typeof specialRequests === 'string' && specialRequests.length > 500) {
      return NextResponse.json({ error: 'Special requests too long (max 500 chars)' }, { status: 400 })
    }
    if (occasion && typeof occasion === 'string' && occasion.length > 100) {
      return NextResponse.json({ error: 'Occasion too long (max 100 chars)' }, { status: 400 })
    }
    if (dietaryRestrictions && typeof dietaryRestrictions === 'string' && dietaryRestrictions.length > 500) {
      return NextResponse.json({ error: 'Dietary restrictions too long (max 500 chars)' }, { status: 400 })
    }

    if (!guestName || !partySize || !date || !time) {
      return NextResponse.json(
        { error: 'Guest name, party size, date, and time are required' },
        { status: 400 }
      )
    }

    if (!guestPhone && !guestEmail) {
      return NextResponse.json(
        { error: 'At least a phone number or email is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, phone: true, address: true, slug: true, timezone: true, settings: true },
    })
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const fullSettings = mergeWithDefaults(location.settings as any)
    const resSetting = fullSettings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
    const depositRules = fullSettings.depositRules ?? DEFAULT_DEPOSIT_RULES
    const templates = fullSettings.reservationTemplates

    if (!resSetting.allowOnlineBooking) {
      return NextResponse.json({ error: 'Online booking is not available' }, { status: 403 })
    }

    if (partySize > resSetting.maxPartySize) {
      return NextResponse.json(
        { error: `Maximum party size is ${resSetting.maxPartySize}. Please call for larger groups.` },
        { status: 400 }
      )
    }

    // TODO: Load operating hours from venue settings
    const operatingHours = { open: '11:00', close: '23:00' }

    const result = await createReservationWithRules({
      locationId,
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      reservationDate: date,
      reservationTime: time,
      duration,
      specialRequests,
      occasion,
      dietaryRestrictions,
      sectionPreference,
      smsOptIn,
      source: 'online',
      idempotencyKey,
      actor: { type: 'guest' },
      db,
      settings: resSetting,
      depositRules,
      templates: templates as any,
      operatingHours,
      timezone: location.timezone || 'America/New_York',
      venueInfo: {
        name: location.name,
        phone: location.phone || undefined,
        address: location.address || undefined,
        slug: location.slug || locationId,
        baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://thepasspos.com',
      },
    })

    return NextResponse.json({
      id: result.reservation.id,
      status: result.reservation.status,
      manageToken: result.reservation.manageToken,
      depositRequired: result.depositRequired,
      depositToken: result.depositToken,
      depositExpiresAt: result.depositExpiresAt,
      confirmationCode: result.reservation.id.slice(0, 8).toUpperCase(),
    })
  } catch (error: any) {
    if (error?.code === 'BLACKLISTED') {
      // Neutral message — don't reveal blacklist status
      return NextResponse.json(
        { error: 'Unable to complete this reservation. Please call us to book.' },
        { status: 400 }
      )
    }
    if (error?.code === 'SLOT_UNAVAILABLE') {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    console.error('[Public Create Reservation] Error:', error)
    return NextResponse.json({ error: 'Failed to create reservation' }, { status: 500 })
  }
})

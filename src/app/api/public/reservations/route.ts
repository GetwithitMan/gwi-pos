import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_RESERVATION_SETTINGS, DEFAULT_DEPOSIT_RULES } from '@/lib/settings'
import { createReservationWithRules } from '@/lib/reservations/create-reservation'
import { createRateLimiter } from '@/lib/rate-limiter'
import { err, forbidden, ok } from '@/lib/api-response'

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
      return err('Valid X-Idempotency-Key header is required (16-256 chars)')
    }

    const body = await request.json()

    // Honeypot check — hidden field should not exist at all
    if ('website' in body) {
      return err('Invalid submission', 422)
    }

    const { guestName, guestPhone, guestEmail, partySize, date, time, duration, specialRequests, occasion, dietaryRestrictions, sectionPreference, smsOptIn } = body

    // Input length validation
    if (specialRequests && typeof specialRequests === 'string' && specialRequests.length > 500) {
      return err('Special requests too long (max 500 chars)')
    }
    if (occasion && typeof occasion === 'string' && occasion.length > 100) {
      return err('Occasion too long (max 100 chars)')
    }
    if (dietaryRestrictions && typeof dietaryRestrictions === 'string' && dietaryRestrictions.length > 500) {
      return err('Dietary restrictions too long (max 500 chars)')
    }

    if (!guestName || !partySize || !date || !time) {
      return err('Guest name, party size, date, and time are required')
    }

    if (!guestPhone && !guestEmail) {
      return err('At least a phone number or email is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, phone: true, address: true, slug: true, timezone: true, settings: true },
    })
    if (!location) {
      return err('Location not found')
    }

    const fullSettings = mergeWithDefaults(location.settings as any)
    const resSetting = fullSettings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
    const depositRules = fullSettings.depositRules ?? DEFAULT_DEPOSIT_RULES
    const templates = fullSettings.reservationTemplates

    if (!resSetting.allowOnlineBooking) {
      return forbidden('Online booking is not available')
    }

    if (partySize > resSetting.maxPartySize) {
      return err(`Maximum party size is ${resSetting.maxPartySize}. Please call for larger groups.`)
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

    return ok({
      id: result.reservation.id,
      status: result.reservation.status,
      manageToken: result.reservation.manageToken,
      depositRequired: result.depositRequired,
      depositOptional: result.depositOptional,
      depositToken: result.depositToken,
      depositExpiresAt: result.depositExpiresAt,
      confirmationCode: result.reservation.id.slice(0, 8).toUpperCase(),
    })
  } catch (error: any) {
    if (error?.code === 'BLACKLISTED') {
      // Neutral message — don't reveal blacklist status
      return err('Unable to complete this reservation. Please call us to book.')
    }
    if (error?.code === 'SLOT_UNAVAILABLE') {
      return err(error.message, 409)
    }
    console.error('[Public Create Reservation] Error:', error)
    return err('Failed to create reservation', 500)
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId, getLocationSettings } from '@/lib/location-cache'
import { mergeWithDefaults, DEFAULT_RESERVATION_SETTINGS } from '@/lib/settings'
import { getAvailableSlots } from '@/lib/reservations/availability'
import { createRateLimiter } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })

/**
 * GET /api/public/reservations/availability?date=YYYY-MM-DD&partySize=N
 * Public slot availability for guest booking widget.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`avail:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const rawSettings = await getLocationSettings(locationId)
    const settings = mergeWithDefaults(rawSettings as any)
    const resSetting = settings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS

    // Check if online booking is enabled
    if (!resSetting.allowOnlineBooking) {
      return NextResponse.json({ enabled: false })
    }

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const partySize = parseInt(searchParams.get('partySize') || '2', 10)

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'Valid date (YYYY-MM-DD) is required' }, { status: 400 })
    }

    if (partySize < 1 || partySize > resSetting.maxPartySize) {
      return NextResponse.json(
        { error: `Party size must be between 1 and ${resSetting.maxPartySize}` },
        { status: 400 }
      )
    }

    // Check date is within booking window
    const today = new Date()
    const requestedDate = new Date(date + 'T12:00:00')
    const maxDate = new Date(today)
    maxDate.setDate(maxDate.getDate() + resSetting.maxFutureBookingDays)
    if (requestedDate < today || requestedDate > maxDate) {
      return NextResponse.json({ enabled: true, slots: [] })
    }

    // TODO: Load operating hours from venue settings once hours model exists.
    // For now, use a reasonable default or pass null to let availability engine handle it.
    const operatingHours = getOperatingHoursForDate(date, rawSettings)

    const slots = await getAvailableSlots({
      locationId,
      date,
      partySize,
      db,
      settings: resSetting,
      operatingHours,
      isPublic: true,
    })

    return NextResponse.json({ enabled: true, slots })
  } catch (error) {
    console.error('[Public Availability] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch availability' }, { status: 500 })
  }
})

/**
 * Extract operating hours for a specific date from location settings.
 * Falls back to 11:00-23:00 if no hours configured.
 */
function getOperatingHoursForDate(
  _date: string,
  _settings: any
): { open: string; close: string } | null {
  // TODO: When venue operating hours model is added, read actual hours here.
  // For MVP, return a sensible default that can be overridden per-venue in settings.
  return { open: '11:00', close: '23:00' }
}

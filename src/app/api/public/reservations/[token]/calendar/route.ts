import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { generateICS } from '@/lib/reservations/ics'
import { createRateLimiter } from '@/lib/rate-limiter'
import { err, notFound } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })

/**
 * GET /api/public/reservations/[token]/calendar — Download ICS calendar invite
 * Returns text/calendar content for adding to calendar apps.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`calendar:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location not found')
    }

    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
      select: {
        id: true,
        guestName: true,
        reservationDate: true,
        reservationTime: true,
        duration: true,
        partySize: true,
        specialRequests: true,
      },
    })

    if (!reservation) {
      return notFound('Reservation not found')
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { name: true, slug: true, address: true, timezone: true },
    })

    if (!location) {
      return err('Location not found')
    }

    const icsContent = generateICS({
      reservation: {
        id: reservation.id,
        guestName: reservation.guestName,
        reservationDate: reservation.reservationDate,
        reservationTime: reservation.reservationTime,
        duration: reservation.duration,
        partySize: reservation.partySize,
        specialRequests: reservation.specialRequests || undefined,
      },
      venueName: location.name,
      venueSlug: location.slug || locationId,
      venueAddress: location.address || undefined,
      timezone: location.timezone || 'America/New_York',
    })

    return new NextResponse(icsContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="reservation-${reservation.id.slice(0, 8)}.ics"`,
      },
    })
  } catch (error) {
    console.error('[Public Calendar] Error:', error)
    return err('Failed to generate calendar invite', 500)
  }
})

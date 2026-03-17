import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { createRateLimiter } from '@/lib/rate-limiter'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 60_000 })

/**
 * GET /api/public/reservations/[token] — View reservation by manageToken
 * PII is masked for security. Terminal statuses are readonly.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`view:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { token } = params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const reservation = await db.reservation.findFirst({
      where: { manageToken: token, locationId },
      include: {
        table: { select: { id: true, name: true } },
        customer: { select: { id: true, firstName: true } },
      },
    })

    if (!reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const terminalStatuses = ['completed', 'cancelled', 'no_show']
    const readonly = terminalStatuses.includes(reservation.status)

    // Mask PII
    const maskedPhone = reservation.guestPhone
      ? `***${reservation.guestPhone.slice(-4)}`
      : null
    const maskedEmail = reservation.guestEmail
      ? `${reservation.guestEmail.slice(0, 2)}***@${reservation.guestEmail.split('@')[1] || '***'}`
      : null

    return NextResponse.json({
      id: reservation.id,
      status: reservation.status,
      readonly,
      confirmationCode: reservation.id.slice(0, 8).toUpperCase(),
      guestName: reservation.guestName,
      guestPhone: maskedPhone,
      guestEmail: maskedEmail,
      partySize: reservation.partySize,
      reservationDate: reservation.reservationDate,
      reservationTime: reservation.reservationTime,
      duration: reservation.duration,
      specialRequests: reservation.specialRequests,
      occasion: reservation.occasion,
      table: reservation.table?.name || null,
      depositStatus: reservation.depositStatus,
      depositAmountCents: reservation.depositAmountCents,
      holdExpiresAt: reservation.holdExpiresAt,
    })
  } catch (error) {
    console.error('[Public View Reservation] Error:', error)
    return NextResponse.json({ error: 'Failed to load reservation' }, { status: 500 })
  }
})

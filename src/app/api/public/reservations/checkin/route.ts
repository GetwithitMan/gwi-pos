import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { transition } from '@/lib/reservations/state-machine'
import { formatPhoneE164 } from '@/lib/twilio'
import { createRateLimiter } from '@/lib/rate-limiter'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 60_000 })

/**
 * POST /api/public/reservations/checkin — Self check-in by phone number
 * Body: { phone: string }
 * Matches today's confirmed reservations for this location.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown'
    const rl = limiter.check(`checkin:${ip}`)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const { phone } = await request.json()
    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 })
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'Location not found' }, { status: 400 })
    }

    const normalizedPhone = formatPhoneE164(phone)

    // Find today's confirmed reservations matching this phone
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const matches = await db.reservation.findMany({
      where: {
        locationId,
        guestPhone: normalizedPhone,
        status: 'confirmed',
        reservationDate: {
          gte: today,
          lt: tomorrow,
        },
      },
      select: {
        id: true,
        guestName: true,
        reservationTime: true,
        partySize: true,
        occasion: true,
        table: { select: { id: true, name: true } },
      },
      orderBy: { reservationTime: 'asc' },
    })

    if (matches.length === 0) {
      return NextResponse.json(
        { error: 'No reservation found for today with this phone number' },
        { status: 404 }
      )
    }

    // Ambiguous — multiple matches. Privacy: NEVER expose other guests' details
    if (matches.length > 1) {
      // Log with phone hash only (no PII)
      const phoneHash = crypto.createHash('sha256').update(normalizedPhone).digest('hex').slice(0, 32)
      void db.reservationEvent.create({
        data: {
          locationId,
          eventType: 'checkin_ambiguous',
          actor: 'guest',
          details: {
            phoneHash,
            matchCount: matches.length,
          },
        },
      }).catch(console.error)

      return NextResponse.json(
        { error: 'Multiple reservations found', code: 'AMBIGUOUS' },
        { status: 409 }
      )
    }

    // Single match — auto check-in
    const reservation = matches[0]
    const updated = await db.$transaction(async (tx: any) => {
      return transition({
        reservationId: reservation.id,
        to: 'checked_in',
        actor: { type: 'guest' },
        db: tx,
        locationId,
      })
    })

    // Post-commit: socket dispatch
    void dispatchReservationChanged(locationId, {
      reservationId: reservation.id, action: 'checked_in',
    }).catch(console.error)

    return NextResponse.json({
      id: updated.id,
      status: 'checked_in',
      guestName: reservation.guestName,
      reservationTime: reservation.reservationTime,
      partySize: reservation.partySize,
      tableName: reservation.table?.name ?? null,
      occasion: reservation.occasion ?? null,
    })
  } catch (error: any) {
    if (error?.name === 'TransitionError') {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('[Public Check-in] Error:', error)
    return NextResponse.json({ error: 'Failed to check in' }, { status: 500 })
  }
})

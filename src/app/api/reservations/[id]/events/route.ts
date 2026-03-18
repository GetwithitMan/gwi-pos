import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { getRequestLocationId } from '@/lib/request-context'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    // Fast path: request context (JWT/cellular). Fallback: cached location.
    const locationId = getRequestLocationId() || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const actor = await getActorFromRequest(request)
    const auth = await requirePermission(actor.employeeId, locationId, 'tables.reservations')
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Permission denied' }, { status: 403 })
    }

    // Verify the reservation belongs to this location
    const reservation = await db.reservation.findUnique({
      where: { id },
      select: { locationId: true },
    })
    if (!reservation || reservation.locationId !== locationId) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 })
    }

    const sp = request.nextUrl.searchParams
    const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200)
    const offset = parseInt(sp.get('offset') || '0', 10)

    const [events, total] = await Promise.all([
      db.reservationEvent.findMany({
        where: { reservationId: id },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.reservationEvent.count({ where: { reservationId: id } }),
    ])

    return NextResponse.json({
      data: events,
      pagination: { total, limit, offset },
    })
  } catch (error) {
    console.error('[reservations/[id]/events] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }
})

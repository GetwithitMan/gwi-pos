import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
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

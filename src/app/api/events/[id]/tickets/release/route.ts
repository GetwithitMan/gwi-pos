import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Release held tickets
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { ticketIds, sessionId } = body

    if (!ticketIds || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'Ticket IDs are required' },
        { status: 400 }
      )
    }

    // Find tickets
    const tickets = await db.ticket.findMany({
      where: {
        id: { in: ticketIds },
        eventId: id,
        status: 'held',
      },
    })

    if (tickets.length === 0) {
      return NextResponse.json(
        { error: 'No held tickets found' },
        { status: 404 }
      )
    }

    // If sessionId provided, only release tickets held by that session
    const ticketsToRelease = sessionId
      ? tickets.filter(t => t.heldBySessionId === sessionId)
      : tickets

    if (ticketsToRelease.length === 0) {
      return NextResponse.json(
        { error: 'No tickets to release for this session' },
        { status: 404 }
      )
    }

    // Soft delete the held tickets (they were never sold)
    const result = await db.ticket.updateMany({
      where: {
        id: { in: ticketsToRelease.map(t => t.id) },
        status: 'held',
      },
      data: { deletedAt: new Date(), status: 'available' },
    })

    return NextResponse.json({ data: {
      success: true,
      releasedCount: result.count,
      releasedTicketIds: ticketsToRelease.map(t => t.id),
      message: `${result.count} ticket(s) released successfully`,
    } })
  } catch (error) {
    console.error('Failed to release tickets:', error)
    return NextResponse.json(
      { error: 'Failed to release tickets' },
      { status: 500 }
    )
  }
})

// DELETE - Release all held tickets for an event (cleanup endpoint)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const expiredOnly = searchParams.get('expiredOnly') === 'true'

    const now = new Date()

    const whereClause: Record<string, unknown> = {
      eventId: id,
      status: 'held',
    }

    if (expiredOnly) {
      whereClause.heldUntil = { lt: now }
    }

    // Soft delete expired/all held tickets
    const result = await db.ticket.updateMany({
      where: whereClause,
      data: { deletedAt: new Date(), status: 'available' },
    })

    return NextResponse.json({ data: {
      success: true,
      releasedCount: result.count,
      message: expiredOnly
        ? `${result.count} expired hold(s) released`
        : `${result.count} held ticket(s) released`,
    } })
  } catch (error) {
    console.error('Failed to release tickets:', error)
    return NextResponse.json(
      { error: 'Failed to release tickets' },
      { status: 500 }
    )
  }
})

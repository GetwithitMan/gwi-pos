import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Release held tickets
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { ticketIds, sessionId } = body

    if (!ticketIds || ticketIds.length === 0) {
      return err('Ticket IDs are required')
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
      return notFound('No held tickets found')
    }

    // If sessionId provided, only release tickets held by that session
    const ticketsToRelease = sessionId
      ? tickets.filter(t => t.heldBySessionId === sessionId)
      : tickets

    if (ticketsToRelease.length === 0) {
      return notFound('No tickets to release for this session')
    }

    // Soft delete the held tickets (they were never sold)
    const result = await db.ticket.updateMany({
      where: {
        id: { in: ticketsToRelease.map(t => t.id) },
        status: 'held',
      },
      data: { deletedAt: new Date(), status: 'available' },
    })

    pushUpstream()

    return ok({
      success: true,
      releasedCount: result.count,
      releasedTicketIds: ticketsToRelease.map(t => t.id),
      message: `${result.count} ticket(s) released successfully`,
    })
  } catch (error) {
    console.error('Failed to release tickets:', error)
    return err('Failed to release tickets', 500)
  }
}))

// DELETE - Release all held tickets for an event (cleanup endpoint)
export const DELETE = withVenue(withAuth(async function DELETE(
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

    pushUpstream()

    return ok({
      success: true,
      releasedCount: result.count,
      message: expiredOnly
        ? `${result.count} expired hold(s) released`
        : `${result.count} held ticket(s) released`,
    })
  } catch (error) {
    console.error('Failed to release tickets:', error)
    return err('Failed to release tickets', 500)
  }
}))

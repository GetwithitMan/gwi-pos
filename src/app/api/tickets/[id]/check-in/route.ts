import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Check in a ticket
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { employeeId, method = 'scan' } = body // method: 'scan' or 'manual'

    // Try to find by ID, ticket number, or barcode
    const ticket = await db.ticket.findFirst({
      where: {
        OR: [
          { id },
          { ticketNumber: id },
          { barcode: id },
        ],
      },
      include: {
        event: {
          select: {
            id: true,
            name: true,
            eventDate: true,
            doorsOpen: true,
            startTime: true,
            status: true,
          },
        },
        seat: {
          select: { id: true, label: true, seatNumber: true },
        },
        table: {
          select: { id: true, name: true },
        },
        pricingTier: {
          select: { id: true, name: true, color: true },
        },
      },
    })

    if (!ticket) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ticket not found',
          checkInResult: 'invalid',
        },
        { status: 404 }
      )
    }

    // Check if already checked in
    if (ticket.status === 'checked_in') {
      return NextResponse.json({
        success: false,
        error: 'Ticket already checked in',
        checkInResult: 'already_checked_in',
        checkedInAt: ticket.checkedInAt?.toISOString(),
        ticket: {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          seat: ticket.seat,
          table: ticket.table,
          pricingTier: ticket.pricingTier,
        },
      })
    }

    // Check ticket status
    if (ticket.status !== 'sold') {
      const statusMessages: Record<string, string> = {
        available: 'Ticket has not been purchased',
        held: 'Ticket is on hold but not purchased',
        cancelled: 'Ticket has been cancelled',
        refunded: 'Ticket has been refunded',
      }

      return NextResponse.json(
        {
          success: false,
          error: statusMessages[ticket.status] || 'Invalid ticket status',
          checkInResult: 'invalid_status',
          currentStatus: ticket.status,
        },
        { status: 400 }
      )
    }

    // Check event date (optional - could allow early check-in)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const eventDate = new Date(ticket.event.eventDate)
    eventDate.setHours(0, 0, 0, 0)

    if (eventDate.getTime() !== today.getTime()) {
      const isEventPassed = eventDate < today
      return NextResponse.json(
        {
          success: false,
          error: isEventPassed
            ? 'This ticket is for a past event'
            : 'This ticket is for a future event',
          checkInResult: isEventPassed ? 'past_event' : 'future_event',
          eventDate: ticket.event.eventDate.toISOString().split('T')[0],
        },
        { status: 400 }
      )
    }

    // Perform check-in
    const now = new Date()
    const updatedTicket = await db.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'checked_in',
        checkedInAt: now,
        checkedInBy: employeeId,
      },
      include: {
        seat: {
          select: { id: true, label: true, seatNumber: true },
        },
        table: {
          select: { id: true, name: true },
        },
        pricingTier: {
          select: { id: true, name: true, color: true },
        },
      },
    })

    // Get check-in stats for the event
    const checkInStats = await db.ticket.groupBy({
      by: ['status'],
      where: {
        eventId: ticket.eventId,
        status: { in: ['sold', 'checked_in'] },
      },
      _count: { id: true },
    })

    const checkedInCount = checkInStats.find(s => s.status === 'checked_in')?._count.id || 0
    const soldCount = checkInStats.find(s => s.status === 'sold')?._count.id || 0
    const totalAttendees = checkedInCount + soldCount

    return NextResponse.json({
      success: true,
      checkInResult: 'success',
      checkedInAt: now.toISOString(),
      method,
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        barcode: updatedTicket.barcode,
        customerName: updatedTicket.customerName,
        seatLabel: updatedTicket.seat?.label,
        seatNumber: updatedTicket.seat?.seatNumber,
        tableName: updatedTicket.table?.name,
        pricingTier: updatedTicket.pricingTier.name,
        tierColor: updatedTicket.pricingTier.color,
      },
      event: {
        id: ticket.event.id,
        name: ticket.event.name,
        eventDate: ticket.event.eventDate.toISOString().split('T')[0],
      },
      stats: {
        checkedIn: checkedInCount,
        remaining: soldCount,
        total: totalAttendees,
        percentCheckedIn: totalAttendees > 0
          ? Math.round((checkedInCount / totalAttendees) * 100)
          : 0,
      },
    })
  } catch (error) {
    console.error('Failed to check in ticket:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to check in ticket',
        checkInResult: 'error',
      },
      { status: 500 }
    )
  }
})

// DELETE - Undo check-in (revert to sold status)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const ticket = await db.ticket.findFirst({
      where: {
        OR: [
          { id },
          { ticketNumber: id },
          { barcode: id },
        ],
        status: 'checked_in',
      },
    })

    if (!ticket) {
      return NextResponse.json(
        { error: 'Checked-in ticket not found' },
        { status: 404 }
      )
    }

    const updated = await db.ticket.update({
      where: { id: ticket.id },
      data: {
        status: 'sold',
        checkedInAt: null,
        checkedInBy: null,
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Check-in reverted',
      ticket: updated,
    })
  } catch (error) {
    console.error('Failed to undo check-in:', error)
    return NextResponse.json(
      { error: 'Failed to undo check-in' },
      { status: 500 }
    )
  }
})

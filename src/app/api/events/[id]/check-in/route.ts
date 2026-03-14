import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// POST - Check in by ticket number or barcode (event-scoped)
// This is a convenience endpoint that wraps /api/tickets/[id]/check-in
// but scoped to a specific event for validation.
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const { id: eventId } = await params
    const body = await request.json()
    const { ticketIdentifier, employeeId, method = 'scan' } = body

    if (!ticketIdentifier) {
      return NextResponse.json(
        { error: 'ticketIdentifier is required (ticket number or barcode)' },
        { status: 400 }
      )
    }

    // Verify event exists
    const event = await db.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        eventDate: true,
        status: true,
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Find ticket by number or barcode, scoped to this event
    const ticket = await db.ticket.findFirst({
      where: {
        locationId,
        eventId,
        OR: [
          { ticketNumber: ticketIdentifier },
          { barcode: ticketIdentifier },
          { id: ticketIdentifier },
        ],
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

    if (!ticket) {
      return NextResponse.json({ data: {
        success: false,
        checkInResult: 'invalid',
        error: 'Ticket not found for this event',
      } })
    }

    if (ticket.status === 'checked_in') {
      return NextResponse.json({ data: {
        success: false,
        checkInResult: 'already_checked_in',
        error: 'Ticket already checked in',
        checkedInAt: ticket.checkedInAt?.toISOString(),
        ticket: {
          ticketNumber: ticket.ticketNumber,
          customerName: ticket.customerName,
          seatLabel: ticket.seat?.label,
          tableName: ticket.table?.name,
          pricingTier: ticket.pricingTier.name,
          tierColor: ticket.pricingTier.color,
        },
      } })
    }

    if (ticket.status !== 'sold') {
      return NextResponse.json({ data: {
        success: false,
        checkInResult: 'invalid_status',
        error: `Ticket status is "${ticket.status}" - only sold tickets can be checked in`,
      } })
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

    // Get updated stats
    const checkInStats = await db.ticket.groupBy({
      by: ['status'],
      where: {
        eventId,
        status: { in: ['sold', 'checked_in'] },
      },
      _count: { id: true },
    })

    const checkedInCount = checkInStats.find(s => s.status === 'checked_in')?._count.id || 0
    const soldCount = checkInStats.find(s => s.status === 'sold')?._count.id || 0
    const totalAttendees = checkedInCount + soldCount

    return NextResponse.json({ data: {
      success: true,
      checkInResult: 'success',
      checkedInAt: now.toISOString(),
      method,
      ticket: {
        id: updatedTicket.id,
        ticketNumber: updatedTicket.ticketNumber,
        customerName: updatedTicket.customerName,
        seatLabel: updatedTicket.seat?.label,
        tableName: updatedTicket.table?.name,
        pricingTier: updatedTicket.pricingTier.name,
        tierColor: updatedTicket.pricingTier.color,
      },
      stats: {
        checkedIn: checkedInCount,
        remaining: soldCount,
        total: totalAttendees,
        percentCheckedIn: totalAttendees > 0
          ? Math.round((checkedInCount / totalAttendees) * 100)
          : 0,
      },
    } })
  } catch (error) {
    console.error('Failed to check in:', error)
    return NextResponse.json(
      { error: 'Failed to check in' },
      { status: 500 }
    )
  }
})

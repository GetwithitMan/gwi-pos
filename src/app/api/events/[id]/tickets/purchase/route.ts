import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Complete ticket purchase
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      ticketIds,
      customerName,
      customerEmail,
      customerPhone,
      customerId,
      purchaseChannel = 'pos', // 'pos' or 'online'
      orderId,
      // paymentReference - reserved for payment integration
    } = body

    if (!ticketIds || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'Ticket IDs are required' },
        { status: 400 }
      )
    }

    if (!customerName) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      )
    }

    // Validate event
    const event = await db.event.findUnique({
      where: { id },
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

    if (!['on_sale', 'draft'].includes(event.status)) {
      return NextResponse.json(
        { error: 'Event is not available for ticket sales' },
        { status: 400 }
      )
    }

    const now = new Date()

    // Find and validate tickets
    const tickets = await db.ticket.findMany({
      where: {
        id: { in: ticketIds },
        eventId: id,
      },
      include: {
        pricingTier: true,
      },
    })

    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'One or more tickets not found' },
        { status: 400 }
      )
    }

    // Check ticket statuses
    const invalidTickets = tickets.filter(t => {
      if (t.status === 'sold' || t.status === 'checked_in') {
        return true // Already sold
      }
      if (t.status === 'held' && t.heldUntil && new Date(t.heldUntil) < now) {
        return true // Hold expired
      }
      if (t.status === 'cancelled' || t.status === 'refunded') {
        return true // Invalid status
      }
      return false
    })

    if (invalidTickets.length > 0) {
      return NextResponse.json(
        {
          error: 'One or more tickets are no longer available',
          invalidTicketIds: invalidTickets.map(t => t.id),
        },
        { status: 409 }
      )
    }

    // Calculate totals
    const totalBasePrice = tickets.reduce((sum, t) => sum + Number(t.basePrice), 0)
    const totalServiceFee = tickets.reduce((sum, t) => sum + Number(t.serviceFee), 0)
    const totalTax = tickets.reduce((sum, t) => sum + Number(t.taxAmount), 0)
    const grandTotal = tickets.reduce((sum, t) => sum + Number(t.totalPrice), 0)

    // Complete purchase in transaction
    const result = await db.$transaction(async (tx) => {
      // Update all tickets
      const updatedTickets = await Promise.all(
        tickets.map(ticket =>
          tx.ticket.update({
            where: { id: ticket.id },
            data: {
              status: 'sold',
              customerName,
              customerEmail,
              customerPhone,
              customerId,
              purchasedAt: now,
              purchaseChannel,
              orderId,
              heldAt: null,
              heldUntil: null,
              heldBySessionId: null,
            },
            include: {
              seat: {
                select: { id: true, label: true, seatNumber: true },
              },
              table: {
                select: { id: true, name: true },
              },
              pricingTier: {
                select: { id: true, name: true, price: true },
              },
            },
          })
        )
      )

      // Update pricing tier sold counts
      const tierCounts: Record<string, number> = {}
      for (const ticket of tickets) {
        tierCounts[ticket.pricingTierId] = (tierCounts[ticket.pricingTierId] || 0) + 1
      }

      for (const [tierId, count] of Object.entries(tierCounts)) {
        await tx.eventPricingTier.update({
          where: { id: tierId },
          data: {
            quantitySold: { increment: count },
          },
        })
      }

      return updatedTickets
    })

    return NextResponse.json({
      success: true,
      purchasedAt: now.toISOString(),
      orderSummary: {
        ticketCount: result.length,
        totalBasePrice,
        totalServiceFee,
        totalTax,
        grandTotal,
      },
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone,
        customerId,
      },
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate.toISOString().split('T')[0],
      },
      tickets: result.map(ticket => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        seatId: ticket.seatId,
        seatLabel: ticket.seat?.label,
        seatNumber: ticket.seat?.seatNumber,
        tableId: ticket.tableId,
        tableName: ticket.table?.name,
        pricingTier: ticket.pricingTier.name,
        basePrice: Number(ticket.basePrice),
        serviceFee: Number(ticket.serviceFee),
        taxAmount: Number(ticket.taxAmount),
        totalPrice: Number(ticket.totalPrice),
        status: ticket.status,
      })),
    })
  } catch (error) {
    console.error('Failed to purchase tickets:', error)
    return NextResponse.json(
      { error: 'Failed to purchase tickets' },
      { status: 500 }
    )
  }
})

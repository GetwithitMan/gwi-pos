import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// POST - Refund a ticket
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      refundAmount,
      refundReason,
      processedBy,
      refundReference,
    } = body

    const ticket = await db.ticket.findUnique({
      where: { id },
      include: {
        pricingTier: true,
        event: {
          select: { id: true, name: true },
        },
      },
    })

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      )
    }

    if (ticket.status === 'refunded') {
      return NextResponse.json(
        { error: 'Ticket has already been refunded' },
        { status: 400 }
      )
    }

    if (!['sold', 'checked_in', 'cancelled'].includes(ticket.status)) {
      return NextResponse.json(
        { error: 'Only sold, checked-in, or cancelled tickets can be refunded' },
        { status: 400 }
      )
    }

    const wasSoldOrCheckedIn = ['sold', 'checked_in'].includes(ticket.status)
    const actualRefundAmount = refundAmount ?? Number(ticket.totalPrice)

    // Process refund
    const now = new Date()
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id },
        data: {
          status: 'refunded',
          refundedAt: now,
          refundAmount: actualRefundAmount,
          cancelReason: refundReason || 'Refunded',
          cancelledAt: ticket.cancelledAt || now,
        },
        select: {
          id: true,
          ticketNumber: true,
          customerName: true,
          customerEmail: true,
          totalPrice: true,
          refundAmount: true,
          refundedAt: true,
        },
      })

      // Decrement sold count if was sold/checked_in (and not already cancelled)
      if (wasSoldOrCheckedIn) {
        await tx.eventPricingTier.update({
          where: { id: ticket.pricingTierId },
          data: {
            quantitySold: { decrement: 1 },
          },
        })
      }

      return updated
    })

    return NextResponse.json({
      success: true,
      message: 'Ticket refunded successfully',
      refund: {
        ticketId: result.id,
        ticketNumber: result.ticketNumber,
        customerName: result.customerName,
        customerEmail: result.customerEmail,
        originalAmount: Number(result.totalPrice),
        refundAmount: Number(result.refundAmount),
        refundedAt: result.refundedAt?.toISOString(),
        refundReference,
        processedBy,
      },
      event: {
        id: ticket.event.id,
        name: ticket.event.name,
      },
    })
  } catch (error) {
    console.error('Failed to refund ticket:', error)
    return NextResponse.json(
      { error: 'Failed to refund ticket' },
      { status: 500 }
    )
  }
})

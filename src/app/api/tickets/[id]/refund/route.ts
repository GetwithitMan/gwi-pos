import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Refund a ticket
export const POST = withVenue(withAuth('MGR_REFUNDS', async function POST(
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
      return notFound('Ticket not found')
    }

    if (ticket.status === 'refunded') {
      return err('Ticket has already been refunded')
    }

    if (!['sold', 'checked_in', 'cancelled'].includes(ticket.status)) {
      return err('Only sold, checked-in, or cancelled tickets can be refunded')
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

    pushUpstream()

    return ok({
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
    return err('Failed to refund ticket', 500)
  }
}))

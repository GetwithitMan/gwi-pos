import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get ticket details
export const GET = withVenue(withAuth(PERMISSIONS.EVENTS_VIEW, async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Try to find by ID first, then by ticket number, then by barcode
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
            endTime: true,
            status: true,
            location: {
              select: {
                id: true,
                name: true,
                address: true,
              },
            },
          },
        },
        seat: {
          select: {
            id: true,
            label: true,
            seatNumber: true,
            seatType: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
            section: {
              select: { id: true, name: true },
            },
          },
        },
        pricingTier: {
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
    })

    if (!ticket) {
      return notFound('Ticket not found')
    }

    return ok({
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        status: ticket.status,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        customerPhone: ticket.customerPhone,
        basePrice: Number(ticket.basePrice),
        serviceFee: Number(ticket.serviceFee),
        taxAmount: Number(ticket.taxAmount),
        totalPrice: Number(ticket.totalPrice),
        purchasedAt: ticket.purchasedAt?.toISOString(),
        purchaseChannel: ticket.purchaseChannel,
        checkedInAt: ticket.checkedInAt?.toISOString(),
        checkedInBy: ticket.checkedInBy,
        cancelledAt: ticket.cancelledAt?.toISOString(),
        cancelReason: ticket.cancelReason,
        refundedAt: ticket.refundedAt?.toISOString(),
        refundAmount: ticket.refundAmount ? Number(ticket.refundAmount) : null,
        event: {
          id: ticket.event.id,
          name: ticket.event.name,
          eventDate: ticket.event.eventDate.toISOString().split('T')[0],
          doorsOpen: ticket.event.doorsOpen,
          startTime: ticket.event.startTime,
          endTime: ticket.event.endTime,
          status: ticket.event.status,
          location: ticket.event.location,
        },
        seat: ticket.seat
          ? {
              id: ticket.seat.id,
              label: ticket.seat.label,
              seatNumber: ticket.seat.seatNumber,
              seatType: ticket.seat.seatType,
            }
          : null,
        table: ticket.table
          ? {
              id: ticket.table.id,
              name: ticket.table.name,
              section: ticket.table.section,
            }
          : null,
        pricingTier: {
          id: ticket.pricingTier.id,
          name: ticket.pricingTier.name,
          description: ticket.pricingTier.description,
          color: ticket.pricingTier.color,
        },
        customer: ticket.customer
          ? {
              id: ticket.customer.id,
              name: `${ticket.customer.firstName} ${ticket.customer.lastName}`,
              email: ticket.customer.email,
              phone: ticket.customer.phone,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch ticket:', error)
    return err('Failed to fetch ticket', 500)
  }
}))

// PUT - Update ticket (transfer, update customer info)
export const PUT = withVenue(withAuth(PERMISSIONS.EVENTS_MANAGE, async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      customerName,
      customerEmail,
      customerPhone,
      customerId,
    } = body

    const ticket = await db.ticket.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!ticket) {
      return notFound('Ticket not found')
    }

    if (!['sold', 'checked_in'].includes(ticket.status)) {
      return err('Can only update sold or checked-in tickets')
    }

    const updated = await db.ticket.update({
      where: { id },
      data: {
        ...(customerName !== undefined ? { customerName } : {}),
        ...(customerEmail !== undefined ? { customerEmail } : {}),
        ...(customerPhone !== undefined ? { customerPhone } : {}),
        ...(customerId !== undefined ? { customerId } : {}),
      },
      select: {
        id: true,
        ticketNumber: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
      },
    })

    pushUpstream()

    return ok({
      success: true,
      ticket: updated,
    })
  } catch (error) {
    console.error('Failed to update ticket:', error)
    return err('Failed to update ticket', 500)
  }
}))

// DELETE - Cancel ticket
export const DELETE = withVenue(withAuth(PERMISSIONS.EVENTS_MANAGE, async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const reason = searchParams.get('reason') || 'Cancelled by staff'

    const ticket = await db.ticket.findUnique({
      where: { id },
      include: {
        pricingTier: true,
      },
    })

    if (!ticket) {
      return notFound('Ticket not found')
    }

    if (['cancelled', 'refunded'].includes(ticket.status)) {
      return err('Ticket is already cancelled or refunded')
    }

    const wasSold = ticket.status === 'sold' || ticket.status === 'checked_in'

    // Cancel the ticket
    await db.$transaction(async (tx) => {
      await tx.ticket.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
        },
      })

      // Decrement sold count if was sold
      if (wasSold) {
        await tx.eventPricingTier.update({
          where: { id: ticket.pricingTierId },
          data: {
            quantitySold: { decrement: 1 },
          },
        })
      }
    })

    pushUpstream()

    return ok({
      success: true,
      message: 'Ticket cancelled successfully',
      ticketNumber: ticket.ticketNumber,
    })
  } catch (error) {
    console.error('Failed to cancel ticket:', error)
    return err('Failed to cancel ticket', 500)
  }
}))

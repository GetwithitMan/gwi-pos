import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// Generate ticket number: EVT-YYYYMMDD-XXXXX
function generateTicketNumber(eventDate: Date, sequence: number): string {
  const dateStr = eventDate.toISOString().split('T')[0].replace(/-/g, '')
  return `EVT-${dateStr}-${String(sequence).padStart(5, '0')}`
}

function generateBarcode(): string {
  return randomBytes(8).toString('hex').toUpperCase()
}

// POST - Create walk-in / cover charge tickets
// These are created as already-sold and optionally already checked-in.
// Used for walk-in guests who pay the cover charge at the door.
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      quantity = 1,
      pricingTierId,
      customerName,
      customerEmail,
      customerPhone,
      autoCheckIn = true, // Walk-ins are usually immediately checked in
      employeeId,
    } = body

    if (!pricingTierId) {
      return err('pricingTierId is required')
    }

    if (quantity < 1 || quantity > 50) {
      return err('Quantity must be between 1 and 50')
    }

    // Validate event
    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        name: true,
        eventDate: true,
        status: true,
        totalCapacity: true,
        reservedCapacity: true,
        pricingTiers: {
          where: { isActive: true, deletedAt: null },
        },
      },
    })

    if (!event) {
      return notFound('Event not found')
    }

    if (!['on_sale', 'draft'].includes(event.status)) {
      return err('Event is not available for walk-ins')
    }

    // Validate pricing tier
    const pricingTier = event.pricingTiers.find(t => t.id === pricingTierId)
    if (!pricingTier) {
      return err('Invalid pricing tier')
    }

    // Check capacity
    const currentSold = await db.ticket.count({
      where: {
        eventId: id,
        status: { in: ['sold', 'held', 'checked_in'] },
      },
    })

    const availableCapacity = event.totalCapacity - currentSold
    if (quantity > availableCapacity) {
      return err(`Only ${availableCapacity} spots remaining (capacity: ${event.totalCapacity}, sold/held: ${currentSold})`)
    }

    // Check tier quantity limit
    if (pricingTier.quantityAvailable) {
      const remaining = pricingTier.quantityAvailable - pricingTier.quantitySold
      if (quantity > remaining) {
        return err(`Only ${remaining} tickets remaining for ${pricingTier.name}`)
      }
    }

    // Get current ticket count for sequence numbers
    const ticketCount = await db.ticket.count({
      where: { eventId: id },
    })

    const now = new Date()

    // Create tickets in transaction
    const result = await db.$transaction(async (tx) => {
      const tickets = []

      for (let i = 0; i < quantity; i++) {
        const ticket = await tx.ticket.create({
          data: {
            locationId: event.locationId,
            eventId: id,
            pricingTierId,
            ticketNumber: generateTicketNumber(event.eventDate, ticketCount + i + 1),
            barcode: generateBarcode(),
            customerName: customerName || 'Walk-in',
            customerEmail,
            customerPhone,
            basePrice: pricingTier.price,
            serviceFee: pricingTier.serviceFee,
            taxAmount: 0,
            totalPrice: Number(pricingTier.price) + Number(pricingTier.serviceFee),
            status: autoCheckIn ? 'checked_in' : 'sold',
            purchasedAt: now,
            purchaseChannel: 'door',
            ...(autoCheckIn ? {
              checkedInAt: now,
              checkedInBy: employeeId,
            } : {}),
          },
          include: {
            pricingTier: {
              select: { id: true, name: true, color: true },
            },
          },
        })
        tickets.push(ticket)
      }

      // Update pricing tier sold count
      await tx.eventPricingTier.update({
        where: { id: pricingTierId },
        data: {
          quantitySold: { increment: quantity },
        },
      })

      return tickets
    })

    pushUpstream()

    const totalPrice = result.reduce((sum, t) => sum + Number(t.totalPrice), 0)

    return ok({
      success: true,
      walkInCount: result.length,
      autoCheckIn,
      totalPrice,
      event: {
        id: event.id,
        name: event.name,
      },
      tickets: result.map(ticket => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        status: ticket.status,
        customerName: ticket.customerName,
        pricingTier: ticket.pricingTier.name,
        totalPrice: Number(ticket.totalPrice),
      })),
    })
  } catch (error) {
    console.error('Failed to create walk-in tickets:', error)
    return err('Failed to create walk-in tickets', 500)
  }
}))

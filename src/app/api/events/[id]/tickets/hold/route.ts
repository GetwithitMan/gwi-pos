import { NextRequest, NextResponse } from 'next/server'
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

// Generate barcode: random alphanumeric string
function generateBarcode(): string {
  return randomBytes(8).toString('hex').toUpperCase()
}

// POST - Hold seats/tickets temporarily
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      seatIds = [],
      tableId, // For per_table mode
      pricingTierId,
      quantity = 1, // For general admission
      sessionId,
      holdDurationMinutes = 10,
    } = body

    // Validate event
    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        eventDate: true,
        ticketingMode: true,
        status: true,
        totalCapacity: true,
        pricingTiers: {
          where: { isActive: true },
        },
      },
    })

    if (!event) {
      return notFound('Event not found')
    }

    if (!['on_sale', 'draft'].includes(event.status)) {
      return err('Event is not available for ticket sales')
    }

    // Validate pricing tier
    const pricingTier = event.pricingTiers.find(t => t.id === pricingTierId)
    if (!pricingTier) {
      return err('Invalid pricing tier')
    }

    const now = new Date()
    const holdUntil = new Date(now.getTime() + holdDurationMinutes * 60 * 1000)

    // Get current ticket count for sequence number
    const ticketCount = await db.ticket.count({
      where: { eventId: id },
    })

    const ticketsToCreate: {
      seatId?: string
      tableId?: string
      ticketNumber: string
      barcode: string
    }[] = []

    if (event.ticketingMode === 'per_seat' && seatIds.length > 0) {
      // Validate seats exist and are available
      const seats = await db.seat.findMany({
        where: {
          id: { in: seatIds },
          locationId: event.locationId,
          isActive: true,
        },
        include: {
          table: {
            select: { id: true },
          },
        },
      })

      if (seats.length !== seatIds.length) {
        return err('One or more seats not found')
      }

      // Check if any seats are already taken
      const existingTickets = await db.ticket.findMany({
        where: {
          eventId: id,
          seatId: { in: seatIds },
          status: { in: ['held', 'sold', 'checked_in'] },
          OR: [
            { status: { in: ['sold', 'checked_in'] } },
            {
              status: 'held',
              heldUntil: { gt: now },
            },
          ],
        },
        select: { seatId: true },
      })

      if (existingTickets.length > 0) {
        return NextResponse.json(
          {
            error: 'One or more seats are not available',
            unavailableSeatIds: existingTickets.map(t => t.seatId),
          },
          { status: 409 }
        )
      }

      // Create ticket data for each seat
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i]
        ticketsToCreate.push({
          seatId: seat.id,
          tableId: seat.table.id,
          ticketNumber: generateTicketNumber(event.eventDate, ticketCount + i + 1),
          barcode: generateBarcode(),
        })
      }
    } else if (event.ticketingMode === 'per_table' && tableId) {
      // Validate table and get all its seats
      const table = await db.table.findFirst({
        where: {
          id: tableId,
          locationId: event.locationId,
          isActive: true,
        },
        include: {
          seats: {
            where: { isActive: true },
            orderBy: { seatNumber: 'asc' },
          },
        },
      })

      if (!table) {
        return err('Table not found')
      }

      // Check if table already has tickets
      const existingTableTickets = await db.ticket.findFirst({
        where: {
          eventId: id,
          tableId,
          status: { in: ['held', 'sold', 'checked_in'] },
          OR: [
            { status: { in: ['sold', 'checked_in'] } },
            {
              status: 'held',
              heldUntil: { gt: now },
            },
          ],
        },
      })

      if (existingTableTickets) {
        return err('Table is not available', 409)
      }

      // Create tickets for all seats at the table
      for (let i = 0; i < table.seats.length; i++) {
        const seat = table.seats[i]
        ticketsToCreate.push({
          seatId: seat.id,
          tableId: table.id,
          ticketNumber: generateTicketNumber(event.eventDate, ticketCount + i + 1),
          barcode: generateBarcode(),
        })
      }
    } else if (event.ticketingMode === 'general_admission') {
      // Check quantity limits
      if (pricingTier.quantityAvailable) {
        const soldCount = pricingTier.quantitySold
        const remaining = pricingTier.quantityAvailable - soldCount
        if (quantity > remaining) {
          return err(`Only ${remaining} tickets available`)
        }
      }

      // Create general admission tickets
      for (let i = 0; i < quantity; i++) {
        ticketsToCreate.push({
          ticketNumber: generateTicketNumber(event.eventDate, ticketCount + i + 1),
          barcode: generateBarcode(),
        })
      }
    } else {
      return err('Invalid request for this ticketing mode')
    }

    // Create tickets in transaction
    const tickets = await db.$transaction(
      ticketsToCreate.map((ticketData) =>
        db.ticket.create({
          data: {
            locationId: event.locationId,
            eventId: id,
            pricingTierId,
            seatId: ticketData.seatId,
            tableId: ticketData.tableId,
            ticketNumber: ticketData.ticketNumber,
            barcode: ticketData.barcode,
            basePrice: pricingTier.price,
            serviceFee: pricingTier.serviceFee,
            taxAmount: 0, // Would calculate based on location tax settings
            totalPrice: Number(pricingTier.price) + Number(pricingTier.serviceFee),
            status: 'held',
            heldAt: now,
            heldUntil: holdUntil,
            heldBySessionId: sessionId,
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

    pushUpstream()

    const totalPrice = tickets.reduce(
      (sum, t) => sum + Number(t.totalPrice),
      0
    )

    return ok({
      success: true,
      holdExpiresAt: holdUntil.toISOString(),
      holdDurationMinutes,
      ticketCount: tickets.length,
      totalPrice,
      tickets: tickets.map(ticket => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        seatId: ticket.seatId,
        seatLabel: ticket.seat?.label,
        tableId: ticket.tableId,
        tableName: ticket.table?.name,
        pricingTier: ticket.pricingTier.name,
        basePrice: Number(ticket.basePrice),
        serviceFee: Number(ticket.serviceFee),
        totalPrice: Number(ticket.totalPrice),
        status: ticket.status,
      })),
    })
  } catch (error) {
    console.error('Failed to hold tickets:', error)
    return err('Failed to hold tickets', 500)
  }
}))

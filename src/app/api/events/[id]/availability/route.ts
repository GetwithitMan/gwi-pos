import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get seat/table availability for an event
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        name: true,
        eventDate: true,
        doorsOpen: true,
        startTime: true,
        endTime: true,
        ticketingMode: true,
        totalCapacity: true,
        reservedCapacity: true,
        status: true,
        pricingTiers: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            price: true,
            serviceFee: true,
            quantityAvailable: true,
            quantitySold: true,
            maxPerOrder: true,
            sectionIds: true,
          },
        },
        tableConfigurations: {
          where: { isIncluded: true },
          include: {
            table: {
              include: {
                seats: {
                  where: { isActive: true },
                  orderBy: { seatNumber: 'asc' },
                },
                section: {
                  select: { id: true, name: true },
                },
              },
            },
            pricingTier: {
              select: { id: true, name: true, price: true },
            },
          },
        },
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Get all tickets for this event
    const tickets = await db.ticket.findMany({
      where: { eventId: id },
      select: {
        id: true,
        seatId: true,
        tableId: true,
        status: true,
        heldUntil: true,
        pricingTierId: true,
      },
    })

    // Build seat status map
    const seatStatus: Record<string, {
      status: 'available' | 'held' | 'sold'
      ticketId?: string
      heldUntil?: string
    }> = {}

    // Build table status map (for per_table mode)
    const tableStatus: Record<string, {
      status: 'available' | 'held' | 'sold'
      ticketId?: string
      heldUntil?: string
      soldSeats: number
      totalSeats: number
    }> = {}

    const now = new Date()

    for (const ticket of tickets) {
      // Check if hold has expired
      const isHoldExpired = ticket.status === 'held' &&
        ticket.heldUntil &&
        new Date(ticket.heldUntil) < now

      const effectiveStatus = isHoldExpired ? 'available' : ticket.status

      if (ticket.seatId) {
        if (effectiveStatus === 'sold' || effectiveStatus === 'checked_in') {
          seatStatus[ticket.seatId] = { status: 'sold', ticketId: ticket.id }
        } else if (effectiveStatus === 'held') {
          seatStatus[ticket.seatId] = {
            status: 'held',
            ticketId: ticket.id,
            heldUntil: ticket.heldUntil?.toISOString(),
          }
        }
      }

      if (ticket.tableId) {
        if (!tableStatus[ticket.tableId]) {
          tableStatus[ticket.tableId] = {
            status: 'available',
            soldSeats: 0,
            totalSeats: 0,
          }
        }
        if (effectiveStatus === 'sold' || effectiveStatus === 'checked_in') {
          tableStatus[ticket.tableId].soldSeats++
        }
      }
    }

    // Build availability response
    const tables = event.tableConfigurations.map(config => {
      const table = config.table

      const seats = table.seats.map(seat => {
        const status = seatStatus[seat.id] || { status: 'available' }
        return {
          id: seat.id,
          label: seat.label,
          seatNumber: seat.seatNumber,
          seatType: seat.seatType,
          relativeX: seat.relativeX,
          relativeY: seat.relativeY,
          angle: seat.angle,
          status: status.status,
          ticketId: status.ticketId,
          heldUntil: status.heldUntil,
        }
      })

      const availableSeats = seats.filter(s => s.status === 'available').length
      const heldSeats = seats.filter(s => s.status === 'held').length
      const soldSeats = seats.filter(s => s.status === 'sold').length

      return {
        tableId: table.id,
        tableName: table.name,
        capacity: table.capacity,
        sectionId: table.section?.id,
        sectionName: table.section?.name,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        shape: table.shape,
        rotation: table.rotation,
        bookingMode: config.bookingMode,
        pricingTierId: config.pricingTierId,
        pricingTier: config.pricingTier,
        minPartySize: config.minPartySize,
        maxPartySize: config.maxPartySize,
        seats,
        seatCounts: {
          total: seats.length,
          available: availableSeats,
          held: heldSeats,
          sold: soldSeats,
        },
        tableStatus: soldSeats === seats.length
          ? 'sold'
          : heldSeats > 0 || soldSeats > 0
            ? 'partial'
            : 'available',
      }
    })

    // Calculate overall stats
    const allSeats = tables.flatMap(t => t.seats)
    const ticketStats = await db.ticket.groupBy({
      by: ['status'],
      where: { eventId: id },
      _count: { id: true },
    })

    const ticketCounts = ticketStats.reduce((acc, stat) => {
      acc[stat.status] = stat._count.id
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({ data: {
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate.toISOString().split('T')[0],
        doorsOpen: event.doorsOpen,
        startTime: event.startTime,
        endTime: event.endTime,
        ticketingMode: event.ticketingMode,
        status: event.status,
      },
      pricingTiers: event.pricingTiers.map(tier => ({
        id: tier.id,
        name: tier.name,
        description: tier.description,
        color: tier.color,
        price: Number(tier.price),
        serviceFee: Number(tier.serviceFee),
        quantityAvailable: tier.quantityAvailable,
        quantitySold: tier.quantitySold,
        remaining: tier.quantityAvailable
          ? tier.quantityAvailable - tier.quantitySold
          : null,
        maxPerOrder: tier.maxPerOrder,
        sectionIds: tier.sectionIds,
      })),
      tables,
      summary: {
        totalCapacity: event.totalCapacity,
        reservedCapacity: event.reservedCapacity,
        totalSeats: allSeats.length,
        availableSeats: allSeats.filter(s => s.status === 'available').length,
        heldSeats: allSeats.filter(s => s.status === 'held').length,
        soldSeats: allSeats.filter(s => s.status === 'sold').length,
        ticketCounts: {
          available: ticketCounts['available'] || 0,
          held: ticketCounts['held'] || 0,
          sold: ticketCounts['sold'] || 0,
          checkedIn: ticketCounts['checked_in'] || 0,
          cancelled: ticketCounts['cancelled'] || 0,
          refunded: ticketCounts['refunded'] || 0,
        },
      },
    } })
  } catch (error) {
    console.error('Failed to fetch availability:', error)
    return NextResponse.json(
      { error: 'Failed to fetch availability' },
      { status: 500 }
    )
  }
})

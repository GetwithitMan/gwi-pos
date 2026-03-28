import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get table configuration for an event
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tableId: string }> }
) {
  try {
    const { id, tableId } = await params

    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        name: true,
        ticketingMode: true,
      },
    })

    if (!event) {
      return notFound('Event not found')
    }

    const table = await db.table.findFirst({
      where: {
        id: tableId,
        locationId: event.locationId,
        isActive: true,
      },
      include: {
        section: {
          select: { id: true, name: true },
        },
        seats: {
          where: { isActive: true },
          orderBy: { seatNumber: 'asc' },
          select: {
            id: true,
            label: true,
            seatNumber: true,
            seatType: true,
            relativeX: true,
            relativeY: true,
            angle: true,
          },
        },
      },
    })

    if (!table) {
      return notFound('Table not found')
    }

    // Get event-specific configuration
    const config = await db.eventTableConfig.findUnique({
      where: {
        eventId_tableId: { eventId: id, tableId },
      },
      include: {
        pricingTier: {
          select: { id: true, name: true, price: true, color: true },
        },
      },
    })

    // Get tickets for this table
    const tickets = await db.ticket.findMany({
      where: {
        eventId: id,
        tableId,
        status: { notIn: ['cancelled', 'refunded'] },
      },
      select: {
        id: true,
        seatId: true,
        status: true,
        customerName: true,
        heldUntil: true,
      },
    })

    // Build seat status
    const seatStatusMap = new Map(tickets.map(t => [t.seatId, t]))

    const seatsWithStatus = table.seats.map(seat => {
      const ticket = seatStatusMap.get(seat.id)
      const now = new Date()
      const isHoldExpired = ticket?.status === 'held' &&
        ticket.heldUntil &&
        new Date(ticket.heldUntil) < now

      return {
        ...seat,
        status: ticket
          ? isHoldExpired
            ? 'available'
            : ticket.status === 'held'
              ? 'held'
              : 'sold'
          : 'available',
        ticketId: ticket?.id,
        customerName: ticket?.customerName,
        heldUntil: ticket?.heldUntil?.toISOString(),
      }
    })

    const availableCount = seatsWithStatus.filter(s => s.status === 'available').length
    const heldCount = seatsWithStatus.filter(s => s.status === 'held').length
    const soldCount = seatsWithStatus.filter(s => s.status === 'sold').length

    return ok({
      eventId: id,
      eventName: event.name,
      ticketingMode: event.ticketingMode,
      table: {
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        sectionId: table.section?.id,
        sectionName: table.section?.name,
        posX: table.posX,
        posY: table.posY,
        width: table.width,
        height: table.height,
        shape: table.shape,
        rotation: table.rotation,
      },
      configuration: {
        isIncluded: config?.isIncluded ?? true,
        bookingMode: config?.bookingMode ?? 'inherit',
        pricingTierId: config?.pricingTierId,
        pricingTier: config?.pricingTier,
        minPartySize: config?.minPartySize,
        maxPartySize: config?.maxPartySize ?? table.capacity,
      },
      seats: seatsWithStatus,
      summary: {
        totalSeats: seatsWithStatus.length,
        available: availableCount,
        held: heldCount,
        sold: soldCount,
        status: soldCount === seatsWithStatus.length
          ? 'sold_out'
          : heldCount > 0 || soldCount > 0
            ? 'partial'
            : 'available',
      },
    })
  } catch (error) {
    console.error('Failed to fetch table configuration:', error)
    return err('Failed to fetch table configuration', 500)
  }
}))

// PUT - Update table configuration for an event
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tableId: string }> }
) {
  try {
    const { id, tableId } = await params
    const body = await request.json()
    const {
      isIncluded,
      bookingMode,
      pricingTierId,
      minPartySize,
      maxPartySize,
    } = body

    const event = await db.event.findUnique({
      where: { id },
      select: { id: true, locationId: true },
    })

    if (!event) {
      return notFound('Event not found')
    }

    // Verify table exists
    const table = await db.table.findFirst({
      where: {
        id: tableId,
        locationId: event.locationId,
        isActive: true,
      },
    })

    if (!table) {
      return notFound('Table not found')
    }

    // If excluding table, check for sold tickets
    if (isIncluded === false) {
      const soldTickets = await db.ticket.count({
        where: {
          eventId: id,
          tableId,
          status: { in: ['sold', 'checked_in'] },
        },
      })

      if (soldTickets > 0) {
        return err('Cannot exclude table with sold tickets')
      }
    }

    // Validate pricing tier if provided
    if (pricingTierId) {
      const tier = await db.eventPricingTier.findFirst({
        where: { id: pricingTierId, eventId: id, deletedAt: null },
      })
      if (!tier) {
        return err('Invalid pricing tier')
      }
    }

    // Upsert configuration
    const config = await db.eventTableConfig.upsert({
      where: {
        eventId_tableId: { eventId: id, tableId },
      },
      create: {
        locationId: event.locationId,
        eventId: id,
        tableId,
        isIncluded: isIncluded ?? true,
        bookingMode: bookingMode ?? 'inherit',
        pricingTierId,
        minPartySize,
        maxPartySize,
      },
      update: {
        ...(isIncluded !== undefined ? { isIncluded } : {}),
        ...(bookingMode !== undefined ? { bookingMode } : {}),
        ...(pricingTierId !== undefined ? { pricingTierId } : {}),
        ...(minPartySize !== undefined ? { minPartySize } : {}),
        ...(maxPartySize !== undefined ? { maxPartySize } : {}),
      },
      include: {
        pricingTier: {
          select: { id: true, name: true, price: true, color: true },
        },
        table: {
          select: { id: true, name: true, capacity: true },
        },
      },
    })

    void notifyDataChanged({ locationId: event.locationId, domain: 'events', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({
      success: true,
      configuration: {
        tableId: config.tableId,
        tableName: config.table.name,
        tableCapacity: config.table.capacity,
        isIncluded: config.isIncluded,
        bookingMode: config.bookingMode,
        pricingTierId: config.pricingTierId,
        pricingTier: config.pricingTier,
        minPartySize: config.minPartySize,
        maxPartySize: config.maxPartySize,
      },
    })
  } catch (error) {
    console.error('Failed to update table configuration:', error)
    return err('Failed to update table configuration', 500)
  }
}))

// DELETE - Remove table configuration (reset to defaults)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; tableId: string }> }
) {
  try {
    const { id, tableId } = await params

    const config = await db.eventTableConfig.findUnique({
      where: {
        eventId_tableId: { eventId: id, tableId },
      },
    })

    if (!config) {
      return notFound('Table configuration not found')
    }

    // Check for sold tickets
    const soldTickets = await db.ticket.count({
      where: {
        eventId: id,
        tableId,
        status: { in: ['sold', 'checked_in'] },
      },
    })

    if (soldTickets > 0) {
      return err('Cannot remove configuration for table with sold tickets')
    }

    // Soft delete
    await db.eventTableConfig.update({
      where: { id: config.id },
      data: { deletedAt: new Date() },
    })

    void notifyDataChanged({ locationId: config.locationId, domain: 'events', action: 'deleted', entityId: config.id })
    void pushUpstream()

    return ok({
      success: true,
      message: 'Table configuration removed (reset to defaults)',
    })
  } catch (error) {
    console.error('Failed to delete table configuration:', error)
    return err('Failed to delete table configuration', 500)
  }
}))

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get a single event with full details
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const event = await db.event.findUnique({
      where: { id },
      include: {
        pricingTiers: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        tableConfigurations: {
          include: {
            table: {
              select: { id: true, name: true, capacity: true },
            },
            pricingTier: {
              select: { id: true, name: true },
            },
          },
        },
        _count: {
          select: {
            tickets: true,
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

    // Get ticket counts by status
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
        locationId: event.locationId,
        name: event.name,
        description: event.description,
        imageUrl: event.imageUrl,
        eventType: event.eventType,
        eventDate: event.eventDate.toISOString().split('T')[0],
        doorsOpen: event.doorsOpen,
        startTime: event.startTime,
        endTime: event.endTime,
        ticketingMode: event.ticketingMode,
        allowOnlineSales: event.allowOnlineSales,
        allowPOSSales: event.allowPOSSales,
        maxTicketsPerOrder: event.maxTicketsPerOrder,
        totalCapacity: event.totalCapacity,
        reservedCapacity: event.reservedCapacity,
        salesStartAt: event.salesStartAt?.toISOString(),
        salesEndAt: event.salesEndAt?.toISOString(),
        status: event.status,
        settings: event.settings,
        reservationConflictsHandled: event.reservationConflictsHandled,
        reservationConflictNotes: event.reservationConflictNotes,
        createdAt: event.createdAt.toISOString(),
        updatedAt: event.updatedAt.toISOString(),
        createdBy: event.createdBy,
        pricingTiers: event.pricingTiers.map(tier => ({
          id: tier.id,
          name: tier.name,
          description: tier.description,
          color: tier.color,
          price: Number(tier.price),
          serviceFee: Number(tier.serviceFee),
          quantityAvailable: tier.quantityAvailable,
          quantitySold: tier.quantitySold,
          maxPerOrder: tier.maxPerOrder,
          sectionIds: tier.sectionIds,
          sortOrder: tier.sortOrder,
        })),
        tableConfigurations: event.tableConfigurations.map(config => ({
          id: config.id,
          tableId: config.tableId,
          tableName: config.table.name,
          tableCapacity: config.table.capacity,
          isIncluded: config.isIncluded,
          bookingMode: config.bookingMode,
          pricingTierId: config.pricingTierId,
          pricingTierName: config.pricingTier?.name,
          minPartySize: config.minPartySize,
          maxPartySize: config.maxPartySize,
        })),
        ticketCounts: {
          total: event._count.tickets,
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
    console.error('Failed to fetch event:', error)
    return NextResponse.json(
      { error: 'Failed to fetch event' },
      { status: 500 }
    )
  }
})

// PUT - Update an event
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Check event exists
    const existing = await db.event.findUnique({
      where: { id },
      select: { id: true, status: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Don't allow editing certain fields if event is on sale and has sold tickets
    if (existing.status === 'on_sale') {
      const soldTickets = await db.ticket.count({
        where: { eventId: id, status: 'sold' },
      })

      if (soldTickets > 0) {
        // Only allow limited updates
        const allowedFields = ['description', 'imageUrl', 'endTime', 'settings', 'reservedCapacity']
        const updateFields = Object.keys(body)
        const disallowedFields = updateFields.filter(f => !allowedFields.includes(f))

        if (disallowedFields.length > 0) {
          return NextResponse.json(
            { error: `Cannot modify ${disallowedFields.join(', ')} after tickets have been sold` },
            { status: 400 }
          )
        }
      }
    }

    const {
      name,
      description,
      imageUrl,
      eventType,
      eventDate,
      doorsOpen,
      startTime,
      endTime,
      ticketingMode,
      allowOnlineSales,
      allowPOSSales,
      maxTicketsPerOrder,
      totalCapacity,
      reservedCapacity,
      salesStartAt,
      salesEndAt,
      settings,
    } = body

    const event = await db.event.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(eventType !== undefined ? { eventType } : {}),
        ...(eventDate !== undefined ? { eventDate: new Date(eventDate) } : {}),
        ...(doorsOpen !== undefined ? { doorsOpen } : {}),
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
        ...(ticketingMode !== undefined ? { ticketingMode } : {}),
        ...(allowOnlineSales !== undefined ? { allowOnlineSales } : {}),
        ...(allowPOSSales !== undefined ? { allowPOSSales } : {}),
        ...(maxTicketsPerOrder !== undefined ? { maxTicketsPerOrder } : {}),
        ...(totalCapacity !== undefined ? { totalCapacity } : {}),
        ...(reservedCapacity !== undefined ? { reservedCapacity } : {}),
        ...(salesStartAt !== undefined ? { salesStartAt: salesStartAt ? new Date(salesStartAt) : null } : {}),
        ...(salesEndAt !== undefined ? { salesEndAt: salesEndAt ? new Date(salesEndAt) : null } : {}),
        ...(settings !== undefined ? { settings } : {}),
      },
      include: {
        pricingTiers: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({ data: {
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate.toISOString().split('T')[0],
        doorsOpen: event.doorsOpen,
        startTime: event.startTime,
        endTime: event.endTime,
        status: event.status,
        totalCapacity: event.totalCapacity,
        ticketingMode: event.ticketingMode,
        pricingTiers: event.pricingTiers.map(tier => ({
          id: tier.id,
          name: tier.name,
          price: Number(tier.price),
        })),
      },
    } })
  } catch (error) {
    console.error('Failed to update event:', error)
    return NextResponse.json(
      { error: 'Failed to update event' },
      { status: 500 }
    )
  }
})

// DELETE - Cancel/archive an event
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const hardDelete = searchParams.get('hard') === 'true'

    const event = await db.event.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: 'sold' },
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

    // Check for sold tickets
    if (event._count.tickets > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete event with sold tickets. Cancel and refund tickets first.',
          soldTickets: event._count.tickets,
        },
        { status: 400 }
      )
    }

    if (hardDelete) {
      // Soft delete pricing tiers, table configs, tickets, and event
      const now = new Date()
      await db.$transaction([
        db.eventTableConfig.updateMany({ where: { eventId: id }, data: { deletedAt: now } }),
        db.eventPricingTier.updateMany({ where: { eventId: id }, data: { deletedAt: now } }),
        db.ticket.updateMany({ where: { eventId: id }, data: { deletedAt: now } }),
        db.event.update({ where: { id }, data: { deletedAt: now } }),
      ])

      return NextResponse.json({ data: {
        success: true,
        message: 'Event permanently deleted',
      } })
    } else {
      // Soft delete - set status to cancelled
      await db.event.update({
        where: { id },
        data: {
          status: 'cancelled',
          isActive: false,
        },
      })

      return NextResponse.json({ data: {
        success: true,
        message: 'Event cancelled',
      } })
    }
  } catch (error) {
    console.error('Failed to delete event:', error)
    return NextResponse.json(
      { error: 'Failed to delete event' },
      { status: 500 }
    )
  }
})

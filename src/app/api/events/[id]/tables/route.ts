import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List table configurations for an event
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
        ticketingMode: true,
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Get all tables for the location
    const tables = await db.table.findMany({
      where: {
        locationId: event.locationId,
        isActive: true,
        deletedAt: null,
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
          },
        },
      },
      orderBy: [
        { section: { name: 'asc' } },
        { name: 'asc' },
      ],
    })

    // Get event-specific configurations
    const tableConfigs = await db.eventTableConfig.findMany({
      where: {
        eventId: id,
        deletedAt: null,
      },
      include: {
        pricingTier: {
          select: { id: true, name: true, price: true, color: true },
        },
      },
    })

    // Map configurations by table ID
    const configMap = new Map(tableConfigs.map(c => [c.tableId, c]))

    // Get ticket counts per table
    const tableTickets = await db.ticket.groupBy({
      by: ['tableId', 'status'],
      where: {
        eventId: id,
        tableId: { not: null },
      },
      _count: { id: true },
    })

    const ticketCountMap = new Map<string, Record<string, number>>()
    for (const stat of tableTickets) {
      if (!stat.tableId) continue
      if (!ticketCountMap.has(stat.tableId)) {
        ticketCountMap.set(stat.tableId, {})
      }
      ticketCountMap.get(stat.tableId)![stat.status] = stat._count.id
    }

    return NextResponse.json({
      eventId: id,
      eventName: event.name,
      ticketingMode: event.ticketingMode,
      tables: tables.map(table => {
        const config = configMap.get(table.id)
        const ticketCounts = ticketCountMap.get(table.id) || {}
        const soldCount = (ticketCounts['sold'] || 0) + (ticketCounts['checked_in'] || 0)
        const heldCount = ticketCounts['held'] || 0

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
          seats: table.seats,
          seatCount: table.seats.length,
          // Event configuration
          isIncluded: config?.isIncluded ?? true,
          bookingMode: config?.bookingMode ?? 'inherit',
          pricingTierId: config?.pricingTierId,
          pricingTier: config?.pricingTier,
          minPartySize: config?.minPartySize,
          maxPartySize: config?.maxPartySize ?? table.capacity,
          // Ticket status
          ticketsSold: soldCount,
          ticketsHeld: heldCount,
          availability: soldCount >= table.seats.length
            ? 'sold_out'
            : heldCount > 0 || soldCount > 0
              ? 'partial'
              : 'available',
          hasConfiguration: !!config,
        }
      }),
    })
  } catch (error) {
    console.error('Failed to fetch table configurations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch table configurations' },
      { status: 500 }
    )
  }
})

// POST - Bulk configure tables for an event
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { tables } = body // Array of { tableId, isIncluded, bookingMode, pricingTierId, minPartySize, maxPartySize }

    if (!tables || !Array.isArray(tables)) {
      return NextResponse.json(
        { error: 'Tables array is required' },
        { status: 400 }
      )
    }

    const event = await db.event.findUnique({
      where: { id },
      select: { id: true, locationId: true },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Upsert each table configuration
    const results = await db.$transaction(
      tables.map((tableConfig: {
        tableId: string
        isIncluded?: boolean
        bookingMode?: string
        pricingTierId?: string | null
        minPartySize?: number | null
        maxPartySize?: number | null
      }) =>
        db.eventTableConfig.upsert({
          where: {
            eventId_tableId: {
              eventId: id,
              tableId: tableConfig.tableId,
            },
          },
          create: {
            locationId: event.locationId,
            eventId: id,
            tableId: tableConfig.tableId,
            isIncluded: tableConfig.isIncluded ?? true,
            bookingMode: tableConfig.bookingMode ?? 'inherit',
            pricingTierId: tableConfig.pricingTierId,
            minPartySize: tableConfig.minPartySize,
            maxPartySize: tableConfig.maxPartySize,
          },
          update: {
            isIncluded: tableConfig.isIncluded,
            bookingMode: tableConfig.bookingMode,
            pricingTierId: tableConfig.pricingTierId,
            minPartySize: tableConfig.minPartySize,
            maxPartySize: tableConfig.maxPartySize,
          },
        })
      )
    )

    return NextResponse.json({
      success: true,
      configured: results.length,
      message: `${results.length} table configuration(s) updated`,
    })
  } catch (error) {
    console.error('Failed to configure tables:', error)
    return NextResponse.json(
      { error: 'Failed to configure tables' },
      { status: 500 }
    )
  }
})

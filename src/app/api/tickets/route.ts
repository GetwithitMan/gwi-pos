import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List/search tickets
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const eventId = searchParams.get('eventId')
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const customerId = searchParams.get('customerId')
    const search = searchParams.get('search') // Search by name, email, ticket number
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!eventId && !locationId) {
      return NextResponse.json(
        { error: 'Either eventId or locationId is required' },
        { status: 400 }
      )
    }

    const whereClause: Record<string, unknown> = {}

    if (eventId) {
      whereClause.eventId = eventId
    }

    if (locationId) {
      whereClause.locationId = locationId
    }

    if (status) {
      whereClause.status = status
    }

    if (customerId) {
      whereClause.customerId = customerId
    }

    if (search) {
      whereClause.OR = [
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { customerName: { contains: search, mode: 'insensitive' } },
        { customerEmail: { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [tickets, total] = await Promise.all([
      db.ticket.findMany({
        where: whereClause,
        include: {
          event: {
            select: {
              id: true,
              name: true,
              eventDate: true,
            },
          },
          seat: {
            select: {
              id: true,
              label: true,
              seatNumber: true,
            },
          },
          table: {
            select: {
              id: true,
              name: true,
            },
          },
          pricingTier: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
        orderBy: [
          { purchasedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: limit,
        skip: offset,
      }),
      db.ticket.count({ where: whereClause }),
    ])

    return NextResponse.json({
      tickets: tickets.map(ticket => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        status: ticket.status,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        customerPhone: ticket.customerPhone,
        basePrice: Number(ticket.basePrice),
        serviceFee: Number(ticket.serviceFee),
        totalPrice: Number(ticket.totalPrice),
        purchasedAt: ticket.purchasedAt?.toISOString(),
        purchaseChannel: ticket.purchaseChannel,
        checkedInAt: ticket.checkedInAt?.toISOString(),
        event: {
          id: ticket.event.id,
          name: ticket.event.name,
          eventDate: ticket.event.eventDate.toISOString().split('T')[0],
        },
        seat: ticket.seat
          ? {
              id: ticket.seat.id,
              label: ticket.seat.label,
              seatNumber: ticket.seat.seatNumber,
            }
          : null,
        table: ticket.table
          ? {
              id: ticket.table.id,
              name: ticket.table.name,
            }
          : null,
        pricingTier: {
          id: ticket.pricingTier.id,
          name: ticket.pricingTier.name,
          color: ticket.pricingTier.color,
        },
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + tickets.length < total,
      },
    })
  } catch (error) {
    console.error('Failed to fetch tickets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}

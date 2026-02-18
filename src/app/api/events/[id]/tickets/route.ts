import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List tickets for an event
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status') // Filter by status
    const search = searchParams.get('search') // Search by name, email, ticket number
    const tableId = searchParams.get('tableId') // Filter by table
    const tierId = searchParams.get('tierId') // Filter by pricing tier
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Verify event exists
    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        eventDate: true,
        ticketingMode: true,
        totalCapacity: true,
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Build where clause
    const whereClause: Record<string, unknown> = {
      eventId: id,
    }

    if (status) {
      whereClause.status = status
    }

    if (tableId) {
      whereClause.tableId = tableId
    }

    if (tierId) {
      whereClause.pricingTierId = tierId
    }

    if (search) {
      whereClause.OR = [
        { ticketNumber: { contains: search } },
        { barcode: { contains: search } },
        { customerName: { contains: search } },
        { customerEmail: { contains: search } },
        { customerPhone: { contains: search } },
      ]
    }

    // Fetch tickets with pagination
    const [tickets, total] = await Promise.all([
      db.ticket.findMany({
        where: whereClause,
        include: {
          seat: {
            select: { id: true, label: true, seatNumber: true },
          },
          table: {
            select: { id: true, name: true },
          },
          pricingTier: {
            select: { id: true, name: true, color: true, price: true },
          },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
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

    // Get stats by status
    const statsByStatus = await db.ticket.groupBy({
      by: ['status'],
      where: { eventId: id },
      _count: { id: true },
    })

    const statusCounts = statsByStatus.reduce((acc, stat) => {
      acc[stat.status] = stat._count.id
      return acc
    }, {} as Record<string, number>)

    // Get stats by tier
    const statsByTier = await db.ticket.groupBy({
      by: ['pricingTierId'],
      where: { eventId: id, status: { in: ['sold', 'checked_in'] } },
      _count: { id: true },
    })

    const tierCounts = statsByTier.reduce((acc, stat) => {
      acc[stat.pricingTierId] = stat._count.id
      return acc
    }, {} as Record<string, number>)

    return NextResponse.json({ data: {
      event: {
        id: event.id,
        name: event.name,
        eventDate: event.eventDate.toISOString().split('T')[0],
        ticketingMode: event.ticketingMode,
        totalCapacity: event.totalCapacity,
      },
      tickets: tickets.map(ticket => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        barcode: ticket.barcode,
        status: ticket.status,
        customerName: ticket.customerName,
        customerEmail: ticket.customerEmail,
        customerPhone: ticket.customerPhone,
        customerId: ticket.customerId,
        customer: ticket.customer
          ? {
              id: ticket.customer.id,
              name: `${ticket.customer.firstName} ${ticket.customer.lastName}`,
            }
          : null,
        seatId: ticket.seatId,
        seatLabel: ticket.seat?.label,
        seatNumber: ticket.seat?.seatNumber,
        tableId: ticket.tableId,
        tableName: ticket.table?.name,
        pricingTierId: ticket.pricingTierId,
        pricingTier: {
          id: ticket.pricingTier.id,
          name: ticket.pricingTier.name,
          color: ticket.pricingTier.color,
          price: Number(ticket.pricingTier.price),
        },
        basePrice: Number(ticket.basePrice),
        serviceFee: Number(ticket.serviceFee),
        taxAmount: Number(ticket.taxAmount),
        totalPrice: Number(ticket.totalPrice),
        purchasedAt: ticket.purchasedAt?.toISOString(),
        purchaseChannel: ticket.purchaseChannel,
        checkedInAt: ticket.checkedInAt?.toISOString(),
        checkedInBy: ticket.checkedInBy,
        heldUntil: ticket.heldUntil?.toISOString(),
        cancelledAt: ticket.cancelledAt?.toISOString(),
        cancelReason: ticket.cancelReason,
        refundedAt: ticket.refundedAt?.toISOString(),
        refundAmount: ticket.refundAmount ? Number(ticket.refundAmount) : null,
      })),
      stats: {
        total,
        byStatus: {
          available: statusCounts['available'] || 0,
          held: statusCounts['held'] || 0,
          sold: statusCounts['sold'] || 0,
          checkedIn: statusCounts['checked_in'] || 0,
          cancelled: statusCounts['cancelled'] || 0,
          refunded: statusCounts['refunded'] || 0,
        },
        byTier: tierCounts,
        checkedInPercent: (statusCounts['sold'] || 0) + (statusCounts['checked_in'] || 0) > 0
          ? Math.round((statusCounts['checked_in'] || 0) / ((statusCounts['sold'] || 0) + (statusCounts['checked_in'] || 0)) * 100)
          : 0,
      },
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + tickets.length < total,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch event tickets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch event tickets' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List pricing tiers for an event
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const event = await db.event.findUnique({
      where: { id },
      select: { id: true, locationId: true, name: true },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    const tiers = await db.eventPricingTier.findMany({
      where: {
        eventId: id,
        deletedAt: null,
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            tickets: {
              where: { status: { in: ['sold', 'checked_in'] } },
            },
          },
        },
      },
    })

    return NextResponse.json({
      eventId: id,
      eventName: event.name,
      tiers: tiers.map(tier => ({
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
        sortOrder: tier.sortOrder,
        isActive: tier.isActive,
        soldCount: tier._count.tickets,
        createdAt: tier.createdAt.toISOString(),
        updatedAt: tier.updatedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch pricing tiers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch pricing tiers' },
      { status: 500 }
    )
  }
}

// POST - Create a new pricing tier for an event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      description,
      color,
      price,
      serviceFee = 0,
      quantityAvailable,
      maxPerOrder,
      sectionIds,
      sortOrder,
    } = body

    // Validate required fields
    if (!name || price === undefined) {
      return NextResponse.json(
        { error: 'Name and price are required' },
        { status: 400 }
      )
    }

    // Validate event exists
    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        status: true,
        pricingTiers: {
          where: { deletedAt: null },
          select: { sortOrder: true },
        },
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Check if event has sold tickets - limit what can be changed
    const soldTickets = await db.ticket.count({
      where: { eventId: id, status: 'sold' },
    })

    if (soldTickets > 0 && event.status === 'on_sale') {
      // Can add new tiers but warn
      console.log(`Adding tier to event ${id} with ${soldTickets} tickets sold`)
    }

    // Get next sort order if not provided
    const nextSortOrder = sortOrder ?? (
      event.pricingTiers.length > 0
        ? Math.max(...event.pricingTiers.map(t => t.sortOrder)) + 1
        : 0
    )

    const tier = await db.eventPricingTier.create({
      data: {
        locationId: event.locationId,
        eventId: id,
        name,
        description,
        color,
        price,
        serviceFee,
        quantityAvailable,
        maxPerOrder,
        sectionIds,
        sortOrder: nextSortOrder,
        isActive: true,
      },
    })

    return NextResponse.json({
      success: true,
      tier: {
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
        isActive: tier.isActive,
      },
    })
  } catch (error) {
    console.error('Failed to create pricing tier:', error)
    return NextResponse.json(
      { error: 'Failed to create pricing tier' },
      { status: 500 }
    )
  }
}

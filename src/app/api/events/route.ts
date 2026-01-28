import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Helper to parse HH:MM time to minutes from midnight
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// Helper to check time overlap
function hasTimeOverlap(
  event: { doorsOpen: string; endTime: string | null },
  reservation: { reservationTime: string; duration: number }
): boolean {
  const eventStart = parseTimeToMinutes(event.doorsOpen)
  const eventEnd = event.endTime
    ? parseTimeToMinutes(event.endTime)
    : eventStart + 240 // Default 4 hours if no end time

  const resStart = parseTimeToMinutes(reservation.reservationTime)
  const resEnd = resStart + reservation.duration

  // Overlap exists if: event starts before reservation ends AND event ends after reservation starts
  return eventStart < resEnd && eventEnd > resStart
}

// GET - List events for a location
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const date = searchParams.get('date')
    const upcoming = searchParams.get('upcoming') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const where: Record<string, unknown> = {
      locationId,
      isActive: true,
    }

    if (status) {
      where.status = status
    }

    if (date) {
      where.eventDate = new Date(date)
    }

    if (upcoming) {
      where.eventDate = { gte: new Date() }
    }

    const events = await db.event.findMany({
      where,
      include: {
        pricingTiers: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: {
            tickets: {
              where: { status: { in: ['sold', 'held'] } },
            },
          },
        },
      },
      orderBy: [
        { eventDate: 'asc' },
        { startTime: 'asc' },
      ],
    })

    return NextResponse.json({
      events: events.map(event => ({
        id: event.id,
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
        status: event.status,
        soldCount: event._count.tickets,
        availableCount: event.totalCapacity - event._count.tickets - event.reservedCapacity,
        pricingTiers: event.pricingTiers.map(tier => ({
          id: tier.id,
          name: tier.name,
          price: Number(tier.price),
          color: tier.color,
        })),
        createdAt: event.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch events:', error)
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    )
  }
}

// POST - Create a new event
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      imageUrl,
      eventType = 'dinner_show',
      eventDate,
      doorsOpen,
      startTime,
      endTime,
      ticketingMode = 'per_seat',
      allowOnlineSales = true,
      allowPOSSales = true,
      maxTicketsPerOrder,
      totalCapacity,
      reservedCapacity = 0,
      settings = {},
      pricingTiers = [],
      createdBy,
    } = body

    // Validation
    if (!locationId || !name || !eventDate || !doorsOpen || !startTime || !totalCapacity) {
      return NextResponse.json(
        { error: 'Missing required fields: locationId, name, eventDate, doorsOpen, startTime, totalCapacity' },
        { status: 400 }
      )
    }

    // Check for conflicting reservations
    const eventDateObj = new Date(eventDate)
    const conflictingReservations = await db.reservation.findMany({
      where: {
        locationId,
        reservationDate: eventDateObj,
        status: { in: ['confirmed', 'seated'] },
      },
      include: {
        table: {
          select: { id: true, name: true },
        },
        customer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    })

    // Filter to only those that actually overlap in time
    const conflicts = conflictingReservations
      .filter(res => hasTimeOverlap(
        { doorsOpen, endTime },
        { reservationTime: res.reservationTime, duration: res.duration }
      ))
      .map(res => ({
        reservationId: res.id,
        guestName: res.guestName,
        guestPhone: res.guestPhone,
        guestEmail: res.guestEmail,
        partySize: res.partySize,
        reservationTime: res.reservationTime,
        duration: res.duration,
        tableId: res.tableId,
        tableName: res.table?.name,
        specialRequests: res.specialRequests,
        customerId: res.customerId,
        customerName: res.customer
          ? `${res.customer.firstName} ${res.customer.lastName}`
          : null,
      }))

    // Create the event (as draft if there are conflicts)
    const event = await db.event.create({
      data: {
        locationId,
        name,
        description,
        imageUrl,
        eventType,
        eventDate: eventDateObj,
        doorsOpen,
        startTime,
        endTime,
        ticketingMode,
        allowOnlineSales,
        allowPOSSales,
        maxTicketsPerOrder,
        totalCapacity,
        reservedCapacity,
        settings,
        status: conflicts.length > 0 ? 'draft' : 'draft', // Always start as draft
        reservationConflictsHandled: conflicts.length === 0,
        createdBy,
        pricingTiers: {
          create: pricingTiers.map((tier: {
            name: string
            description?: string
            color?: string
            price: number
            serviceFee?: number
            quantityAvailable?: number
            maxPerOrder?: number
            sectionIds?: string[]
            sortOrder?: number
          }, index: number) => ({
            name: tier.name,
            description: tier.description,
            color: tier.color,
            price: tier.price,
            serviceFee: tier.serviceFee || 0,
            quantityAvailable: tier.quantityAvailable,
            maxPerOrder: tier.maxPerOrder,
            sectionIds: tier.sectionIds,
            sortOrder: tier.sortOrder ?? index,
          })),
        },
      },
      include: {
        pricingTiers: true,
      },
    })

    return NextResponse.json({
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
      hasConflicts: conflicts.length > 0,
      conflicts,
      conflictCount: conflicts.length,
      message: conflicts.length > 0
        ? `Event created as draft. ${conflicts.length} reservation(s) conflict with this event and must be resolved before publishing.`
        : 'Event created successfully. Use the publish endpoint to make it available for sale.',
    })
  } catch (error) {
    console.error('Failed to create event:', error)
    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// Helper to parse HH:MM time to minutes from midnight
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// Helper to check if reservation overlaps with event time
function reservationOverlapsEvent(
  reservation: { reservationTime: string; duration: number },
  event: { doorsOpen: string; endTime: string | null }
): boolean {
  const resStart = parseTimeToMinutes(reservation.reservationTime)
  const resEnd = resStart + reservation.duration

  const eventStart = parseTimeToMinutes(event.doorsOpen)
  const eventEnd = event.endTime
    ? parseTimeToMinutes(event.endTime)
    : eventStart + 240 // Default 4 hours if no end time

  // Overlap exists if: reservation starts before event ends AND reservation ends after event starts
  return resStart < eventEnd && resEnd > eventStart
}

// GET - List reservations
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const date = searchParams.get('date')
    const status = searchParams.get('status')
    const tableId = searchParams.get('tableId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const whereClause: Record<string, unknown> = { locationId }

    // Filter by date
    if (date) {
      const searchDate = new Date(date)
      whereClause.reservationDate = searchDate
    }

    // Filter by status
    if (status) {
      whereClause.status = status
    }

    // Filter by table
    if (tableId) {
      whereClause.tableId = tableId
    }

    const reservations = await db.reservation.findMany({
      where: whereClause,
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            section: { select: { id: true, name: true } },
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
          },
        },
        bottleServiceTier: {
          select: {
            id: true,
            name: true,
            color: true,
            depositAmount: true,
            minimumSpend: true,
          },
        },
      },
      orderBy: [
        { reservationDate: 'asc' },
        { reservationTime: 'asc' },
      ],
    })

    return NextResponse.json(reservations)
  } catch (error) {
    console.error('Failed to fetch reservations:', error)
    return NextResponse.json(
      { error: 'Failed to fetch reservations' },
      { status: 500 }
    )
  }
})

// POST - Create a new reservation
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      guestName,
      guestPhone,
      guestEmail,
      partySize,
      reservationDate,
      reservationTime,
      duration,
      tableId,
      specialRequests,
      internalNotes,
      customerId,
      createdBy,
      bottleServiceTierId,
    } = body

    if (!locationId || !guestName || !partySize || !reservationDate || !reservationTime) {
      return NextResponse.json(
        { error: 'Location ID, guest name, party size, date, and time are required' },
        { status: 400 }
      )
    }

    // Check for conflicting events (events that are on sale or sold out)
    const conflictingEvent = await db.event.findFirst({
      where: {
        locationId,
        eventDate: new Date(reservationDate),
        status: { in: ['on_sale', 'sold_out'] },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        doorsOpen: true,
        endTime: true,
      },
    })

    if (conflictingEvent) {
      const reservationDuration = duration || 90
      const overlaps = reservationOverlapsEvent(
        { reservationTime, duration: reservationDuration },
        { doorsOpen: conflictingEvent.doorsOpen, endTime: conflictingEvent.endTime }
      )

      if (overlaps) {
        return NextResponse.json(
          {
            error: `Cannot create reservation: "${conflictingEvent.name}" is scheduled during this time. Please purchase tickets instead.`,
            eventId: conflictingEvent.id,
            eventName: conflictingEvent.name,
          },
          { status: 409 }
        )
      }
    }

    // If tableId provided, check for conflicts
    if (tableId) {
      const conflictingReservation = await db.reservation.findFirst({
        where: {
          tableId,
          reservationDate: new Date(reservationDate),
          status: { in: ['confirmed', 'seated'] },
          // Check for time overlap (simplified - within duration window)
        },
      })

      // More detailed time overlap check using minutes from midnight
      if (conflictingReservation) {
        const existingStart = parseTimeToMinutes(conflictingReservation.reservationTime)
        const existingEnd = existingStart + conflictingReservation.duration
        const newStart = parseTimeToMinutes(reservationTime)
        const newEnd = newStart + (duration || 90)

        // Check overlap: reservations overlap if one starts before the other ends
        if (newStart < existingEnd && newEnd > existingStart) {
          return NextResponse.json(
            { error: 'Table has a conflicting reservation at this time' },
            { status: 400 }
          )
        }
      }
    }

    const reservation = await db.reservation.create({
      data: {
        locationId,
        guestName,
        guestPhone,
        guestEmail,
        partySize,
        reservationDate: new Date(reservationDate),
        reservationTime,
        duration: duration || 90,
        tableId,
        specialRequests,
        internalNotes,
        customerId,
        createdBy,
        status: 'confirmed',
        bottleServiceTierId: bottleServiceTierId || null,
      },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        bottleServiceTier: {
          select: {
            id: true,
            name: true,
            color: true,
            depositAmount: true,
            minimumSpend: true,
          },
        },
      },
    })

    return NextResponse.json(reservation)
  } catch (error) {
    console.error('Failed to create reservation:', error)
    return NextResponse.json(
      { error: 'Failed to create reservation' },
      { status: 500 }
    )
  }
})

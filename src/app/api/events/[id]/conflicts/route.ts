import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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

  return eventStart < resEnd && eventEnd > resStart
}

// Helper to calculate overlap minutes
function calculateOverlapMinutes(
  event: { doorsOpen: string; endTime: string | null },
  reservation: { reservationTime: string; duration: number }
): number {
  const eventStart = parseTimeToMinutes(event.doorsOpen)
  const eventEnd = event.endTime
    ? parseTimeToMinutes(event.endTime)
    : eventStart + 240

  const resStart = parseTimeToMinutes(reservation.reservationTime)
  const resEnd = resStart + reservation.duration

  const overlapStart = Math.max(eventStart, resStart)
  const overlapEnd = Math.min(eventEnd, resEnd)

  return Math.max(0, overlapEnd - overlapStart)
}

// GET - Get reservation conflicts for an event
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
        endTime: true,
        reservationConflictsHandled: true,
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Find all reservations on the same date
    const reservations = await db.reservation.findMany({
      where: {
        locationId: event.locationId,
        reservationDate: event.eventDate,
        status: { in: ['confirmed', 'seated'] },
      },
      include: {
        table: {
          select: { id: true, name: true, capacity: true },
        },
        customer: {
          select: { id: true, firstName: true, lastName: true, email: true, phone: true },
        },
      },
      orderBy: { reservationTime: 'asc' },
    })

    // Filter to only those with time overlap
    const conflicts = reservations
      .filter(res => hasTimeOverlap(event, res))
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
        tableCapacity: res.table?.capacity,
        specialRequests: res.specialRequests,
        internalNotes: res.internalNotes,
        customerId: res.customerId,
        customer: res.customer
          ? {
              id: res.customer.id,
              name: `${res.customer.firstName} ${res.customer.lastName}`,
              email: res.customer.email,
              phone: res.customer.phone,
            }
          : null,
        overlapMinutes: calculateOverlapMinutes(event, res),
        createdAt: res.createdAt.toISOString(),
      }))

    return NextResponse.json({
      eventId: event.id,
      eventName: event.name,
      eventDate: event.eventDate.toISOString().split('T')[0],
      doorsOpen: event.doorsOpen,
      endTime: event.endTime,
      conflictsHandled: event.reservationConflictsHandled,
      hasConflicts: conflicts.length > 0,
      conflictCount: conflicts.length,
      totalAffectedGuests: conflicts.reduce((sum, c) => sum + c.partySize, 0),
      conflicts,
    })
  } catch (error) {
    console.error('Failed to fetch conflicts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch conflicts' },
      { status: 500 }
    )
  }
})

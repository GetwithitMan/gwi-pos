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
    : eventStart + 240

  const resStart = parseTimeToMinutes(reservation.reservationTime)
  const resEnd = resStart + reservation.duration

  return eventStart < resEnd && eventEnd > resStart
}

// POST - Resolve reservation conflicts for an event
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      action, // 'cancel_all' | 'cancel_selected' | 'ignore'
      reservationIds = [],
      cancellationReason,
      notifyGuests = false,
      notes,
    } = body

    // Validate action
    if (!['cancel_all', 'cancel_selected', 'ignore'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be cancel_all, cancel_selected, or ignore' },
        { status: 400 }
      )
    }

    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        name: true,
        eventDate: true,
        doorsOpen: true,
        endTime: true,
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    let reservationsToCancel: { id: string; guestName: string; guestPhone: string | null; guestEmail: string | null }[] = []

    if (action === 'cancel_all') {
      // Find all conflicting reservations
      const allReservations = await db.reservation.findMany({
        where: {
          locationId: event.locationId,
          reservationDate: event.eventDate,
          status: { in: ['confirmed', 'seated'] },
        },
        select: {
          id: true,
          guestName: true,
          guestPhone: true,
          guestEmail: true,
          reservationTime: true,
          duration: true,
        },
      })

      reservationsToCancel = allReservations.filter(res =>
        hasTimeOverlap(event, res)
      )
    } else if (action === 'cancel_selected') {
      if (!reservationIds || reservationIds.length === 0) {
        return NextResponse.json(
          { error: 'reservationIds required for cancel_selected action' },
          { status: 400 }
        )
      }

      // Verify the selected reservations exist and conflict
      const selectedReservations = await db.reservation.findMany({
        where: {
          id: { in: reservationIds },
          locationId: event.locationId,
          reservationDate: event.eventDate,
          status: { in: ['confirmed', 'seated'] },
        },
        select: {
          id: true,
          guestName: true,
          guestPhone: true,
          guestEmail: true,
          reservationTime: true,
          duration: true,
        },
      })

      reservationsToCancel = selectedReservations.filter(res =>
        hasTimeOverlap(event, res)
      )
    }

    const cancelReason = cancellationReason ||
      `Cancelled due to scheduled event: ${event.name} on ${event.eventDate.toISOString().split('T')[0]}`

    // Perform cancellations in a transaction
    const result = await db.$transaction(async (tx) => {
      const cancelledReservations = []

      for (const reservation of reservationsToCancel) {
        await tx.reservation.update({
          where: { id: reservation.id },
          data: {
            status: 'cancelled',
            cancelledAt: new Date(),
            cancelReason: cancelReason,
          },
        })

        cancelledReservations.push({
          id: reservation.id,
          guestName: reservation.guestName,
          guestPhone: reservation.guestPhone,
          guestEmail: reservation.guestEmail,
          notificationSent: notifyGuests, // In production, would send actual notification
        })
      }

      // Mark conflicts as handled on the event
      await tx.event.update({
        where: { id },
        data: {
          reservationConflictsHandled: true,
          reservationConflictNotes: notes || `${action}: ${cancelledReservations.length} reservation(s) cancelled`,
        },
      })

      return cancelledReservations
    })

    // In production, send notifications here if notifyGuests is true
    // This would integrate with email/SMS service

    return NextResponse.json({
      success: true,
      action,
      cancelledCount: result.length,
      cancelledReservations: result,
      eventStatus: 'Conflicts resolved. Event can now be published.',
      message: action === 'ignore'
        ? 'Conflicts marked as handled without cancelling reservations'
        : `${result.length} reservation(s) cancelled successfully`,
    })
  } catch (error) {
    console.error('Failed to resolve conflicts:', error)
    return NextResponse.json(
      { error: 'Failed to resolve conflicts' },
      { status: 500 }
    )
  }
}

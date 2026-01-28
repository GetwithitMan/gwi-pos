import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Publish an event (set status to on_sale)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const event = await db.event.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        reservationConflictsHandled: true,
        totalCapacity: true,
        pricingTiers: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      )
    }

    // Validate event can be published
    const errors: string[] = []

    if (event.status === 'on_sale') {
      return NextResponse.json(
        { error: 'Event is already on sale' },
        { status: 400 }
      )
    }

    if (event.status === 'cancelled') {
      errors.push('Cannot publish a cancelled event')
    }

    if (event.status === 'completed') {
      errors.push('Cannot publish a completed event')
    }

    if (!event.reservationConflictsHandled) {
      errors.push('Reservation conflicts must be resolved before publishing')
    }

    if (event.pricingTiers.length === 0) {
      errors.push('At least one pricing tier is required')
    }

    if (event.totalCapacity <= 0) {
      errors.push('Total capacity must be greater than 0')
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { error: 'Cannot publish event', errors },
        { status: 400 }
      )
    }

    // Update status to on_sale
    const updatedEvent = await db.event.update({
      where: { id },
      data: {
        status: 'on_sale',
        salesStartAt: new Date(), // Sales start now if not already set
      },
      select: {
        id: true,
        name: true,
        status: true,
        eventDate: true,
        totalCapacity: true,
      },
    })

    return NextResponse.json({
      success: true,
      message: 'Event is now on sale',
      event: {
        id: updatedEvent.id,
        name: updatedEvent.name,
        status: updatedEvent.status,
        eventDate: updatedEvent.eventDate.toISOString().split('T')[0],
        totalCapacity: updatedEvent.totalCapacity,
      },
    })
  } catch (error) {
    console.error('Failed to publish event:', error)
    return NextResponse.json(
      { error: 'Failed to publish event' },
      { status: 500 }
    )
  }
}

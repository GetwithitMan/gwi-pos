import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - Get a specific waitlist entry
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      include: {
        element: {
          select: {
            id: true,
            name: true,
            visualType: true,
            status: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    const waitMinutes = Math.floor((new Date().getTime() - entry.requestedAt.getTime()) / 1000 / 60)

    return NextResponse.json({
      entry: {
        id: entry.id,
        customerName: entry.customerName,
        phone: entry.phone,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: entry.position,
        waitMinutes,
        elementId: entry.elementId,
        visualType: entry.visualType,
        element: entry.element,
        table: entry.table,
        requestedAt: entry.requestedAt.toISOString(),
        notifiedAt: entry.notifiedAt?.toISOString() || null,
        seatedAt: entry.seatedAt?.toISOString() || null,
        expiresAt: entry.expiresAt?.toISOString() || null,
      },
    })
  } catch (error) {
    console.error('Failed to fetch waitlist entry:', error)
    return NextResponse.json(
      { error: 'Failed to fetch waitlist entry' },
      { status: 500 }
    )
  }
}

// PATCH - Update waitlist entry status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { locationId, status, notes, phone, partySize } = body

    // Verify locationId is provided
    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        status: true,
        position: true,
        elementId: true,
        visualType: true,
      },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    // Verify locationId matches
    if (entry.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Waitlist entry does not belong to this location' },
        { status: 403 }
      )
    }

    const validStatuses = ['waiting', 'notified', 'seated', 'cancelled', 'expired']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const updateData: {
      status?: string
      notifiedAt?: Date | null
      seatedAt?: Date | null
      notes?: string | null
      phone?: string | null
      partySize?: number
    } = {}

    // Handle status transitions
    if (status) {
      updateData.status = status

      if (status === 'notified') {
        updateData.notifiedAt = new Date()
      } else if (status === 'seated') {
        updateData.seatedAt = new Date()
      } else if (status === 'waiting') {
        // Reset notification if moved back to waiting
        updateData.notifiedAt = null
        updateData.seatedAt = null
      }
    }

    if (notes !== undefined) {
      updateData.notes = notes?.trim() || null
    }

    if (phone !== undefined) {
      updateData.phone = phone?.trim() || null
    }

    if (partySize !== undefined && partySize > 0) {
      updateData.partySize = partySize
    }

    // If moving from 'waiting' to another status, recalculate positions
    const wasWaiting = entry.status === 'waiting'
    const isLeavingWaiting = status && status !== 'waiting' && wasWaiting

    const updatedEntry = await db.$transaction(async (tx) => {
      // Update the entry
      const updated = await tx.entertainmentWaitlist.update({
        where: { id },
        data: updateData,
        include: {
          element: {
            select: {
              id: true,
              name: true,
              visualType: true,
              status: true,
            },
          },
          table: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })

      // If entry left waiting status, decrement positions of entries after it
      if (isLeavingWaiting) {
        await tx.entertainmentWaitlist.updateMany({
          where: {
            locationId,
            status: 'waiting',
            deletedAt: null,
            position: { gt: entry.position },
            ...(entry.elementId ? { elementId: entry.elementId } : { visualType: entry.visualType }),
          },
          data: {
            position: { decrement: 1 },
          },
        })
      }

      return updated
    })

    // Dispatch real-time update
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      entry: {
        id: updatedEntry.id,
        customerName: updatedEntry.customerName,
        phone: updatedEntry.phone,
        partySize: updatedEntry.partySize,
        notes: updatedEntry.notes,
        status: updatedEntry.status,
        position: updatedEntry.position,
        elementId: updatedEntry.elementId,
        visualType: updatedEntry.visualType,
        element: updatedEntry.element,
        table: updatedEntry.table,
        notifiedAt: updatedEntry.notifiedAt?.toISOString() || null,
        seatedAt: updatedEntry.seatedAt?.toISOString() || null,
      },
      message: `Updated waitlist entry status to ${status || 'modified'}`,
    })
  } catch (error) {
    console.error('Failed to update waitlist entry:', error)
    return NextResponse.json(
      { error: 'Failed to update waitlist entry' },
      { status: 500 }
    )
  }
}

// DELETE - Remove from waitlist (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    // Verify locationId is provided
    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: {
        id: true,
        locationId: true,
        customerName: true,
        deletedAt: true,
        status: true,
        position: true,
        elementId: true,
        visualType: true,
      },
    })

    if (!entry || entry.deletedAt) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    // Verify locationId matches
    if (entry.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Waitlist entry does not belong to this location' },
        { status: 403 }
      )
    }

    // Soft delete and recalculate positions in transaction
    await db.$transaction(async (tx) => {
      // Soft delete the entry
      await tx.entertainmentWaitlist.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // If entry was waiting, decrement positions of entries after it
      if (entry.status === 'waiting') {
        await tx.entertainmentWaitlist.updateMany({
          where: {
            locationId,
            status: 'waiting',
            deletedAt: null,
            position: { gt: entry.position },
            ...(entry.elementId ? { elementId: entry.elementId } : { visualType: entry.visualType }),
          },
          data: {
            position: { decrement: 1 },
          },
        })
      }
    })

    // Dispatch real-time update
    dispatchFloorPlanUpdate(locationId, { async: true })

    return NextResponse.json({
      success: true,
      message: `Removed ${entry.customerName || 'entry'} from waitlist`,
    })
  } catch (error) {
    console.error('Failed to delete waitlist entry:', error)
    return NextResponse.json(
      { error: 'Failed to delete waitlist entry' },
      { status: 500 }
    )
  }
}

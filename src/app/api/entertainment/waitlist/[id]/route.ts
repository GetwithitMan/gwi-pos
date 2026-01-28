import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
        menuItem: {
          select: {
            id: true,
            name: true,
            displayName: true,
            entertainmentStatus: true,
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

    // Calculate position
    const position = await db.entertainmentWaitlist.count({
      where: {
        menuItemId: entry.menuItemId,
        status: 'waiting',
        createdAt: { lt: entry.createdAt },
      },
    }) + 1

    const waitMinutes = Math.floor((new Date().getTime() - entry.createdAt.getTime()) / 1000 / 60)

    return NextResponse.json({
      entry: {
        id: entry.id,
        customerName: entry.customerName,
        phoneNumber: entry.phoneNumber,
        partySize: entry.partySize,
        notes: entry.notes,
        status: entry.status,
        position: entry.status === 'waiting' ? position : null,
        waitMinutes,
        menuItem: {
          id: entry.menuItem.id,
          name: entry.menuItem.displayName || entry.menuItem.name,
          status: entry.menuItem.entertainmentStatus,
        },
        notifiedAt: entry.notifiedAt?.toISOString() || null,
        seatedAt: entry.seatedAt?.toISOString() || null,
        seatedOrderId: entry.seatedOrderId,
        createdAt: entry.createdAt.toISOString(),
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
    const { status, seatedOrderId, notes, phoneNumber, partySize } = body

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    const validStatuses = ['waiting', 'notified', 'seated', 'cancelled']
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
      seatedOrderId?: string | null
      notes?: string | null
      phoneNumber?: string | null
      partySize?: number
    } = {}

    // Handle status transitions
    if (status) {
      updateData.status = status

      if (status === 'notified') {
        updateData.notifiedAt = new Date()
      } else if (status === 'seated') {
        updateData.seatedAt = new Date()
        if (seatedOrderId) {
          updateData.seatedOrderId = seatedOrderId
        }
      } else if (status === 'waiting') {
        // Reset notification if moved back to waiting
        updateData.notifiedAt = null
        updateData.seatedAt = null
        updateData.seatedOrderId = null
      }
    }

    if (notes !== undefined) {
      updateData.notes = notes?.trim() || null
    }

    if (phoneNumber !== undefined) {
      updateData.phoneNumber = phoneNumber?.trim() || null
    }

    if (partySize !== undefined && partySize > 0) {
      updateData.partySize = partySize
    }

    const updatedEntry = await db.entertainmentWaitlist.update({
      where: { id },
      data: updateData,
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    })

    return NextResponse.json({
      entry: {
        id: updatedEntry.id,
        customerName: updatedEntry.customerName,
        phoneNumber: updatedEntry.phoneNumber,
        partySize: updatedEntry.partySize,
        notes: updatedEntry.notes,
        status: updatedEntry.status,
        menuItem: {
          id: updatedEntry.menuItem.id,
          name: updatedEntry.menuItem.displayName || updatedEntry.menuItem.name,
        },
        notifiedAt: updatedEntry.notifiedAt?.toISOString() || null,
        seatedAt: updatedEntry.seatedAt?.toISOString() || null,
        seatedOrderId: updatedEntry.seatedOrderId,
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

// DELETE - Remove from waitlist
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: { id: true, customerName: true, menuItemId: true },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    await db.entertainmentWaitlist.delete({
      where: { id },
    })

    return NextResponse.json({
      success: true,
      message: `Removed ${entry.customerName} from waitlist`,
    })
  } catch (error) {
    console.error('Failed to delete waitlist entry:', error)
    return NextResponse.json(
      { error: 'Failed to delete waitlist entry' },
      { status: 500 }
    )
  }
}

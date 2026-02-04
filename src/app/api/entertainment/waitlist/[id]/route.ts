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
    const { status, notes, phone, partySize } = body

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
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

    const updatedEntry = await db.entertainmentWaitlist.update({
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

    const entry = await db.entertainmentWaitlist.findUnique({
      where: { id },
      select: { id: true, customerName: true, deletedAt: true },
    })

    if (!entry || entry.deletedAt) {
      return NextResponse.json(
        { error: 'Waitlist entry not found' },
        { status: 404 }
      )
    }

    // Soft delete
    await db.entertainmentWaitlist.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

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

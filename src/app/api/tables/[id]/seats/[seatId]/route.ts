import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { softDeleteData } from '@/lib/floorplan/queries'
import { Prisma } from '@prisma/client'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - Get a single seat
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seatId: string }> }
) {
  try {
    const { id: tableId, seatId } = await params

    const seat = await db.seat.findFirst({
      where: {
        id: seatId,
        tableId,
        isActive: true,
        deletedAt: null,
      },
    })

    if (!seat) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      seat: {
        id: seat.id,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
      },
    })
  } catch (error) {
    console.error('Failed to fetch seat:', error)
    return NextResponse.json(
      { error: 'Failed to fetch seat' },
      { status: 500 }
    )
  }
}

// PUT - Update a seat
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seatId: string }> }
) {
  try {
    const { id: tableId, seatId } = await params
    const body = await request.json()
    const {
      label,
      seatNumber,
      relativeX,
      relativeY,
      angle,
      seatType,
      updateOriginal = false, // If true, also update the "builder default" position
    } = body

    // Verify seat exists and belongs to this table
    // Also check if table is part of a combined group
    const existingSeat = await db.seat.findFirst({
      where: {
        id: seatId,
        tableId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        table: {
          select: {
            locationId: true,
            combinedWithId: true,
            combinedTableIds: true,
          },
        },
      },
    })

    if (!existingSeat) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      )
    }

    // Determine if we should update original positions
    // Update originals if:
    // 1. Explicitly requested (updateOriginal = true)
    // 2. OR if the table is NOT combined (we're in the floor plan builder)
    const isTableCombined = existingSeat.table.combinedWithId ||
      (existingSeat.table.combinedTableIds && (existingSeat.table.combinedTableIds as string[]).length > 0)

    const shouldUpdateOriginal = updateOriginal || !isTableCombined

    // Build type-safe update data
    const updateData: Prisma.SeatUpdateInput = {}

    if (label !== undefined) updateData.label = label
    if (seatNumber !== undefined) updateData.seatNumber = seatNumber
    if (relativeX !== undefined) {
      updateData.relativeX = relativeX
      if (shouldUpdateOriginal) updateData.originalRelativeX = relativeX
    }
    if (relativeY !== undefined) {
      updateData.relativeY = relativeY
      if (shouldUpdateOriginal) updateData.originalRelativeY = relativeY
    }
    if (angle !== undefined) {
      updateData.angle = angle
      if (shouldUpdateOriginal) updateData.originalAngle = angle
    }
    if (seatType !== undefined) updateData.seatType = seatType

    const seat = await db.seat.update({
      where: { id: seatId },
      data: updateData,
    })

    dispatchFloorPlanUpdate(existingSeat.table.locationId, { async: true })

    return NextResponse.json({
      seat: {
        id: seat.id,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
      },
    })
  } catch (error) {
    console.error('Failed to update seat:', error)
    return NextResponse.json(
      { error: 'Failed to update seat' },
      { status: 500 }
    )
  }
}

// DELETE - Delete (deactivate) a seat
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seatId: string }> }
) {
  try {
    const { id: tableId, seatId } = await params
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // Verify seat exists and belongs to this table (with table info for logging)
    const existingSeat = await db.seat.findFirst({
      where: {
        id: seatId,
        tableId,
        isActive: true,
      },
      include: {
        table: {
          select: { locationId: true, name: true },
        },
      },
    })

    if (!existingSeat) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      )
    }

    // Check if seat has any active tickets (sold, held, or checked in)
    const activeTickets = await db.ticket.count({
      where: {
        seatId,
        status: { in: ['sold', 'held', 'checked_in'] },
      },
    })

    if (activeTickets > 0) {
      return NextResponse.json(
        { error: 'Cannot delete seat with active tickets' },
        { status: 400 }
      )
    }

    // Use transaction to soft delete and log
    await db.$transaction(async (tx) => {
      // Soft delete
      await tx.seat.update({
        where: { id: seatId },
        data: { isActive: false, deletedAt: new Date() },
      })

      // Audit log
      await tx.auditLog.create({
        data: {
          locationId: existingSeat.table.locationId,
          employeeId: employeeId || null,
          action: 'seat_deleted',
          entityType: 'seat',
          entityId: seatId,
          details: {
            tableId,
            tableName: existingSeat.table.name,
            seatNumber: existingSeat.seatNumber,
            seatLabel: existingSeat.label,
          },
        },
      })
    })

    dispatchFloorPlanUpdate(existingSeat.table.locationId, { async: true })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete seat:', error)
    return NextResponse.json(
      { error: 'Failed to delete seat' },
      { status: 500 }
    )
  }
}

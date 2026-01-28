import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
    } = body

    // Verify seat exists and belongs to this table
    const existingSeat = await db.seat.findFirst({
      where: {
        id: seatId,
        tableId,
        isActive: true,
      },
    })

    if (!existingSeat) {
      return NextResponse.json(
        { error: 'Seat not found' },
        { status: 404 }
      )
    }

    const seat = await db.seat.update({
      where: { id: seatId },
      data: {
        ...(label !== undefined ? { label } : {}),
        ...(seatNumber !== undefined ? { seatNumber } : {}),
        ...(relativeX !== undefined ? { relativeX } : {}),
        ...(relativeY !== undefined ? { relativeY } : {}),
        ...(angle !== undefined ? { angle } : {}),
        ...(seatType !== undefined ? { seatType } : {}),
      },
    })

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

    // Verify seat exists and belongs to this table
    const existingSeat = await db.seat.findFirst({
      where: {
        id: seatId,
        tableId,
        isActive: true,
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

    // Soft delete
    await db.seat.update({
      where: { id: seatId },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete seat:', error)
    return NextResponse.json(
      { error: 'Failed to delete seat' },
      { status: 500 }
    )
  }
}

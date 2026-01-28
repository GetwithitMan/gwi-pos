import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all seats for a table
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params

    // Verify table exists
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: { id: true, locationId: true, capacity: true },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    const seats = await db.seat.findMany({
      where: {
        tableId,
        isActive: true,
      },
      orderBy: { seatNumber: 'asc' },
    })

    return NextResponse.json({
      seats: seats.map(seat => ({
        id: seat.id,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch seats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch seats' },
      { status: 500 }
    )
  }
}

// POST - Create a new seat
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const {
      label,
      seatNumber,
      relativeX,
      relativeY,
      angle,
      seatType,
    } = body

    // Verify table exists and get locationId
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: { id: true, locationId: true },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    // Get next seat number if not provided
    let finalSeatNumber = seatNumber
    if (!finalSeatNumber) {
      const maxSeat = await db.seat.findFirst({
        where: { tableId },
        orderBy: { seatNumber: 'desc' },
        select: { seatNumber: true },
      })
      finalSeatNumber = (maxSeat?.seatNumber || 0) + 1
    }

    const seat = await db.seat.create({
      data: {
        locationId: table.locationId,
        tableId,
        label: label || String(finalSeatNumber),
        seatNumber: finalSeatNumber,
        relativeX: relativeX || 0,
        relativeY: relativeY || 0,
        angle: angle || 0,
        seatType: seatType || 'standard',
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
    console.error('Failed to create seat:', error)
    return NextResponse.json(
      { error: 'Failed to create seat' },
      { status: 500 }
    )
  }
}

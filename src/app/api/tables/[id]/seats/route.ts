import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

// GET - List all seats for a table
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const searchParams = request.nextUrl.searchParams
    const includeInactive = searchParams.get('includeInactive') === 'true'

    // Verify table exists
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: { id: true, name: true, shape: true, capacity: true, locationId: true },
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
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
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
        isActive: seat.isActive,
      })),
      table: {
        id: table.id,
        name: table.name,
        shape: table.shape,
        capacity: table.capacity,
      },
    })
  } catch (error) {
    console.error('Failed to fetch seats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch seats' },
      { status: 500 }
    )
  }
}

// POST - Add a seat to table
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
      insertAt,
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

    // If insertAt is provided, renumber existing seats >= insertAt
    if (insertAt !== undefined && insertAt > 0) {
      await db.seat.updateMany({
        where: {
          tableId,
          seatNumber: { gte: insertAt },
          deletedAt: null,
        },
        data: {
          seatNumber: { increment: 1 },
        },
      })
    }

    // Determine final seat number
    let finalSeatNumber = seatNumber ?? insertAt
    if (!finalSeatNumber) {
      const maxSeat = await db.seat.findFirst({
        where: { tableId, deletedAt: null },
        orderBy: { seatNumber: 'desc' },
        select: { seatNumber: true },
      })
      finalSeatNumber = (maxSeat?.seatNumber ?? 0) + 1
    }

    // Calculate final positions
    const finalRelativeX = relativeX ?? 0
    const finalRelativeY = relativeY ?? 0
    const finalAngle = angle ?? 0

    const seat = await db.seat.create({
      data: {
        locationId: table.locationId,
        tableId,
        label: label ?? String(finalSeatNumber),
        seatNumber: finalSeatNumber,
        relativeX: finalRelativeX,
        relativeY: finalRelativeY,
        angle: finalAngle,
        seatType: seatType ?? 'standard',
      },
    })

    // Fetch all seats for UI update
    const allSeats = await db.seat.findMany({
      where: { tableId, deletedAt: null, isActive: true },
      orderBy: { seatNumber: 'asc' },
    })

    // Notify POS terminals of floor plan update
    dispatchFloorPlanUpdate(table.locationId, { async: true })

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
        isActive: seat.isActive,
      },
      seats: allSeats.map(s => ({
        id: s.id,
        label: s.label,
        seatNumber: s.seatNumber,
        relativeX: s.relativeX,
        relativeY: s.relativeY,
        angle: s.angle,
        seatType: s.seatType,
        isActive: s.isActive,
      })),
    })
  } catch (error) {
    console.error('Failed to create seat:', error)
    return NextResponse.json(
      { error: 'Failed to create seat' },
      { status: 500 }
    )
  }
}

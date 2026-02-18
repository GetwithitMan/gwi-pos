import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

interface SeatUpdate {
  id: string
  label?: string
  seatNumber?: number
  relativeX?: number
  relativeY?: number
  angle?: number
  seatType?: string
}

// PUT - Bulk update seat positions
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { seats } = body as { seats: SeatUpdate[] }

    if (!seats || !Array.isArray(seats)) {
      return NextResponse.json(
        { error: 'Seats array is required' },
        { status: 400 }
      )
    }

    // Verify table exists
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

    // Verify all seats belong to this table
    const seatIds = seats.map(s => s.id)
    const existingSeats = await db.seat.findMany({
      where: {
        id: { in: seatIds },
        tableId,
        isActive: true,
      },
      select: { id: true },
    })

    if (existingSeats.length !== seatIds.length) {
      return NextResponse.json(
        { error: 'One or more seats not found or do not belong to this table' },
        { status: 400 }
      )
    }

    // Update all seats in a transaction
    const updatedSeats = await db.$transaction(
      seats.map(seatUpdate =>
        db.seat.update({
          where: { id: seatUpdate.id },
          data: {
            ...(seatUpdate.label !== undefined ? { label: seatUpdate.label } : {}),
            ...(seatUpdate.seatNumber !== undefined ? { seatNumber: seatUpdate.seatNumber } : {}),
            ...(seatUpdate.relativeX !== undefined ? { relativeX: seatUpdate.relativeX } : {}),
            ...(seatUpdate.relativeY !== undefined ? { relativeY: seatUpdate.relativeY } : {}),
            ...(seatUpdate.angle !== undefined ? { angle: seatUpdate.angle } : {}),
            ...(seatUpdate.seatType !== undefined ? { seatType: seatUpdate.seatType } : {}),
          },
        })
      )
    )

    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return NextResponse.json({ data: {
      seats: updatedSeats.map(seat => ({
        id: seat.id,
        tableId: seat.tableId,
        label: seat.label,
        seatNumber: seat.seatNumber,
        relativeX: seat.relativeX,
        relativeY: seat.relativeY,
        angle: seat.angle,
        seatType: seat.seatType,
      })),
      updated: updatedSeats.length,
    } })
  } catch (error) {
    console.error('Failed to bulk update seats:', error)
    return NextResponse.json(
      { error: 'Failed to bulk update seats' },
      { status: 500 }
    )
  }
})

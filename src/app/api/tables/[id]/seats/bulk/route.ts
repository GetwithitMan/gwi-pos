import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { SeatType } from '@/generated/prisma/client'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

interface SeatUpdate {
  id: string
  label?: string
  seatNumber?: number
  relativeX?: number
  relativeY?: number
  angle?: number
  seatType?: SeatType
}

// PUT - Bulk update seat positions
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { seats } = body as { seats: SeatUpdate[] }

    if (!seats || !Array.isArray(seats)) {
      return err('Seats array is required')
    }

    // Verify table exists
    const table = await db.table.findUnique({
      where: { id: tableId },
      select: { id: true, locationId: true },
    })

    if (!table) {
      return notFound('Table not found')
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
      return err('One or more seats not found or do not belong to this table')
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
            lastMutatedBy: 'cloud',
          },
        })
      )
    )

    pushUpstream()

    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to bulk update seats:', error)
    return err('Failed to bulk update seats', 500)
  }
}))

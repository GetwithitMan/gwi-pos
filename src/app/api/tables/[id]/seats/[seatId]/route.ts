import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { queueIfOutageOrFail, OutageQueueFullError, pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get a single seat
export const GET = withVenue(async function GET(
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
      return notFound('Seat not found')
    }

    return ok({
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
    return err('Failed to fetch seat', 500)
  }
})

// PUT - Update a seat
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
        deletedAt: null,
      },
      include: {
        table: {
          select: {
            locationId: true,
          },
        },
      },
    })

    if (!existingSeat) {
      return notFound('Seat not found')
    }

    // Build type-safe update data
    const updateData: Prisma.SeatUpdateInput = {}

    if (label !== undefined) updateData.label = label
    if (seatNumber !== undefined) updateData.seatNumber = seatNumber
    if (relativeX !== undefined) updateData.relativeX = relativeX
    if (relativeY !== undefined) updateData.relativeY = relativeY
    if (angle !== undefined) updateData.angle = angle
    if (seatType !== undefined) updateData.seatType = seatType

    const seat = await db.seat.update({
      where: { id: seatId },
      data: { ...updateData, lastMutatedBy: 'cloud' },
    })

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('Seat', existingSeat.table.locationId, seatId, 'UPDATE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    dispatchFloorPlanUpdate(existingSeat.table.locationId, { async: true })

    return ok({
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
    return err('Failed to update seat', 500)
  }
}))

// DELETE - Delete (deactivate) a seat
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Seat not found')
    }

    // Check if seat has any active tickets (sold, held, or checked in)
    const activeTickets = await db.ticket.count({
      where: {
        seatId,
        status: { in: ['sold', 'held', 'checked_in'] },
      },
    })

    if (activeTickets > 0) {
      return err('Cannot delete seat with active tickets')
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

    // ── Outage queue protection ────────────────────────────────────────────
    try {
      await queueIfOutageOrFail('Seat', existingSeat.table.locationId, seatId, 'DELETE')
    } catch (err) {
      if (err instanceof OutageQueueFullError) {
        return err('Service temporarily unavailable — outage queue full', 507)
      }
      throw err
    }

    pushUpstream()

    dispatchFloorPlanUpdate(existingSeat.table.locationId, { async: true })

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete seat:', error)
    return err('Failed to delete seat', 500)
  }
}))

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('tables.id.seats.save-as-default')

/**
 * POST /api/tables/[id]/seats/save-as-default
 *
 * Save all current seat positions as the "builder default" positions.
 * This is used by admins to explicitly save seat arrangements from the floor plan builder.
 */
export const POST = withVenue(withAuth('ADMIN', async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { locationId, employeeId } = body

    if (!locationId) {
      return err('locationId is required')
    }

    // Verify table exists
    const table = await db.table.findFirst({
      where: { id: tableId, locationId, deletedAt: null },
      select: { id: true, name: true, locationId: true },
    })

    if (!table) {
      return notFound('Table not found')
    }

    // Get all active seats for this table
    const seats = await db.seat.findMany({
      where: {
        tableId,
        isActive: true,
        deletedAt: null,
      },
    })

    if (seats.length === 0) {
      return err('No seats found for this table')
    }

    // Save current seat positions as default
    const result = await db.$transaction(async (tx) => {
      const updatedSeats = []

      for (const seat of seats) {
        updatedSeats.push(seat)
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'seats_saved_as_default',
          entityType: 'table',
          entityId: tableId,
          details: {
            tableName: table.name,
            seatCount: updatedSeats.length,
            positions: updatedSeats.map(s => ({
              id: s.id,
              label: s.label,
              relativeX: s.relativeX,
              relativeY: s.relativeY,
              angle: s.angle,
            })),
          },
        },
      })

      return updatedSeats
    })

    pushUpstream()

    // Fire-and-forget socket dispatch for real-time floor plan updates
    void dispatchFloorPlanUpdate(locationId).catch(err => log.warn({ err }, 'floor plan dispatch failed'))

    return ok({
        tableId,
        tableName: table.name,
        savedCount: result.length,
        message: `Saved ${result.length} seat positions as default for ${table.name}`,
      })
  } catch (error) {
    console.error('[SaveSeatsAsDefault] Failed:', error)
    return err('Failed to save seat positions as default', 500)
  }
}))

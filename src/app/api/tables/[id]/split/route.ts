import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

type SeatPattern = 'all_around' | 'front_only' | 'three_sides' | 'two_sides' | 'inside'

/**
 * Generate seats distributed around all 4 sides of a rectangle (default pattern)
 */
function generateSeatsAllAround(
  tableWidth: number,
  tableHeight: number,
  count: number
): Array<{ seatNumber: number; label: string; relativeX: number; relativeY: number; angle: number }> {
  const seats: Array<{ seatNumber: number; label: string; relativeX: number; relativeY: number; angle: number }> = []
  const offset = 25
  const perimeter = 2 * (tableWidth + tableHeight)
  const spacing = perimeter / count

  let currentDist = 0 // Start from top-left corner

  for (let i = 0; i < count; i++) {
    let x = 0, y = 0, angle = 0

    if (currentDist < tableWidth) {
      x = -tableWidth / 2 + currentDist
      y = -tableHeight / 2 - offset
      angle = 180
    } else if (currentDist < tableWidth + tableHeight) {
      const sideDist = currentDist - tableWidth
      x = tableWidth / 2 + offset
      y = -tableHeight / 2 + sideDist
      angle = 270
    } else if (currentDist < 2 * tableWidth + tableHeight) {
      const sideDist = currentDist - tableWidth - tableHeight
      x = tableWidth / 2 - sideDist
      y = tableHeight / 2 + offset
      angle = 0
    } else {
      const sideDist = currentDist - 2 * tableWidth - tableHeight
      x = -tableWidth / 2 - offset
      y = tableHeight / 2 - sideDist
      angle = 90
    }

    seats.push({
      seatNumber: i + 1,
      label: String(i + 1),
      relativeX: Math.round(x),
      relativeY: Math.round(y),
      angle,
    })

    currentDist += spacing
    if (currentDist > perimeter) currentDist -= perimeter
  }

  return seats
}

/**
 * POST /api/tables/[id]/split
 *
 * Split a combined table back into its original tables:
 * - Option A: Split evenly (items distributed randomly)
 * - Option B: Split by seat (items follow original seat assignment)
 * - Restore table names
 * - Create new orders for split tables
 * - Audit log the split
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { locationId, employeeId, splitMode = 'even' } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    if (!['even', 'by_seat'].includes(splitMode)) {
      return NextResponse.json(
        { error: 'splitMode must be "even" or "by_seat"' },
        { status: 400 }
      )
    }

    // Fetch the combined table with its orders and combined table data
    const primaryTable = await db.table.findFirst({
      where: { id: tableId, locationId, deletedAt: null },
      include: {
        orders: {
          where: { status: 'open', deletedAt: null },
          include: {
            items: {
              where: { deletedAt: null },
              include: { modifiers: true },
            },
            employee: { select: { id: true, displayName: true } },
          },
        },
      },
    })

    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    const combinedTableIds = (primaryTable.combinedTableIds as string[]) || []

    if (combinedTableIds.length === 0) {
      return NextResponse.json(
        { error: 'This table is not combined with any other tables' },
        { status: 400 }
      )
    }

    // Fetch all the combined tables
    const combinedTables = await db.table.findMany({
      where: {
        id: { in: combinedTableIds },
        locationId,
        deletedAt: null,
      },
    })

    if (combinedTables.length !== combinedTableIds.length) {
      return NextResponse.json(
        { error: 'Some combined tables not found' },
        { status: 400 }
      )
    }

    // SAFETY CHECK: Cannot split tables with open orders
    // This protects active service - close the check first before splitting
    const currentOrder = primaryTable.orders[0]
    if (currentOrder) {
      return NextResponse.json(
        { error: 'Cannot split tables with open orders. Close the check first.' },
        { status: 400 }
      )
    }

    // Start transaction
    // Since we prevent split with open orders (safety check above),
    // we can directly restore tables without handling order distribution
    const result = await db.$transaction(async (tx) => {
      const restoredTables: string[] = []

      // Restore the combined tables with scattered positions
      // Use scatter offset to prevent tables stacking at 0,0
      const basePosX = primaryTable.posX || 100
      const basePosY = primaryTable.posY || 100
      const scatterOffset = 40 // px between scattered tables

      for (let i = 0; i < combinedTables.length; i++) {
        const combinedTable = combinedTables[i]
        // Use original position if saved, otherwise scatter from primary's position
        const restoredPosX = combinedTable.originalPosX ?? (basePosX + (i + 1) * scatterOffset)
        const restoredPosY = combinedTable.originalPosY ?? (basePosY + (i + 1) * scatterOffset)

        await tx.table.update({
          where: { id: combinedTable.id },
          data: {
            status: 'available',
            combinedWithId: null,
            name: combinedTable.originalName || combinedTable.name.split('+').pop() || combinedTable.name,
            // Restore to admin-defined position or scatter if not available
            posX: restoredPosX > 0 ? restoredPosX : basePosX + (i + 1) * scatterOffset,
            posY: restoredPosY > 0 ? restoredPosY : basePosY + (i + 1) * scatterOffset,
          },
        })

        restoredTables.push(combinedTable.id)
      }

      // Restore primary table with original position
      const originalCapacity = Math.floor(
        primaryTable.capacity / (combinedTables.length + 1)
      )

      // Use original position if saved, otherwise keep current (which is already basePosX/Y)
      const primaryRestoredPosX = primaryTable.originalPosX ?? basePosX
      const primaryRestoredPosY = primaryTable.originalPosY ?? basePosY

      const updatedPrimary = await tx.table.update({
        where: { id: primaryTable.id },
        data: {
          combinedTableIds: Prisma.JsonNull,
          name: primaryTable.originalName || primaryTable.name.split('+')[0],
          originalName: null,
          capacity: originalCapacity > 0 ? originalCapacity : primaryTable.capacity,
          status: 'available', // Always available since we require closing orders before split
          // Restore to admin-defined position or keep current if not available
          posX: primaryRestoredPosX > 0 ? primaryRestoredPosX : 100,
          posY: primaryRestoredPosY > 0 ? primaryRestoredPosY : 100,
        },
      })

      // Restore seats to their original positions from floor plan builder
      const allSplitTableIds = [primaryTable.id, ...combinedTableIds]

      // Fetch all seats from all split tables
      const allSeats = await tx.seat.findMany({
        where: {
          tableId: { in: allSplitTableIds },
          isActive: true,
          deletedAt: null,
        },
        orderBy: [
          { tableId: 'asc' },
          { seatNumber: 'asc' },
        ],
      })

      // Group seats by table for proper sequential numbering
      const seatsByTable = new Map<string, typeof allSeats>()
      for (const seat of allSeats) {
        const tableSeats = seatsByTable.get(seat.tableId) || []
        tableSeats.push(seat)
        seatsByTable.set(seat.tableId, tableSeats)
      }

      // Restore each seat to its original position
      for (const [tableId, tableSeats] of seatsByTable) {
        // Check if seats have original positions saved
        const hasOriginalPositions = tableSeats.some(
          s => s.originalRelativeX !== null || s.originalRelativeY !== null
        )

        if (hasOriginalPositions) {
          // Restore from saved original positions
          for (const seat of tableSeats) {
            await tx.seat.update({
              where: { id: seat.id },
              data: {
                // Restore original position (fall back to current if not saved)
                relativeX: seat.originalRelativeX ?? seat.relativeX,
                relativeY: seat.originalRelativeY ?? seat.relativeY,
                angle: seat.originalAngle ?? seat.angle,
                // Clear original fields after restore
                originalRelativeX: null,
                originalRelativeY: null,
                originalAngle: null,
                // Restore label to match seatNumber (don't change seatNumber - it's the identity)
                label: String(seat.seatNumber),
              },
            })
          }
        } else {
          // No original positions saved - regenerate default positions
          const tableForSeats = tableId === primaryTable.id
            ? primaryTable
            : combinedTables.find(t => t.id === tableId)

          if (tableForSeats) {
            // Soft delete existing seats
            await tx.seat.updateMany({
              where: { tableId, isActive: true, deletedAt: null },
              data: { isActive: false, deletedAt: new Date() },
            })

            // Generate default positions
            const tableCapacity = tableId === primaryTable.id
              ? (originalCapacity > 0 ? originalCapacity : 4)
              : (tableForSeats.capacity || 4)

            const seatPositions = generateSeatsAllAround(
              tableForSeats.width,
              tableForSeats.height,
              tableCapacity
            )

            // Create new seats
            for (const pos of seatPositions) {
              await tx.seat.create({
                data: {
                  locationId,
                  tableId,
                  label: pos.label,
                  seatNumber: pos.seatNumber,
                  relativeX: pos.relativeX,
                  relativeY: pos.relativeY,
                  angle: pos.angle,
                  seatType: 'standard',
                },
              })
            }
          }
        }
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'tables_split',
          entityType: 'table',
          entityId: primaryTable.id,
          details: {
            primaryTableId: primaryTable.id,
            restoredTableIds: restoredTables,
            splitMode,
            hadActiveOrder: false, // We return early if there's an active order
          },
        },
      })

      return {
        primaryTable: updatedPrimary,
        restoredTables,
      }
    })

    // Emit real-time event
    tableEvents.tablesSplit({
      primaryTableId: tableId,
      restoredTableIds: result.restoredTables,
      locationId,
      splitMode,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        primaryTableId: result.primaryTable.id,
        primaryTableName: result.primaryTable.name,
        restoredTableIds: result.restoredTables,
        message: `Tables split successfully using ${splitMode} mode`,
      },
    })
  } catch (error) {
    console.error('[TablesSplit] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to split tables' },
      { status: 500 }
    )
  }
}

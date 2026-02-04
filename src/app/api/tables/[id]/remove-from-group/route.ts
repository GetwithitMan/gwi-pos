import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'

/**
 * POST /api/tables/[id]/remove-from-group
 *
 * Remove a single table from a combined group (undo last combine).
 * This is different from split which breaks apart ALL tables.
 *
 * - Removes the specified table from its combined group
 * - Restores the table's original position and name
 * - Restores the table's seats to original positions
 * - Updates the primary table's combinedTableIds
 * - Recalculates seat labels for remaining combined tables
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableIdToRemove } = await params
    const body = await request.json()
    const { locationId, employeeId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    // Fetch the table to remove
    const tableToRemove = await db.table.findFirst({
      where: { id: tableIdToRemove, locationId, deletedAt: null },
      include: {
        seats: {
          where: { isActive: true, deletedAt: null },
        },
      },
    })

    if (!tableToRemove) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    // Check if this table is part of a combined group
    const primaryTableId = tableToRemove.combinedWithId

    if (!primaryTableId) {
      // This table might BE the primary - check if it has combined tables
      const combinedIds = (tableToRemove.combinedTableIds as string[]) || []
      if (combinedIds.length === 0) {
        return NextResponse.json(
          { error: 'This table is not part of a combined group' },
          { status: 400 }
        )
      }

      // This is the primary table - remove the LAST combined table instead
      const lastCombinedId = combinedIds[combinedIds.length - 1]

      // Recursively call this endpoint for the last combined table
      const recursiveRes = await fetch(
        `${request.nextUrl.origin}/api/tables/${lastCombinedId}/remove-from-group`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locationId, employeeId }),
        }
      )

      const recursiveData = await recursiveRes.json()
      return NextResponse.json(recursiveData, { status: recursiveRes.status })
    }

    // Fetch the primary table
    const primaryTable = await db.table.findFirst({
      where: { id: primaryTableId, locationId, deletedAt: null },
      include: {
        seats: {
          where: { isActive: true, deletedAt: null },
        },
      },
    })

    if (!primaryTable) {
      return NextResponse.json(
        { error: 'Primary table not found' },
        { status: 404 }
      )
    }

    const combinedTableIds = (primaryTable.combinedTableIds as string[]) || []

    if (!combinedTableIds.includes(tableIdToRemove)) {
      return NextResponse.json(
        { error: 'Table is not in the combined group' },
        { status: 400 }
      )
    }

    // Start transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Remove the table from the combined group
      const newCombinedIds = combinedTableIds.filter(id => id !== tableIdToRemove)

      // 2. Update the removed table - restore to original state
      await tx.table.update({
        where: { id: tableIdToRemove },
        data: {
          combinedWithId: null,
          name: tableToRemove.originalName || tableToRemove.name,
          originalName: null,
          status: 'available',
          // Restore original position
          posX: tableToRemove.originalPosX ?? tableToRemove.posX,
          posY: tableToRemove.originalPosY ?? tableToRemove.posY,
          originalPosX: null,
          originalPosY: null,
        },
      })

      // 3. Restore removed table's seats to original positions
      for (const seat of tableToRemove.seats) {
        await tx.seat.update({
          where: { id: seat.id },
          data: {
            relativeX: seat.originalRelativeX ?? seat.relativeX,
            relativeY: seat.originalRelativeY ?? seat.relativeY,
            angle: seat.originalAngle ?? seat.angle,
            originalRelativeX: null,
            originalRelativeY: null,
            originalAngle: null,
            label: String(seat.seatNumber),
          },
        })
      }

      // 4. Update primary table
      let newPrimaryName = primaryTable.originalName || primaryTable.name.split('+')[0]
      let newCapacity = primaryTable.capacity - (tableToRemove.capacity || 0)

      if (newCombinedIds.length > 0) {
        // Still has combined tables - update the combined name
        const remainingTables = await tx.table.findMany({
          where: { id: { in: newCombinedIds } },
          select: { name: true, originalName: true },
        })

        const allNames = [
          newPrimaryName,
          ...remainingTables.map(t => t.originalName || t.name)
        ]
        newPrimaryName = allNames.join('+')
      } else {
        // No more combined tables - fully restore primary
        newCapacity = Math.round(primaryTable.capacity / 2) // Approximate original
      }

      const updatedPrimary = await tx.table.update({
        where: { id: primaryTableId },
        data: {
          combinedTableIds: newCombinedIds.length > 0 ? newCombinedIds : Prisma.JsonNull,
          name: newPrimaryName,
          originalName: newCombinedIds.length > 0 ? primaryTable.originalName : null,
          capacity: Math.max(newCapacity, 1),
        },
      })

      // 5. If there are still combined tables, recalculate seat positions
      if (newCombinedIds.length > 0) {
        // Get all remaining tables in the group
        const remainingTables = await tx.table.findMany({
          where: {
            id: { in: [primaryTableId, ...newCombinedIds] },
            isActive: true,
          },
        })

        // Get all seats from remaining tables
        const remainingSeats = await tx.seat.findMany({
          where: {
            tableId: { in: [primaryTableId, ...newCombinedIds] },
            isActive: true,
            deletedAt: null,
          },
        })

        // Calculate combined bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        const tablePositions = new Map<string, { posX: number; posY: number; width: number; height: number }>()

        for (const t of remainingTables) {
          tablePositions.set(t.id, {
            posX: t.posX,
            posY: t.posY,
            width: t.width,
            height: t.height,
          })
          minX = Math.min(minX, t.posX)
          minY = Math.min(minY, t.posY)
          maxX = Math.max(maxX, t.posX + t.width)
          maxY = Math.max(maxY, t.posY + t.height)
        }

        const combinedCenterX = (minX + maxX) / 2
        const combinedCenterY = (minY + maxY) / 2

        // Sort remaining seats by clockwise position
        const seatsWithAngles = remainingSeats.map(seat => {
          const tablePos = tablePositions.get(seat.tableId)
          if (!tablePos) return null

          const tableCenterX = tablePos.posX + tablePos.width / 2
          const tableCenterY = tablePos.posY + tablePos.height / 2
          const absoluteX = tableCenterX + seat.relativeX
          const absoluteY = tableCenterY + seat.relativeY

          const dx = absoluteX - combinedCenterX
          const dy = absoluteY - combinedCenterY
          let angle = Math.atan2(dy, dx) * 180 / Math.PI
          angle = (angle + 135 + 360) % 360

          return { seat, clockwiseAngle: angle }
        }).filter(Boolean) as Array<{ seat: typeof remainingSeats[0]; clockwiseAngle: number }>

        seatsWithAngles.sort((a, b) => a.clockwiseAngle - b.clockwiseAngle)

        // Update labels based on new clockwise order
        for (let i = 0; i < seatsWithAngles.length; i++) {
          await tx.seat.update({
            where: { id: seatsWithAngles[i].seat.id },
            data: { label: String(i + 1) },
          })
        }
      } else {
        // No more combined tables - restore primary's seats
        for (const seat of primaryTable.seats) {
          await tx.seat.update({
            where: { id: seat.id },
            data: {
              relativeX: seat.originalRelativeX ?? seat.relativeX,
              relativeY: seat.originalRelativeY ?? seat.relativeY,
              angle: seat.originalAngle ?? seat.angle,
              originalRelativeX: null,
              originalRelativeY: null,
              originalAngle: null,
              label: String(seat.seatNumber),
            },
          })
        }
      }

      // 6. Create audit log
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'table_removed_from_group',
          entityType: 'table',
          entityId: tableIdToRemove,
          details: {
            removedTableId: tableIdToRemove,
            removedTableName: tableToRemove.originalName || tableToRemove.name,
            primaryTableId,
            remainingCombinedIds: newCombinedIds,
          },
        },
      })

      return {
        removedTable: tableToRemove,
        primaryTable: updatedPrimary,
        remainingCombinedIds: newCombinedIds,
      }
    })

    // Emit real-time event
    tableEvents.tablesSplit({
      primaryTableId,
      restoredTableIds: [tableIdToRemove],
      locationId,
      splitMode: 'even', // Using 'even' for API compatibility - actual mode is remove_one
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    return NextResponse.json({
      data: {
        removedTableId: tableIdToRemove,
        removedTableName: result.removedTable.originalName || result.removedTable.name,
        primaryTableId,
        remainingCombinedIds: result.remainingCombinedIds,
        message: `Removed ${result.removedTable.originalName || result.removedTable.name} from group`,
      },
    })
  } catch (error) {
    console.error('[RemoveFromGroup] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to remove table from group' },
      { status: 500 }
    )
  }
}

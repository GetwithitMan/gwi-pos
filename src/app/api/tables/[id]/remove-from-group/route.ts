import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'

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

      // 3. Restore seat labels for the removed table
      const removedTableSeats = await tx.seat.findMany({
        where: { tableId: tableIdToRemove, deletedAt: null }
      })

      for (const seat of removedTableSeats) {
        await tx.seat.update({
          where: { id: seat.id },
          data: { label: String(seat.seatNumber) }
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

      // 5. If group was fully dissolved, restore primary table's seat labels
      if (newCombinedIds.length === 0) {
        const primaryTableSeats = await tx.seat.findMany({
          where: { tableId: primaryTableId, deletedAt: null }
        })

        for (const seat of primaryTableSeats) {
          await tx.seat.update({
            where: { id: seat.id },
            data: { label: String(seat.seatNumber) }
          })
        }
      }

      // 6. Seat label recalculation will be done via API after transaction

      // 7. Create audit log
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

    // Fire-and-forget API calls for seat operations (after transaction completes)
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

    // 1. Restore the removed table's seats to original positions
    fetch(`${baseUrl}/api/seats/bulk-operations?action=restore-original`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        tableIds: [tableIdToRemove]
      })
    }).catch(err => console.error('[RemoveFromGroup] Seat restore failed:', err))

    // 2. If tables remain in group, recalculate their seat labels
    if (result.remainingCombinedIds.length > 0) {
      // Fetch all remaining tables to get positions
      const allTables = await db.table.findMany({
        where: {
          id: { in: [primaryTableId, ...result.remainingCombinedIds] },
          isActive: true,
        },
        select: { id: true, posX: true, posY: true, width: true, height: true },
      })

      const remainingTablePositions = allTables.map(t => ({
        id: t.id,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height
      }))

      fetch(`${baseUrl}/api/seats/bulk-operations?action=recalculate-labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          tableIds: [primaryTableId, ...result.remainingCombinedIds],
          tablePositions: remainingTablePositions
        })
      }).catch(err => console.error('[RemoveFromGroup] Seat recalculate failed:', err))
    } else {
      // 3. If this was the last child, restore primary's seats too
      fetch(`${baseUrl}/api/seats/bulk-operations?action=restore-original`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          tableIds: [primaryTableId]
        })
      }).catch(err => console.error('[RemoveFromGroup] Primary seat restore failed:', err))
    }

    // Emit real-time event
    tableEvents.tablesSplit({
      primaryTableId,
      restoredTableIds: [tableIdToRemove],
      locationId,
      splitMode: 'even', // Using 'even' for API compatibility - actual mode is remove_one
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    dispatchFloorPlanUpdate(locationId, { async: true })

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

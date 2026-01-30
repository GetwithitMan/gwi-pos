import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'
import {
  calculateAttachSide,
  calculateAttachPosition,
  shiftCollidingTables,
  type TableRect,
  type AttachSide,
} from '@/components/floor-plan/table-positioning'

/**
 * POST /api/tables/combine
 *
 * Combine two tables into one:
 * - Merge orders from source table to target table
 * - Update guest counts
 * - Mark source table as available (absorbed)
 * - Update combined table name to show both (e.g., "T1+T2")
 * - Smart magnetic positioning based on drop location
 * - Collision detection with auto-shift of overlapping tables
 * - Audit log the combination
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sourceTableId,
      targetTableId,
      locationId,
      employeeId,
      dropX,        // Drop position for calculating attach side
      dropY,
      attachSide,   // Optional: explicitly specify side
      allTables,    // All tables for collision detection
    } = body

    if (!sourceTableId || !targetTableId || !locationId) {
      return NextResponse.json(
        { error: 'sourceTableId, targetTableId, and locationId are required' },
        { status: 400 }
      )
    }

    if (sourceTableId === targetTableId) {
      return NextResponse.json(
        { error: 'Cannot combine a table with itself' },
        { status: 400 }
      )
    }

    // Fetch both tables with their current orders
    const [sourceTable, targetTable] = await Promise.all([
      db.table.findFirst({
        where: { id: sourceTableId, locationId, deletedAt: null },
        include: {
          orders: {
            where: { status: 'open', deletedAt: null },
            include: { items: true },
          },
        },
      }),
      db.table.findFirst({
        where: { id: targetTableId, locationId, deletedAt: null },
        include: {
          orders: {
            where: { status: 'open', deletedAt: null },
            include: { items: true },
          },
        },
      }),
    ])

    if (!sourceTable) {
      return NextResponse.json(
        { error: 'Source table not found' },
        { status: 404 }
      )
    }

    if (!targetTable) {
      return NextResponse.json(
        { error: 'Target table not found' },
        { status: 404 }
      )
    }

    // Check if source table is already combined into another table
    if (sourceTable.combinedWithId) {
      return NextResponse.json(
        { error: 'Source table is already combined with another table' },
        { status: 400 }
      )
    }

    // Build the combined name
    const existingCombinedIds: string[] = (targetTable.combinedTableIds as string[]) || []
    const newCombinedIds = [...existingCombinedIds, sourceTableId]

    // Get all table names for the combined display name
    const allTableNames = [targetTable.originalName || targetTable.name, sourceTable.name]
    if (existingCombinedIds.length > 0) {
      // Already combined, just add the new name
      const combinedName = `${targetTable.name}+${sourceTable.name}`
      allTableNames.length = 0 // Reset
      allTableNames.push(combinedName)
    }
    const combinedName = allTableNames.join('+')

    // Calculate magnetic positioning BEFORE transaction (for use in response)
    // For 3+ table stacking, we need to calculate the COMBINED bounding box
    // so the new table attaches to the edge of the entire combined group

    // Start with target table rect
    let combinedBoundingBox: TableRect = {
      id: targetTable.id,
      posX: targetTable.posX,
      posY: targetTable.posY,
      width: targetTable.width,
      height: targetTable.height,
    }

    // If target already has combined tables, expand the bounding box to include them
    if (existingCombinedIds.length > 0 && allTables && Array.isArray(allTables)) {
      const combinedTableRects = allTables.filter((t: { id: string }) =>
        existingCombinedIds.includes(t.id) || t.id === targetTableId
      )

      if (combinedTableRects.length > 0) {
        let minX = targetTable.posX
        let minY = targetTable.posY
        let maxX = targetTable.posX + targetTable.width
        let maxY = targetTable.posY + targetTable.height

        for (const t of combinedTableRects) {
          minX = Math.min(minX, t.posX)
          minY = Math.min(minY, t.posY)
          maxX = Math.max(maxX, t.posX + t.width)
          maxY = Math.max(maxY, t.posY + t.height)
        }

        combinedBoundingBox = {
          id: targetTable.id,
          posX: minX,
          posY: minY,
          width: maxX - minX,
          height: maxY - minY,
        }
      }
    }

    const sourceRect: TableRect = {
      id: sourceTable.id,
      posX: sourceTable.posX,
      posY: sourceTable.posY,
      width: sourceTable.width,
      height: sourceTable.height,
    }

    // Calculate attach side from drop position or use provided side
    // Use the combined bounding box for side calculation
    let side: AttachSide = attachSide || 'right'
    if (!attachSide && dropX !== undefined && dropY !== undefined) {
      side = calculateAttachSide(dropX, dropY, combinedBoundingBox)
    }

    // Calculate the ideal magnetic position using the combined bounding box
    const magneticPos = calculateAttachPosition(sourceRect, combinedBoundingBox, side)

    // Prepare for collision detection
    const shiftedPositions = new Map<string, { posX: number; posY: number }>()

    // Start transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Move any open orders from source to target
      const sourceOrder = sourceTable.orders[0]
      const targetOrder = targetTable.orders[0]

      if (sourceOrder) {
        if (targetOrder) {
          // Both tables have orders - move items from source to target
          await tx.orderItem.updateMany({
            where: {
              orderId: sourceOrder.id,
              locationId,
              deletedAt: null,
            },
            data: {
              orderId: targetOrder.id,
            },
          })

          // Update target order guest count and totals
          const newGuestCount = targetOrder.guestCount + sourceOrder.guestCount
          const combinedSubtotal = Number(targetOrder.subtotal) + Number(sourceOrder.subtotal)
          const combinedTax = Number(targetOrder.taxTotal) + Number(sourceOrder.taxTotal)
          const combinedTotal = Number(targetOrder.total) + Number(sourceOrder.total)

          await tx.order.update({
            where: { id: targetOrder.id },
            data: {
              guestCount: newGuestCount,
              subtotal: combinedSubtotal,
              taxTotal: combinedTax,
              total: combinedTotal,
              notes: targetOrder.notes
                ? `${targetOrder.notes}\n[Combined from ${sourceTable.name}]`
                : `[Combined from ${sourceTable.name}]`,
            },
          })

          // Close the source order (mark as merged)
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: {
              status: 'merged',
              notes: `Merged into order #${targetOrder.orderNumber} on table ${targetTable.name}`,
            },
          })
        } else {
          // Only source has an order - reassign to target table
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: {
              tableId: targetTableId,
            },
          })
        }
      }

      // 2. Check for collisions and shift other tables if needed
      if (allTables && Array.isArray(allTables)) {
        const tableRects: TableRect[] = allTables.map((t: { id: string; posX: number; posY: number; width: number; height: number }) => ({
          id: t.id,
          posX: t.id === sourceTableId ? magneticPos.posX : t.posX,
          posY: t.id === sourceTableId ? magneticPos.posY : t.posY,
          width: t.width,
          height: t.height,
        }))

        const newSourceRect: TableRect = {
          ...sourceRect,
          posX: magneticPos.posX,
          posY: magneticPos.posY,
        }

        // Find and shift any colliding tables
        const shifts = shiftCollidingTables(
          newSourceRect,
          tableRects,
          [sourceTableId, targetTableId], // Don't shift source or target
          5 // Max iterations for chain shifting
        )

        // Apply shifts to database
        for (const [tableId, pos] of shifts) {
          await tx.table.update({
            where: { id: tableId },
            data: { posX: pos.posX, posY: pos.posY },
          })
          shiftedPositions.set(tableId, pos)
        }
      }

      // 3. Update source table - mark as combined and position side-by-side
      await tx.table.update({
        where: { id: sourceTableId },
        data: {
          combinedWithId: targetTableId,
          // Store original position before moving
          originalPosX: sourceTable.originalPosX ?? sourceTable.posX,
          originalPosY: sourceTable.originalPosY ?? sourceTable.posY,
          // Move to calculated magnetic position
          posX: magneticPos.posX,
          posY: magneticPos.posY,
          status: sourceOrder ? 'occupied' : targetTable.status, // Match parent status
          originalName: sourceTable.name, // Store original name for restoration
        },
      })

      // 4. Update target table - add source to combined list
      const updatedTarget = await tx.table.update({
        where: { id: targetTableId },
        data: {
          combinedTableIds: newCombinedIds,
          name: combinedName,
          originalName: targetTable.originalName || targetTable.name, // Store original name if not already set
          capacity: targetTable.capacity + sourceTable.capacity, // Combine capacity
          status: sourceOrder || targetOrder ? 'occupied' : targetTable.status,
        },
        include: {
          section: { select: { id: true, name: true, color: true } },
          orders: {
            where: { status: 'open', deletedAt: null },
            select: {
              id: true,
              orderNumber: true,
              guestCount: true,
              total: true,
              createdAt: true,
            },
          },
        },
      })

      // 5. Create audit log entry
      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId || null,
          action: 'tables_combined',
          entityType: 'table',
          entityId: targetTableId,
          details: {
            sourceTableId,
            sourceTableName: sourceTable.name,
            targetTableId,
            targetTableName: targetTable.name,
            combinedName,
            attachSide: side,
            sourceOrderId: sourceOrder?.id || null,
            targetOrderId: targetOrder?.id || null,
          },
        },
      })

      return updatedTarget
    })

    // Emit real-time event
    tableEvents.tablesCombined({
      sourceTableId,
      targetTableId,
      locationId,
      combinedName,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    // Convert shiftedPositions Map to object for JSON response
    const shiftedTablesObj: Record<string, { posX: number; posY: number }> = {}
    for (const [tableId, pos] of shiftedPositions) {
      shiftedTablesObj[tableId] = pos
    }

    return NextResponse.json({
      data: {
        table: {
          id: result.id,
          name: result.name,
          capacity: result.capacity,
          status: result.status,
          combinedTableIds: result.combinedTableIds,
          originalName: result.originalName,
          section: result.section,
          currentOrder: result.orders[0]
            ? {
                id: result.orders[0].id,
                orderNumber: result.orders[0].orderNumber,
                guestCount: result.orders[0].guestCount,
                total: Number(result.orders[0].total),
                openedAt: result.orders[0].createdAt.toISOString(),
              }
            : null,
        },
        sourceTable: {
          id: sourceTable.id,
          posX: magneticPos.posX,
          posY: magneticPos.posY,
        },
        attachSide: side,
        shiftedTables: shiftedTablesObj,
        message: `Tables combined: ${combinedName}`,
      },
    })
  } catch (error) {
    console.error('[TablesCombine] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to combine tables' },
      { status: 500 }
    )
  }
}

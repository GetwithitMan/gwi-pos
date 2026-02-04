// src/app/api/tables/combine/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tableEvents } from '@/lib/realtime/table-events'
import {
  getCombinedGroupTables,
  getGroupBoundingBox,
  distributeSeatsOnPerimeter,
  type TableRect,
} from '@/lib/table-geometry'
import {
  calculateAttachSide,
  calculateAttachPosition,
  shiftCollidingTables,
  type TableRect as PositioningTableRect,
  type AttachSide,
} from '@/components/floor-plan/table-positioning'

interface CombineRequestBody {
  sourceTableId: string
  targetTableId: string
  locationId: string
  employeeId?: string
  dropX?: number
  dropY?: number
  attachSide?: AttachSide
  allTables?: Array<{
    id: string
    posX: number
    posY: number
    width: number
    height: number
  }>
}

/**
 * POST /api/tables/combine
 *
 * Physical combine:
 * - Resolve primary target
 * - Merge/move orders
 * - Attach source to group with magnetic positioning
 * - Shift colliding tables (pockets allowed)
 * - Rebuild seats around true perimeter; label 1..N clockwise
 */
export async function POST(request: NextRequest) {
  let body: CombineRequestBody
  try {
    body = (await request.json()) as CombineRequestBody
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid JSON in request body', details: String(err) },
      { status: 400 }
    )
  }

  const {
    sourceTableId,
    targetTableId,
    locationId,
    employeeId,
    dropX,
    dropY,
    attachSide,
    allTables,
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

  try {
    // 1) Load source + target with open orders
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
      return NextResponse.json({ error: 'Source table not found' }, { status: 404 })
    }
    if (!targetTable) {
      return NextResponse.json({ error: 'Target table not found' }, { status: 404 })
    }

    // 2) If source is child in another group, detach first
    if (sourceTable.combinedWithId) {
      const currentPrimaryId = sourceTable.combinedWithId
      const currentPrimary = await db.table.findFirst({
        where: { id: currentPrimaryId, locationId, deletedAt: null },
      })

      if (currentPrimary) {
        const currentIds = (currentPrimary.combinedTableIds as string[]) || []
        const newIds = currentIds.filter(id => id !== sourceTableId)

        await db.table.update({
          where: { id: currentPrimaryId },
          data: {
            combinedTableIds: newIds.length ? newIds : [],
            name:
              newIds.length > 0
                ? currentPrimary.name
                : currentPrimary.originalName || currentPrimary.name,
          },
        })

        await db.table.update({
          where: { id: sourceTableId },
          data: { combinedWithId: null },
        })
      }
    }

    // 3) Resolve primary target if target is child
    let actualTargetTable = targetTable
    let actualTargetId = targetTableId

    if (targetTable.combinedWithId) {
      const primaryTable = await db.table.findFirst({
        where: { id: targetTable.combinedWithId, locationId, deletedAt: null },
        include: {
          orders: {
            where: { status: 'open', deletedAt: null },
            include: { items: true },
          },
        },
      })
      if (primaryTable) {
        actualTargetTable = primaryTable
        actualTargetId = primaryTable.id
      }
    }

    const existingCombinedIds: string[] =
      (actualTargetTable.combinedTableIds as string[]) || []
    const newCombinedIds = [...existingCombinedIds, sourceTableId]

    const baseName = actualTargetTable.originalName || actualTargetTable.name
    const combinedName =
      existingCombinedIds.length > 0
        ? `${actualTargetTable.name}+${sourceTable.name}`
        : `${baseName}+${sourceTable.name}`

    // 4) Build combined bounding box for side calc
    let combinedBoundingBox: PositioningTableRect = {
      id: actualTargetId,
      posX: actualTargetTable.posX,
      posY: actualTargetTable.posY,
      width: actualTargetTable.width,
      height: actualTargetTable.height,
    }

    if (existingCombinedIds.length > 0 && allTables && Array.isArray(allTables)) {
      const combinedRects = allTables.filter(
        t => existingCombinedIds.includes(t.id) || t.id === actualTargetId
      )

      if (combinedRects.length > 0) {
        let minX = actualTargetTable.posX
        let minY = actualTargetTable.posY
        let maxX = actualTargetTable.posX + actualTargetTable.width
        let maxY = actualTargetTable.posY + actualTargetTable.height

        for (const t of combinedRects) {
          minX = Math.min(minX, t.posX)
          minY = Math.min(minY, t.posY)
          maxX = Math.max(maxX, t.posX + t.width)
          maxY = Math.max(maxY, t.posY + t.height)
        }

        combinedBoundingBox = {
          id: actualTargetId,
          posX: minX,
          posY: minY,
          width: maxX - minX,
          height: maxY - minY,
        }
      }
    }

    const sourceRect: PositioningTableRect = {
      id: sourceTable.id,
      posX: sourceTable.posX,
      posY: sourceTable.posY,
      width: sourceTable.width,
      height: sourceTable.height,
    }

    // 5) Attach side + magnetic position
    let side: AttachSide = attachSide || 'right'
    if (!attachSide && dropX !== undefined && dropY !== undefined) {
      side = calculateAttachSide(dropX, dropY, combinedBoundingBox)
    }
    const magneticPos = calculateAttachPosition(sourceRect, combinedBoundingBox, side)

    const shiftedPositions = new Map<string, { posX: number; posY: number }>()

    // 6) Transaction: orders, collisions, tables, seats
    const result = await db.$transaction(async tx => {
      const sourceOrder = sourceTable.orders[0]
      const targetOrder = actualTargetTable.orders[0]

      // 6a) Orders (merge or move)
      if (sourceOrder) {
        if (targetOrder) {
          await tx.orderItem.updateMany({
            where: {
              orderId: sourceOrder.id,
              locationId,
              deletedAt: null,
            },
            data: { orderId: targetOrder.id },
          })

          const newGuestCount = targetOrder.guestCount + sourceOrder.guestCount
          const newSubtotal =
            Number(targetOrder.subtotal) + Number(sourceOrder.subtotal)
          const newTax = Number(targetOrder.taxTotal) + Number(sourceOrder.taxTotal)
          const newTotal = Number(targetOrder.total) + Number(sourceOrder.total)

          await tx.order.update({
            where: { id: targetOrder.id },
            data: {
              guestCount: newGuestCount,
              subtotal: newSubtotal,
              taxTotal: newTax,
              total: newTotal,
              notes: targetOrder.notes
                ? `${targetOrder.notes}\n[Combined from ${sourceTable.name}]`
                : `[Combined from ${sourceTable.name}]`,
            },
          })

          await tx.order.update({
            where: { id: sourceOrder.id },
            data: {
              status: 'merged',
              notes: `Merged into order #${targetOrder.orderNumber} on table ${actualTargetTable.name}`,
            },
          })
        } else {
          await tx.order.update({
            where: { id: sourceOrder.id },
            data: { tableId: actualTargetId },
          })
        }
      }

      // 6b) Collision shifting (preserve pockets)
      if (allTables && Array.isArray(allTables)) {
        const tableRects: TableRect[] = allTables.map(t => ({
          id: t.id,
          posX: t.id === sourceTableId ? magneticPos.posX : t.posX,
          posY: t.id === sourceTableId ? magneticPos.posY : t.posY,
          width: t.width,
          height: t.height,
        }))

        const newSourceRect: TableRect = {
          id: sourceRect.id,
          posX: magneticPos.posX,
          posY: magneticPos.posY,
          width: sourceRect.width,
          height: sourceRect.height,
        }

        const excludeIds = [sourceTableId, actualTargetId, ...existingCombinedIds]

        const shifts = shiftCollidingTables(newSourceRect, tableRects, excludeIds, 5)

        for (const [tableId, pos] of shifts) {
          await tx.table.update({
            where: { id: tableId },
            data: { posX: pos.posX, posY: pos.posY },
          })
          shiftedPositions.set(tableId, pos)
        }
      }

      // 6c) Mark source as child; move to magnetic pos
      await tx.table.update({
        where: { id: sourceTableId },
        data: {
          combinedWithId: actualTargetId,
          originalPosX: sourceTable.originalPosX ?? sourceTable.posX,
          originalPosY: sourceTable.originalPosY ?? sourceTable.posY,
          posX: magneticPos.posX,
          posY: magneticPos.posY,
          status: sourceOrder ? 'occupied' : actualTargetTable.status,
          originalName: sourceTable.originalName || sourceTable.name,
        },
      })

      // 6d) Update primary target
      const updatedTarget = await tx.table.update({
        where: { id: actualTargetId },
        data: {
          combinedTableIds: newCombinedIds,
          name: combinedName,
          originalName: actualTargetTable.originalName || actualTargetTable.name,
          capacity: actualTargetTable.capacity + sourceTable.capacity,
          status: sourceOrder || targetOrder ? 'occupied' : actualTargetTable.status,
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

      // 6e) Seats: perimeter + clockwise labels
      const allCombinedTableIds = [actualTargetId, sourceTableId, ...existingCombinedIds]

      const allSeats = await tx.seat.findMany({
        where: { tableId: { in: allCombinedTableIds }, isActive: true, deletedAt: null },
        orderBy: [{ tableId: 'asc' }, { seatNumber: 'asc' }],
      })

      if (allSeats.length > 0) {
        const tablePositions = new Map<
          string,
          { posX: number; posY: number; width: number; height: number }
        >()

        tablePositions.set(actualTargetId, {
          posX: actualTargetTable.posX,
          posY: actualTargetTable.posY,
          width: actualTargetTable.width,
          height: actualTargetTable.height,
        })

        tablePositions.set(sourceTableId, {
          posX: magneticPos.posX,
          posY: magneticPos.posY,
          width: sourceTable.width,
          height: sourceTable.height,
        })

        if (allTables && Array.isArray(allTables)) {
          for (const childId of existingCombinedIds) {
            const child = allTables.find(t => t.id === childId)
            if (child) {
              tablePositions.set(childId, {
                posX: child.posX,
                posY: child.posY,
                width: child.width,
                height: child.height,
              })
            }
          }
        }

        const groupRects: TableRect[] = []
        for (const [tableId, pos] of tablePositions) {
          groupRects.push({
            id: tableId,
            posX: pos.posX,
            posY: pos.posY,
            width: pos.width,
            height: pos.height,
            combinedWithId: null,
            combinedTableIds: null,
          })
        }

        if (groupRects.length > 0) {
          const perimeterPositions = distributeSeatsOnPerimeter(
            groupRects,
            allSeats.length
          )

          const bounds = getGroupBoundingBox(groupRects)
          const centerX = bounds ? bounds.minX + bounds.width / 2 : 0
          const centerY = bounds ? bounds.minY + bounds.height / 2 : 0

          const seatsWithPos = allSeats
            .map(seat => {
              const tablePos = tablePositions.get(seat.tableId)
              if (!tablePos) return null

              const tableCenterX = tablePos.posX + tablePos.width / 2
              const tableCenterY = tablePos.posY + tablePos.height / 2
              const absX = tableCenterX + seat.relativeX
              const absY = tableCenterY + seat.relativeY

              const dx = absX - centerX
              const dy = absY - centerY
              let angle = (Math.atan2(dy, dx) * 180) / Math.PI
              angle = (angle + 450) % 360 // top=0, clockwise

              return { seat, absX, absY, angle }
            })
            .filter(Boolean) as {
            seat: (typeof allSeats)[number]
            absX: number
            absY: number
            angle: number
          }[]

          seatsWithPos.sort((a, b) => a.angle - b.angle)

          for (let i = 0; i < seatsWithPos.length; i++) {
            const item = seatsWithPos[i]
            const newPos = perimeterPositions[i]
            if (!newPos) continue

            const tablePos = tablePositions.get(item.seat.tableId)
            if (!tablePos) continue

            const tableCenterX = tablePos.posX + tablePos.width / 2
            const tableCenterY = tablePos.posY + tablePos.height / 2

            const newRelativeX = Math.round(newPos.x - tableCenterX)
            const newRelativeY = Math.round(newPos.y - tableCenterY)

            const angleToCenter =
              (Math.atan2(centerY - newPos.y, centerX - newPos.x) * 180) / Math.PI
            const newAngle = Math.round(angleToCenter)

            await tx.seat.update({
              where: { id: item.seat.id },
              data: {
                relativeX: newRelativeX,
                relativeY: newRelativeY,
                angle: newAngle,
                label: String(i + 1),
              },
            })
          }
        }
      }

      const updatedSeats = await tx.seat.findMany({
        where: { tableId: { in: allCombinedTableIds }, isActive: true, deletedAt: null },
        select: {
          id: true,
          tableId: true,
          label: true,
          seatNumber: true,
          relativeX: true,
          relativeY: true,
          angle: true,
        },
        orderBy: { seatNumber: 'asc' },
      })

      await tx.auditLog.create({
        data: {
          locationId,
          employeeId: employeeId ?? null,
          action: 'tables_combined',
          entityType: 'table',
          entityId: actualTargetId,
          details: {
            sourceTableId,
            sourceTableName: sourceTable.name,
            targetTableId: actualTargetId,
            targetTableName: actualTargetTable.name,
            originalDropTargetId: targetTableId !== actualTargetId ? targetTableId : undefined,
            combinedName,
            attachSide: side,
            seatsRepositioned: updatedSeats.length,
          },
        },
      })

      return { updatedTarget, updatedSeats }
    })

    // 7) Emit realtime + response
    const shiftedTablesObj: Record<string, { posX: number; posY: number }> = {}
    for (const [tableId, pos] of shiftedPositions) {
      shiftedTablesObj[tableId] = pos
    }

    tableEvents.tablesCombined({
      sourceTableId,
      targetTableId: actualTargetId,
      locationId,
      combinedName,
      timestamp: new Date().toISOString(),
      triggeredBy: employeeId,
    })

    const targetOrder = result.updatedTarget.orders[0] || null

    return NextResponse.json({
      data: {
        table: {
          id: result.updatedTarget.id,
          name: result.updatedTarget.name,
          capacity: result.updatedTarget.capacity,
          status: result.updatedTarget.status,
          combinedTableIds: result.updatedTarget.combinedTableIds,
          originalName: result.updatedTarget.originalName,
          section: result.updatedTarget.section,
          currentOrder: targetOrder
            ? {
                id: targetOrder.id,
                orderNumber: targetOrder.orderNumber,
                guestCount: targetOrder.guestCount,
                total: Number(targetOrder.total),
                openedAt: targetOrder.createdAt.toISOString(),
              }
            : null,
        },
        sourceTable: {
          id: sourceTableId,
          posX: magneticPos.posX,
          posY: magneticPos.posY,
        },
        attachSide: side,
        shiftedTables: shiftedTablesObj,
        seats: result.updatedSeats,
        message: `Tables combined: ${combinedName}`,
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    const stack = error instanceof Error ? error.stack : undefined

    return NextResponse.json(
      {
        error: 'Failed to combine tables',
        details: msg,
        stack,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

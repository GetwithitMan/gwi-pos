import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate, dispatchOpenOrdersChanged, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/tables/merge
 *
 * Merge two tables by moving all open orders from sourceTable to targetTable.
 * Sets sourceTable back to 'available' after merge.
 *
 * Body: { sourceTableId, targetTableId, locationId, employeeId }
 * Returns: { mergedOrders, targetTable: { id, name } }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sourceTableId, targetTableId, locationId, employeeId } = body

    // --- Validation ---
    if (!sourceTableId || !targetTableId || !locationId) {
      return NextResponse.json(
        { error: 'sourceTableId, targetTableId, and locationId are required' },
        { status: 400 }
      )
    }

    if (sourceTableId === targetTableId) {
      return NextResponse.json(
        { error: 'Cannot merge a table with itself' },
        { status: 400 }
      )
    }

    // Fetch both tables
    const [sourceTable, targetTable] = await Promise.all([
      db.table.findFirst({
        where: { id: sourceTableId, locationId, deletedAt: null },
        select: { id: true, name: true, locationId: true, status: true },
      }),
      db.table.findFirst({
        where: { id: targetTableId, locationId, deletedAt: null },
        select: { id: true, name: true, locationId: true, status: true },
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

    // Find open orders on source table (tenant-scoped)
    const openOrders = await OrderRepository.getActiveOrdersForTable(sourceTableId, locationId)

    if (openOrders.length === 0) {
      return NextResponse.json(
        { error: 'Source table has no open orders to merge' },
        { status: 400 }
      )
    }

    // --- Execute merge in a transaction ---
    await db.$transaction(async (tx) => {
      // Move all open orders from source to target (tenant-scoped)
      for (const order of openOrders) {
        await OrderRepository.updateOrder(order.id, locationId, { tableId: targetTableId }, tx)
      }

      // Set source table back to available
      await tx.table.update({
        where: { id: sourceTableId },
        data: { status: 'available' },
      })

      // Set target table to occupied (in case it was available)
      await tx.table.update({
        where: { id: targetTableId },
        data: { status: 'occupied' },
      })
    })

    // --- Audit log ---
    await db.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId || null,
        action: 'table_merge',
        entityType: 'table',
        entityId: targetTableId,
        details: {
          sourceTableId,
          sourceTableName: sourceTable.name,
          targetTableId,
          targetTableName: targetTable.name,
          mergedOrders: openOrders.length,
          orderIds: openOrders.map(o => o.id),
          orderNumbers: openOrders.map(o => o.orderNumber),
        },
      },
    })

    // --- Socket events (fire-and-forget) ---
    void dispatchTableStatusChanged(locationId, { tableId: sourceTableId, status: 'available' }).catch(console.error)
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

    for (const order of openOrders) {
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'transferred',
        orderId: order.id,
        tableId: targetTableId,
        orderNumber: order.orderNumber,
      }, { async: true }).catch(() => {})

      void emitOrderEvent(locationId, order.id, 'ORDER_METADATA_UPDATED', {
        tableId: targetTableId,
        tableName: targetTable.name,
        mergedFrom: sourceTable.name,
      }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        mergedOrders: openOrders.length,
        targetTable: {
          id: targetTable.id,
          name: targetTable.name,
        },
      },
    })
  } catch (error) {
    console.error('Failed to merge tables:', error)
    return NextResponse.json(
      { error: 'Failed to merge tables' },
      { status: 500 }
    )
  }
})

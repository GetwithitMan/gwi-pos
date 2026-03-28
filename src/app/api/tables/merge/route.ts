import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { OrderRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate, dispatchOpenOrdersChanged, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('tables-merge')

/**
 * POST /api/tables/merge
 *
 * Merge two tables by moving all open orders from sourceTable to targetTable.
 * Sets sourceTable back to 'available' after merge.
 *
 * Body: { sourceTableId, targetTableId, locationId, employeeId }
 * Returns: { mergedOrders, targetTable: { id, name } }
 */
export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { sourceTableId, targetTableId, locationId, employeeId } = body

    // --- Validation ---
    if (!sourceTableId || !targetTableId || !locationId) {
      return err('sourceTableId, targetTableId, and locationId are required')
    }

    if (sourceTableId === targetTableId) {
      return err('Cannot merge a table with itself')
    }

    // Auth check — require tables.edit permission
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    const auth = await requirePermission(resolvedEmployeeId, locationId, PERMISSIONS.TABLES_EDIT)
    if (!auth.authorized) return err(auth.error, auth.status)

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
      return notFound('Source table not found')
    }

    if (!targetTable) {
      return notFound('Target table not found')
    }

    // Find open orders on source table (tenant-scoped)
    const openOrders = await OrderRepository.getActiveOrdersForTable(sourceTableId, locationId)

    if (openOrders.length === 0) {
      return err('Source table has no open orders to merge')
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

    pushUpstream()

    // --- Socket events (fire-and-forget) ---
    void dispatchTableStatusChanged(locationId, { tableId: sourceTableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

    for (const order of openOrders) {
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'transferred',
        orderId: order.id,
        tableId: targetTableId,
        orderNumber: order.orderNumber,
      }, { async: true }).catch(err => log.warn({ err }, 'Socket dispatch failed'))

      void emitOrderEvent(locationId, order.id, 'ORDER_METADATA_UPDATED', {
        tableId: targetTableId,
        tableName: targetTable.name,
        mergedFrom: sourceTable.name,
      }).catch(err => log.warn({ err }, 'Socket dispatch failed'))
    }

    return ok({
        mergedOrders: openOrders.length,
        targetTable: {
          id: targetTable.id,
          name: targetTable.name,
        },
      })
  } catch (error) {
    console.error('Failed to merge tables:', error)
    return err('Failed to merge tables', 500)
  }
}))

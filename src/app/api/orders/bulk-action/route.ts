import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTableStatusChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, forbidden, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-bulk-action')

export const POST = withVenue(withAuth(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderIds, action, employeeId, toEmployeeId, reason } = body as {
      orderIds: string[]
      action: 'void' | 'transfer' | 'cancel'
      employeeId: string
      toEmployeeId?: string
      reason?: string
    }

    if (!orderIds?.length || !action || !employeeId) {
      return err('Missing required fields: orderIds, action, employeeId')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      const firstOrder = await db.orderSnapshot.findFirst({
        where: { id: orderIds[0], deletedAt: null },
        select: { locationId: true },
      })
      if (!firstOrder) {
        return notFound('Order not found')
      }
      locationId = firstOrder.locationId
    }

    // Require manager permission
    const auth = await requireAnyPermission(employeeId, locationId, [PERMISSIONS.MGR_BULK_OPERATIONS])
    if (!auth.authorized) {
      return forbidden(auth.error || 'Manager permission required')
    }

    const now = new Date()
    let processedCount = 0

    if (action === 'void') {
      // Void all specified orders in a transaction
      await db.$transaction(async (tx) => {
        // Void authorized cards on these orders
        await tx.orderCard.updateMany({
          where: {
            orderId: { in: orderIds },
            status: 'authorized',
          },
          data: { status: 'voided', lastMutatedBy: 'local' },
        })

        // TX-KEEP: BULK — void multiple orders by ID array; no repo method for batch order status updates
        const result = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            locationId,
            status: { in: ['open', 'sent', 'in_progress', 'split'] },
            deletedAt: null,
          },
          data: {
            status: 'voided',
            tabStatus: 'closed',
            closedAt: now,
            version: { increment: 1 },
            lastMutatedBy: 'local',
          },
        })
        processedCount = result.count

        // Audit log
        await tx.auditLog.create({
          data: {
            locationId,
            employeeId,
            action: 'bulk_void_orders',
            entityType: 'order',
            entityId: orderIds.join(','),
            details: {
              orderIds,
              count: processedCount,
              reason: reason || 'Bulk void of rolled-over orders',
            },
          },
        })
      })

      // Note: We intentionally don't call Datacap voidSale here because
      // rolled-over preauths have likely already expired. If they haven't,
      // the hold will auto-release after the processor's hold period (typically 7 days).

    } else if (action === 'cancel') {
      // Cancel action: soft-delete draft/open/split orders with no preAuth
      // First check for preAuth — those must be voided, not cancelled (read from OrderSnapshot)
      const ordersWithPreAuth = await db.orderSnapshot.findMany({
        where: {
          id: { in: orderIds },
          preAuthId: { not: null },
          deletedAt: null,
        },
        select: { id: true, orderNumber: true },
      })
      if (ordersWithPreAuth.length > 0) {
        const nums = ordersWithPreAuth.map(o => `#${o.orderNumber}`).join(', ')
        return err(`Orders ${nums} have a pre-authorization and must be voided, not cancelled`, 422)
      }

      const cancelledTableIds = await db.$transaction(async (tx) => {
        // TX-KEEP: BULK — fetch multiple orders by ID array for table cleanup; no batch repo method
        const targetOrders = await tx.order.findMany({
          where: {
            id: { in: orderIds },
            locationId,
            status: { in: ['draft', 'open', 'split'] },
            deletedAt: null,
          },
          select: { id: true, tableId: true },
        })
        const tableIds = targetOrders.map(o => o.tableId).filter((t): t is string => !!t)

        // TX-KEEP: BULK — batch cancel multiple orders by ID array; no repo method for batch status change
        const result = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            locationId,
            status: { in: ['draft', 'open', 'split'] },
            deletedAt: null,
          },
          data: {
            status: 'cancelled',
            closedAt: now,
            deletedAt: now,
            version: { increment: 1 },
            lastMutatedBy: 'local',
          },
        })
        processedCount = result.count

        // Reset associated tables to available
        if (tableIds.length > 0) {
          await tx.table.updateMany({
            where: { id: { in: tableIds } },
            data: { status: 'available' },
          })
        }

        // Audit log
        await tx.auditLog.create({
          data: {
            locationId,
            employeeId,
            action: 'bulk_cancel_orders',
            entityType: 'order',
            entityId: orderIds.join(','),
            details: {
              orderIds,
              count: processedCount,
              reason: reason || 'Bulk cancel of draft/open orders',
            },
          },
        })

        return tableIds
      })

      // Dispatch table:status-changed for each reset table (outside transaction)
      for (const tableId of cancelledTableIds) {
        void dispatchTableStatusChanged(locationId, { tableId, status: 'available' }).catch(err => log.warn({ err }, 'Background task failed'))
      }

    } else if (action === 'transfer') {
      if (!toEmployeeId) {
        return err('toEmployeeId required for transfer')
      }

      // TX-KEEP: BULK — batch transfer multiple orders to new employee by ID array; no batch repo method
      const result = await db.order.updateMany({
        where: {
          id: { in: orderIds },
          status: { in: ['open', 'sent', 'in_progress', 'split'] },
          deletedAt: null,
        },
        data: { employeeId: toEmployeeId, version: { increment: 1 }, lastMutatedBy: 'local' },
      })
      processedCount = result.count

      await db.auditLog.create({
        data: {
          locationId,
          employeeId,
          action: 'bulk_transfer_orders',
          entityType: 'order',
          entityId: orderIds.join(','),
          details: {
            orderIds,
            count: processedCount,
            toEmployeeId,
            reason: reason || 'Bulk transfer of rolled-over orders',
          },
        },
      })
    }

    // Emit order events for each affected order.
    // These MUST succeed for event-source consistency. Await all and log failures.
    const eventPromises: Promise<unknown>[] = []
    if (action === 'void') {
      for (const id of orderIds) {
        eventPromises.push(
          emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
            closedStatus: 'voided',
            reason: reason || 'Bulk void',
          }).catch(e => log.error({ err: e, orderId: id }, 'CRITICAL: failed to emit ORDER_CLOSED event for bulk-voided order'))
        )
      }
    } else if (action === 'cancel') {
      for (const id of orderIds) {
        eventPromises.push(
          emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
            closedStatus: 'cancelled',
            reason: reason || 'Bulk cancel',
          }).catch(e => log.error({ err: e, orderId: id }, 'CRITICAL: failed to emit ORDER_CLOSED event for bulk-cancelled order'))
        )
      }
    } else if (action === 'transfer') {
      for (const id of orderIds) {
        eventPromises.push(
          emitOrderEvent(locationId, id, 'ORDER_METADATA_UPDATED', {
            employeeId: toEmployeeId,
          }).catch(e => log.error({ err: e, orderId: id }, 'CRITICAL: failed to emit ORDER_METADATA_UPDATED event for bulk-transferred order'))
        )
      }
    }
    // Await all event emissions — best-effort but logged if any fail
    await Promise.allSettled(eventPromises)

    pushUpstream()

    // Dispatch socket update
    dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
    dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))

    return ok({
        success: true,
        action,
        processedCount,
        orderIds,
      })
  } catch (error) {
    console.error('[Bulk Action] Error:', error)
    return err('Failed to process bulk action', 500)
  }
}))

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'

export const POST = withVenue(async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: 'Missing required fields: orderIds, action, employeeId' }, { status: 400 })
    }

    // Verify first order to get locationId — read from OrderSnapshot
    const firstOrder = await db.orderSnapshot.findFirst({
      where: { id: orderIds[0], deletedAt: null },
      select: { locationId: true },
    })

    if (!firstOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = firstOrder.locationId

    // Require manager permission
    const auth = await requireAnyPermission(employeeId, locationId, [PERMISSIONS.MGR_BULK_OPERATIONS])
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Manager permission required' }, { status: 403 })
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
          data: { status: 'voided' },
        })

        // Void the orders
        const result = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            status: { in: ['open', 'sent', 'in_progress', 'split'] },
            deletedAt: null,
          },
          data: {
            status: 'voided',
            tabStatus: 'closed',
            closedAt: now,
            version: { increment: 1 },
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
        return NextResponse.json(
          { error: `Orders ${nums} have a pre-authorization and must be voided, not cancelled` },
          { status: 422 }
        )
      }

      await db.$transaction(async (tx) => {
        // Fetch the orders to get their tableIds for cleanup
        const targetOrders = await tx.order.findMany({
          where: {
            id: { in: orderIds },
            status: { in: ['draft', 'open', 'split'] },
            deletedAt: null,
          },
          select: { id: true, tableId: true },
        })
        const tableIds = targetOrders.map(o => o.tableId).filter((t): t is string => !!t)

        // Soft-delete / cancel
        const result = await tx.order.updateMany({
          where: {
            id: { in: orderIds },
            status: { in: ['draft', 'open', 'split'] },
            deletedAt: null,
          },
          data: {
            status: 'cancelled',
            closedAt: now,
            deletedAt: now,
            version: { increment: 1 },
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
      })

    } else if (action === 'transfer') {
      if (!toEmployeeId) {
        return NextResponse.json({ error: 'toEmployeeId required for transfer' }, { status: 400 })
      }

      const result = await db.order.updateMany({
        where: {
          id: { in: orderIds },
          status: { in: ['open', 'sent', 'in_progress', 'split'] },
          deletedAt: null,
        },
        data: { employeeId: toEmployeeId, version: { increment: 1 } },
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

    // Emit order events for each affected order (fire-and-forget)
    if (action === 'void') {
      for (const id of orderIds) {
        void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
          closedStatus: 'voided',
          reason: reason || 'Bulk void',
        })
      }
    } else if (action === 'cancel') {
      for (const id of orderIds) {
        void emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
          closedStatus: 'cancelled',
          reason: reason || 'Bulk cancel',
        })
      }
    } else if (action === 'transfer') {
      for (const id of orderIds) {
        void emitOrderEvent(locationId, id, 'ORDER_METADATA_UPDATED', {
          employeeId: toEmployeeId,
        })
      }
    }

    // Dispatch socket update
    dispatchOpenOrdersChanged(locationId, { trigger: 'updated' as any }, { async: true }).catch(() => {})
    dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})

    return NextResponse.json({
      data: {
        success: true,
        action,
        processedCount,
        orderIds,
      },
    })
  } catch (error) {
    console.error('[Bulk Action] Error:', error)
    return NextResponse.json({ error: 'Failed to process bulk action' }, { status: 500 })
  }
})

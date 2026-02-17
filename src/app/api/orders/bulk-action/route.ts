import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderIds, action, employeeId, toEmployeeId, reason } = body as {
      orderIds: string[]
      action: 'void' | 'transfer'
      employeeId: string
      toEmployeeId?: string
      reason?: string
    }

    if (!orderIds?.length || !action || !employeeId) {
      return NextResponse.json({ error: 'Missing required fields: orderIds, action, employeeId' }, { status: 400 })
    }

    // Verify first order to get locationId
    const firstOrder = await db.order.findFirst({
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
        data: { employeeId: toEmployeeId },
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

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { EmployeeRepository, OrderRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, notFound, ok } from '@/lib/api-response'

// POST - Transfer table to another server
export const POST = withVenue(withAuth(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    const body = await request.json()
    const { toEmployeeId, fromEmployeeId, reason } = body

    if (!toEmployeeId) {
      return err('Target employee ID is required')
    }

    // Get the table
    const table = await db.table.findUnique({
      where: { id: tableId },
      include: {
        section: true,
      },
    })

    if (!table) {
      return notFound('Table not found')
    }

    // Verify target employee exists
    const toEmployee = await EmployeeRepository.getEmployeeByIdWithSelect(toEmployeeId, table.locationId, {
      id: true, firstName: true, lastName: true, displayName: true,
    })

    if (!toEmployee) {
      return notFound('Target employee not found')
    }

    // Find all open orders for this table and transfer them
    const openOrders = await OrderRepository.getActiveOrdersForTable(tableId, table.locationId)

    // Update all orders to new employee (open, sent, and split parents)
    const transferableOrders = openOrders.filter(o => o.status === 'open' || o.status === 'sent' || o.status === 'split')

    // Wrap all mutations in a transaction for atomicity
    await db.$transaction(async (tx) => {
      for (const order of transferableOrders) {
        await tx.order.update({
          where: { id: order.id },
          data: { employeeId: toEmployeeId },
        })

        // When transferring a split parent, also update all its child orders
        if (order.status === 'split') {
          await tx.order.updateMany({
            where: { parentOrderId: order.id, deletedAt: null },
            data: { employeeId: toEmployeeId },
          })
        }
      }

      // Create audit log entry for each transferred order
      for (const order of transferableOrders) {
        await tx.auditLog.create({
          data: {
            locationId: table.locationId,
            employeeId: fromEmployeeId,
            action: 'table_transfer',
            entityType: 'order',
            entityId: order.id,
            details: {
              tableId,
              tableName: table.name,
              orderId: order.id,
              orderNumber: order.orderNumber,
              fromEmployeeId,
              toEmployeeId,
              toEmployeeName: toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`,
              reason,
            },
          },
        })
      }

      // Also create a single audit log for the table transfer
      await tx.auditLog.create({
        data: {
          locationId: table.locationId,
          employeeId: fromEmployeeId,
          action: 'table_transfer',
          entityType: 'table',
          entityId: tableId,
          details: {
            tableName: table.name,
            ordersTransferred: transferableOrders.length,
            fromEmployeeId,
            toEmployeeId,
            toEmployeeName: toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`,
            reason,
          },
        },
      })
    })

    // Emit order events for each transferred order (fire-and-forget)
    for (const order of transferableOrders) {
      void emitOrderEvent(table.locationId, order.id, 'ORDER_METADATA_UPDATED', {
        employeeId: toEmployeeId,
      })
    }

    pushUpstream()

    // Notify POS terminals of table transfer
    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return ok({
      success: true,
      table: {
        id: table.id,
        name: table.name,
      },
      toEmployee: {
        id: toEmployee.id,
        name: toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`,
      },
      ordersTransferred: transferableOrders.length,
      orderIds: transferableOrders.map(o => o.id),
    })
  } catch (error) {
    console.error('Failed to transfer table:', error)
    return err('Failed to transfer table', 500)
  }
}))

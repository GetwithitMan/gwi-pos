import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { EmployeeRepository, OrderRepository } from '@/lib/repositories'
import { dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

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
      return NextResponse.json(
        { error: 'Target employee ID is required' },
        { status: 400 }
      )
    }

    // Get the table
    const table = await db.table.findUnique({
      where: { id: tableId },
      include: {
        section: true,
      },
    })

    if (!table) {
      return NextResponse.json(
        { error: 'Table not found' },
        { status: 404 }
      )
    }

    // Verify target employee exists
    const toEmployee = await EmployeeRepository.getEmployeeByIdWithSelect(toEmployeeId, table.locationId, {
      id: true, firstName: true, lastName: true, displayName: true,
    })

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Target employee not found' },
        { status: 404 }
      )
    }

    // Find all open orders for this table and transfer them
    const openOrders = await OrderRepository.getActiveOrdersForTable(tableId, table.locationId)

    // Update all orders to new employee (open, sent, and split parents)
    const transferableOrders = openOrders.filter(o => o.status === 'open' || o.status === 'sent' || o.status === 'split')
    for (const order of transferableOrders) {
      await OrderRepository.updateOrder(order.id, table.locationId, { employeeId: toEmployeeId })

      // When transferring a split parent, also update all its child orders
      if (order.status === 'split') {
        await db.order.updateMany({
          where: { parentOrderId: order.id, deletedAt: null },
          data: { employeeId: toEmployeeId },
        })
      }
    }

    // Create audit log entry for each transferred order
    for (const order of transferableOrders) {
      await db.auditLog.create({
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
    await db.auditLog.create({
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

    // Emit order events for each transferred order (fire-and-forget)
    for (const order of transferableOrders) {
      void emitOrderEvent(table.locationId, order.id, 'ORDER_METADATA_UPDATED', {
        employeeId: toEmployeeId,
      })
    }

    // Notify POS terminals of table transfer
    dispatchFloorPlanUpdate(table.locationId, { async: true })

    return NextResponse.json({ data: {
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
    } })
  } catch (error) {
    console.error('Failed to transfer table:', error)
    return NextResponse.json(
      { error: 'Failed to transfer table' },
      { status: 500 }
    )
  }
}))

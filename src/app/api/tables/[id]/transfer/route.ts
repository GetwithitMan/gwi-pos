import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Transfer table to another server
export async function POST(
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
    const toEmployee = await db.employee.findUnique({
      where: { id: toEmployeeId },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    })

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Target employee not found' },
        { status: 404 }
      )
    }

    // Find all open orders for this table and transfer them
    const openOrders = await db.order.findMany({
      where: {
        tableId,
        status: { in: ['open', 'sent'] },
      },
    })

    // Update all orders to new employee
    if (openOrders.length > 0) {
      await db.order.updateMany({
        where: {
          tableId,
          status: { in: ['open', 'sent'] },
        },
        data: {
          employeeId: toEmployeeId,
        },
      })
    }

    // Create audit log entry for each transferred order
    for (const order of openOrders) {
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
          ordersTransferred: openOrders.length,
          fromEmployeeId,
          toEmployeeId,
          toEmployeeName: toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`,
          reason,
        },
      },
    })

    return NextResponse.json({
      success: true,
      table: {
        id: table.id,
        name: table.name,
      },
      toEmployee: {
        id: toEmployee.id,
        name: toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`,
      },
      ordersTransferred: openOrders.length,
      orderIds: openOrders.map(o => o.id),
    })
  } catch (error) {
    console.error('Failed to transfer table:', error)
    return NextResponse.json(
      { error: 'Failed to transfer table' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { reason, notes, managerId } = await request.json()

    // Validate inputs
    if (!reason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify manager has permission
    const manager = await db.employee.findUnique({
      where: { id: managerId },
      include: { role: true },
    })
    if (!manager) {
      return NextResponse.json({ error: 'Manager not found' }, { status: 404 })
    }
    const permissions = Array.isArray(manager.role?.permissions) ? manager.role.permissions as string[] : []
    if (!hasPermission(permissions, 'manager.void_orders')) {
      return NextResponse.json({ error: 'Insufficient permissions to reopen orders' }, { status: 403 })
    }

    // Get the order
    const order = await db.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Check if order can be reopened
    if (order.status !== 'closed' && order.status !== 'paid' && order.status !== 'voided') {
      return NextResponse.json(
        { error: `Cannot reopen order with status: ${order.status}` },
        { status: 400 }
      )
    }

    // Update order to open status
    const reopenedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        status: 'open',
        reopenedAt: new Date(),
        reopenedBy: managerId,
        reopenReason: reason,
      },
    })

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: managerId,
        action: 'order_reopened',
        entityType: 'order',
        entityId: orderId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          oldStatus: order.status,
          newStatus: 'open',
          reason,
          notes: notes || null,
          closedAt: order.closedAt,
          total: Number(order.total),
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    return NextResponse.json({
      data: {
        order: {
          id: reopenedOrder.id,
          orderNumber: reopenedOrder.orderNumber,
          status: reopenedOrder.status,
          reopenedAt: reopenedOrder.reopenedAt,
        },
      },
    })
  } catch (error) {
    console.error('Failed to reopen order:', error)
    return NextResponse.json(
      { error: 'Failed to reopen order' },
      { status: 500 }
    )
  }
})

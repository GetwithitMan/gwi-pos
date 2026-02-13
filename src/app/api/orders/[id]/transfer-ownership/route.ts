import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

interface TransferOwnershipRequest {
  employeeId: string
  toEmployeeId: string
  reason?: string
}

// POST - Transfer tab/order ownership to another employee
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as TransferOwnershipRequest

    const { employeeId, toEmployeeId, reason } = body

    if (!employeeId || !toEmployeeId) {
      return NextResponse.json(
        { error: 'Both employeeId and toEmployeeId are required' },
        { status: 400 }
      )
    }

    if (employeeId === toEmployeeId) {
      return NextResponse.json(
        { error: 'Cannot transfer to the same employee' },
        { status: 400 }
      )
    }

    // Fetch order
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        employee: {
          select: { id: true, firstName: true, lastName: true, displayName: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    if (order.status === 'paid' || order.status === 'closed' || order.status === 'voided') {
      return NextResponse.json(
        { error: 'Cannot transfer a paid/closed/voided order' },
        { status: 400 }
      )
    }

    // Auth: allow if transferring own tab, otherwise require manager.transfer_checks
    if (employeeId !== order.employeeId) {
      const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_TRANSFER_CHECKS)
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Verify toEmployee exists and is active at same location
    const toEmployee = await db.employee.findFirst({
      where: {
        id: toEmployeeId,
        locationId: order.locationId,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    })

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Target employee not found or not active at this location' },
        { status: 404 }
      )
    }

    // Transfer ownership + audit log atomically
    const updatedOrder = await db.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: orderId },
        data: { employeeId: toEmployeeId },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
          table: {
            select: { id: true, name: true },
          },
        },
      })

      await tx.auditLog.create({
        data: {
          locationId: order.locationId,
          employeeId,
          action: 'tab_ownership_transferred',
          entityType: 'order',
          entityId: orderId,
          details: {
            orderNumber: order.orderNumber,
            fromEmployeeId: order.employeeId,
            toEmployeeId,
            reason: reason || null,
          },
        },
      })

      return updated
    })

    // Socket dispatch to notify terminals (fire-and-forget)
    dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      commissionTotal: Number(updatedOrder.commissionTotal),
    }, { async: true }).catch(console.error)

    const fromName = order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`
    const toName = toEmployee.displayName || `${toEmployee.firstName} ${toEmployee.lastName}`

    return NextResponse.json({
      data: {
        order: {
          id: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          employeeId: updatedOrder.employeeId,
          table: updatedOrder.table,
          tabName: updatedOrder.tabName,
          status: updatedOrder.status,
        },
        transferredFrom: { id: order.employeeId, name: fromName },
        transferredTo: { id: toEmployeeId, name: toName },
      },
    })
  } catch (error) {
    console.error('Failed to transfer tab ownership:', error)
    return NextResponse.json(
      { error: 'Failed to transfer tab ownership' },
      { status: 500 }
    )
  }
})

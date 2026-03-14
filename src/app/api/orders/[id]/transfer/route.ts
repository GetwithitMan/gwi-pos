/**
 * Order Transfer API
 *
 * POST - Transfer an individual order from one employee to another.
 * Used for shift handoff and ad-hoc order reassignment.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchTabUpdated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { isOpen } from '@/lib/domain/order-status'

interface TransferPayload {
  toEmployeeId: string
  reason?: string
  fromEmployeeId: string
}

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as TransferPayload
    const { toEmployeeId, reason, fromEmployeeId } = body

    if (!toEmployeeId) {
      return NextResponse.json(
        { error: 'toEmployeeId is required' },
        { status: 400 }
      )
    }

    if (!fromEmployeeId) {
      return NextResponse.json(
        { error: 'fromEmployeeId is required' },
        { status: 400 }
      )
    }

    // ── Fetch the order ─────────────────────────────────────────────────
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        orderNumber: true,
        tabName: true,
        status: true,
        employeeId: true,
        locationId: true,
        orderType: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // ── Validate order is open ──────────────────────────────────────────
    if (!isOpen(order.status)) {
      return NextResponse.json(
        { error: 'Cannot transfer a closed, paid, or voided order' },
        { status: 400 }
      )
    }

    // ── Self-transfer guard ─────────────────────────────────────────────
    if (order.employeeId === toEmployeeId) {
      return NextResponse.json(
        { error: 'Order is already assigned to this employee' },
        { status: 400 }
      )
    }

    // ── Auth: own order uses pos.change_server, other's order needs manager.transfer_checks ──
    const isOwnOrder = order.employeeId === fromEmployeeId
    const requiredPerms = isOwnOrder
      ? [PERMISSIONS.POS_CHANGE_SERVER, PERMISSIONS.MGR_TRANSFER_CHECKS]
      : [PERMISSIONS.MGR_TRANSFER_CHECKS]

    const auth = await requireAnyPermission(fromEmployeeId, order.locationId, requiredPerms)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // ── Validate destination employee ───────────────────────────────────
    const toEmployee = await db.employee.findFirst({
      where: {
        id: toEmployeeId,
        locationId: order.locationId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      },
    })

    if (!toEmployee) {
      return NextResponse.json(
        { error: 'Destination employee not found or inactive' },
        { status: 404 }
      )
    }

    // ── Validate destination employee has an open shift ──────────────────
    const toShift = await db.shift.findFirst({
      where: {
        employeeId: toEmployeeId,
        locationId: order.locationId,
        status: 'open',
      },
      select: { id: true },
    })

    if (!toShift) {
      return NextResponse.json(
        { error: 'Destination employee does not have an open shift' },
        { status: 400 }
      )
    }

    // ── Transfer the order ──────────────────────────────────────────────
    const previousEmployeeId = order.employeeId
    const updatedOrder = await db.order.update({
      where: { id: orderId },
      data: { employeeId: toEmployeeId },
      select: {
        id: true,
        orderNumber: true,
        tabName: true,
        status: true,
        employeeId: true,
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
    })

    // ── Audit log ───────────────────────────────────────────────────────
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: fromEmployeeId,
        action: 'order_transferred',
        entityType: 'order',
        entityId: orderId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          tabName: order.tabName,
          fromEmployeeId: previousEmployeeId,
          toEmployeeId,
          reason: reason || null,
        },
      },
    })

    // ── Emit order event (fire-and-forget) ──────────────────────────────
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      employeeId: toEmployeeId,
      previousEmployeeId,
      transferReason: reason || null,
    })

    // ── Socket dispatch (fire-and-forget) ───────────────────────────────
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'transferred',
      orderId,
    }, { async: true }).catch(console.error)

    void dispatchTabUpdated(order.locationId, {
      orderId,
    }).catch(console.error)

    return NextResponse.json({
      data: {
        success: true,
        order: {
          id: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          tabName: updatedOrder.tabName,
          status: updatedOrder.status,
          newEmployee: {
            id: updatedOrder.employee.id,
            name: updatedOrder.employee.displayName ||
              `${updatedOrder.employee.firstName} ${updatedOrder.employee.lastName}`,
          },
        },
      },
    })
  } catch (error) {
    console.error('Failed to transfer order:', error)
    return NextResponse.json(
      { error: 'Failed to transfer order' },
      { status: 500 }
    )
  }
})

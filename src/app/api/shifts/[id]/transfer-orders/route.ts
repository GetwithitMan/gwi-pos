/**
 * Bulk Order Transfer API (Shift Handoff)
 *
 * POST - Transfer ALL open orders from a shift's employee to another employee.
 * Used when an employee wants to hand off their section before closing their shift.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchTabUpdated } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { OPEN_ORDER_STATUSES } from '@/lib/domain/order-status'
import type { OrderStatus } from '@prisma/client'

interface BulkTransferPayload {
  toEmployeeId: string
  requestingEmployeeId: string
}

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shiftId } = await params
    const body = await request.json() as BulkTransferPayload
    const { toEmployeeId, requestingEmployeeId } = body

    if (!toEmployeeId) {
      return NextResponse.json(
        { error: 'toEmployeeId is required' },
        { status: 400 }
      )
    }

    if (!requestingEmployeeId) {
      return NextResponse.json(
        { error: 'requestingEmployeeId is required' },
        { status: 400 }
      )
    }

    // ── Fetch the shift ─────────────────────────────────────────────────
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        employeeId: true,
        locationId: true,
        status: true,
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
    })

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found' },
        { status: 404 }
      )
    }

    if (shift.status === 'closed') {
      return NextResponse.json(
        { error: 'Shift is already closed' },
        { status: 400 }
      )
    }

    // ── Auth: own shift needs SHIFT_CLOSE equivalent, other shift needs manager ──
    const isOwnShift = requestingEmployeeId === shift.employeeId
    const requiredPerms = isOwnShift
      ? [PERMISSIONS.POS_CHANGE_SERVER, PERMISSIONS.MGR_TRANSFER_CHECKS]
      : [PERMISSIONS.MGR_TRANSFER_CHECKS, PERMISSIONS.MGR_BULK_OPERATIONS]

    const auth = await requireAnyPermission(requestingEmployeeId, shift.locationId, requiredPerms)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // ── Validate destination employee ───────────────────────────────────
    const toEmployee = await db.employee.findFirst({
      where: {
        id: toEmployeeId,
        locationId: shift.locationId,
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

    // ── Self-transfer guard ─────────────────────────────────────────────
    if (shift.employeeId === toEmployeeId) {
      return NextResponse.json(
        { error: 'Cannot transfer orders to the same employee' },
        { status: 400 }
      )
    }

    // ── Validate destination employee has an open shift ──────────────────
    const toShift = await db.shift.findFirst({
      where: {
        employeeId: toEmployeeId,
        locationId: shift.locationId,
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

    // ── Bulk transfer in a transaction ──────────────────────────────────
    const result = await db.$transaction(async (tx) => {
      // Find all open orders for the shift employee
      const openOrders = await tx.order.findMany({
        where: {
          locationId: shift.locationId,
          employeeId: shift.employeeId,
          status: { in: OPEN_ORDER_STATUSES as unknown as OrderStatus[] },
          deletedAt: null,
        },
        select: {
          id: true,
          orderNumber: true,
          tabName: true,
          status: true,
        },
      })

      if (openOrders.length === 0) {
        return { transferred: 0, orders: [] }
      }

      const orderIds = openOrders.map((o) => o.id)

      // Bulk update all orders
      await tx.order.updateMany({
        where: { id: { in: orderIds } },
        data: { employeeId: toEmployeeId },
      })

      // Audit log for the bulk transfer
      await tx.auditLog.create({
        data: {
          locationId: shift.locationId,
          employeeId: requestingEmployeeId,
          action: 'bulk_order_transfer',
          entityType: 'shift',
          entityId: shiftId,
          details: {
            shiftId,
            fromEmployeeId: shift.employeeId,
            toEmployeeId,
            orderCount: openOrders.length,
            orderIds,
          },
        },
      })

      return { transferred: openOrders.length, orders: openOrders }
    })

    // ── Emit order events for each transferred order (fire-and-forget) ──
    if (result.orders.length > 0) {
      void Promise.all(
        result.orders.map((o) =>
          emitOrderEvent(shift.locationId, o.id, 'ORDER_METADATA_UPDATED', {
            employeeId: toEmployeeId,
            previousEmployeeId: shift.employeeId,
            bulkTransfer: true,
          })
        )
      ).catch(console.error)

      // Single batch socket dispatch for all orders
      void dispatchOpenOrdersChanged(shift.locationId, {
        trigger: 'transferred',
      }, { async: true }).catch(console.error)

      // Dispatch tab updated for each transferred order
      void Promise.all(
        result.orders.map((o) =>
          dispatchTabUpdated(shift.locationId, { orderId: o.id })
        )
      ).catch(console.error)

      // Notify shift change
      void emitToLocation(shift.locationId, 'shifts:changed', {
        action: 'orders-transferred',
        shiftId,
        fromEmployeeId: shift.employeeId,
        toEmployeeId,
        count: result.transferred,
      }).catch(console.error)
    }

    const fromName = shift.employee.displayName ||
      `${shift.employee.firstName} ${shift.employee.lastName}`
    const toName = toEmployee.displayName ||
      `${toEmployee.firstName} ${toEmployee.lastName}`

    return NextResponse.json({
      data: {
        success: true,
        transferred: result.transferred,
        fromEmployee: { id: shift.employeeId, name: fromName },
        toEmployee: { id: toEmployeeId, name: toName },
        orders: result.orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          tabName: o.tabName,
          status: o.status,
        })),
      },
    })
  } catch (error) {
    console.error('Failed to bulk transfer orders:', error)
    return NextResponse.json(
      { error: 'Failed to transfer orders' },
      { status: 500 }
    )
  }
})

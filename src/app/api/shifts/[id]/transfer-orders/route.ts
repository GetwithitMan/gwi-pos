/**
 * Bulk Order Transfer API (Shift Handoff)
 *
 * POST - Transfer ALL open orders from a shift's employee to another employee.
 * Used when an employee wants to hand off their section before closing their shift.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAnyPermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchTabUpdated } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { OPEN_ORDER_STATUSES } from '@/lib/domain/order-status'
import type { OrderStatus } from '@/generated/prisma/client'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('shifts-transfer-orders')

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
      return err('toEmployeeId is required')
    }

    if (!requestingEmployeeId) {
      return err('requestingEmployeeId is required')
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
      return notFound('Shift not found')
    }

    if (shift.status === 'closed') {
      return err('Shift is already closed')
    }

    // ── Auth: own shift needs SHIFT_CLOSE equivalent, other shift needs manager ──
    const isOwnShift = requestingEmployeeId === shift.employeeId
    const requiredPerms = isOwnShift
      ? [PERMISSIONS.POS_CHANGE_SERVER, PERMISSIONS.MGR_TRANSFER_CHECKS]
      : [PERMISSIONS.MGR_TRANSFER_CHECKS, PERMISSIONS.MGR_BULK_OPERATIONS]

    const auth = await requireAnyPermission(requestingEmployeeId, shift.locationId, requiredPerms)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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
      return notFound('Destination employee not found or inactive')
    }

    // ── Self-transfer guard ─────────────────────────────────────────────
    if (shift.employeeId === toEmployeeId) {
      return err('Cannot transfer orders to the same employee')
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
      return err('Destination employee does not have an open shift')
    }

    // ── Bulk transfer in a transaction ──────────────────────────────────
    const result = await db.$transaction(async (tx) => {
      // Find all open orders for the shift employee (already tenant-scoped by locationId)
      // TX-KEEP: COMPLEX — find all open orders for shift employee with custom status filter; no repo method for shift-scoped order queries
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

      // TX-KEEP: BULK — bulk reassign all open orders to new employee by ID array; no batch repo method
      await tx.order.updateMany({
        where: { id: { in: orderIds }, locationId: shift.locationId },
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

    // Push DB changes upstream to Neon (fire-and-forget)
    pushUpstream()

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
      ).catch(err => log.warn({ err }, 'Background task failed'))

      // Single batch socket dispatch for all orders
      void dispatchOpenOrdersChanged(shift.locationId, {
        trigger: 'transferred',
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

      // Dispatch tab updated for each transferred order
      void Promise.all(
        result.orders.map((o) =>
          dispatchTabUpdated(shift.locationId, { orderId: o.id })
        )
      ).catch(err => log.warn({ err }, 'Background task failed'))

      // Notify shift change
      void emitToLocation(shift.locationId, 'shifts:changed', {
        action: 'orders-transferred',
        shiftId,
        fromEmployeeId: shift.employeeId,
        toEmployeeId,
        count: result.transferred,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    const fromName = shift.employee.displayName ||
      `${shift.employee.firstName} ${shift.employee.lastName}`
    const toName = toEmployee.displayName ||
      `${toEmployee.firstName} ${toEmployee.lastName}`

    return ok({
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
      })
  } catch (error) {
    console.error('Failed to bulk transfer orders:', error)
    return err('Failed to transfer orders', 500)
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth-utils'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { calculateSimpleOrderTotals, getLocationTaxRate } from '@/lib/order-calculations'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { reason, notes, managerId, forceReopen } = await request.json()

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

    // Get the order with its payments
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          where: { status: 'completed' },
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            totalAmount: true,
            datacapRecordNo: true,
            cardLast4: true,
          },
        },
      },
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

    // Cooldown guard: prevent immediate reopen after cash payment (race condition)
    if (order.paidAt) {
      const secondsSincePaid = (Date.now() - new Date(order.paidAt).getTime()) / 1000
      if (secondsSincePaid < 60) {
        return NextResponse.json(
          { error: 'Order was recently paid. Wait 60 seconds or use manager override.', requiresManagerApproval: true },
          { status: 403 }
        )
      }
    }

    // W1-P4: Warn about card payments before reopening — prevents accidental double-charge
    const cardPayments = order.payments.filter(
      p => p.paymentMethod === 'credit' || p.paymentMethod === 'debit'
    )
    if (cardPayments.length > 0 && !forceReopen) {
      return NextResponse.json(
        {
          error: 'Order has completed card payments. Reopening will void these payments. Send forceReopen: true to confirm.',
          requiresCardPaymentWarning: true,
          cardPayments: cardPayments.map(p => ({
            id: p.id,
            method: p.paymentMethod,
            amount: Number(p.amount),
            cardLast4: p.cardLast4,
          })),
        },
        { status: 409 }
      )
    }

    // W1-P4: Mark all existing completed payments as voided so the pay route's
    // alreadyPaid calculation starts fresh (old payments were for the previous close).
    if (order.payments.length > 0) {
      await db.payment.updateMany({
        where: {
          orderId,
          status: 'completed',
        },
        data: {
          status: 'voided',
        },
      })
    }

    // W2-R2: Recalculate order totals from active items (payments were voided, totals are stale)
    const activeItems = await db.orderItem.findMany({
      where: {
        orderId,
        deletedAt: null,
        status: { not: 'voided' },
      },
      select: {
        itemTotal: true,
        modifierTotal: true,
        quantity: true,
      },
    })

    const recalcSubtotal = activeItems.reduce(
      (sum, item) => sum + Number(item.itemTotal) + Number(item.modifierTotal || 0),
      0
    )

    // Use canonical order calculation utility for tax + total
    const locationSettings = await db.location.findUnique({
      where: { id: order.locationId },
      select: { settings: true },
    })
    const locSettings = (locationSettings?.settings as Record<string, unknown>) || {}
    const recalcTotals = calculateSimpleOrderTotals(
      recalcSubtotal,
      Number(order.discountTotal) || 0,
      { tax: { defaultRate: ((locSettings?.tax as Record<string, unknown>)?.defaultRate as number) ?? 0 } }
    )

    // Update order to open status
    // Bug 9: Clear paidAt and closedAt so the pay route's alreadyPaid calculation isn't confused
    const reopenedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        status: 'open',
        paidAt: null,
        closedAt: null,
        subtotal: recalcTotals.subtotal,
        taxTotal: recalcTotals.taxTotal,
        total: recalcTotals.total,
        tipTotal: 0,
        reopenedAt: new Date(),
        reopenedBy: managerId,
        reopenReason: reason,
        version: { increment: 1 },
      },
    })

    // Revert table status to occupied if order had a table
    if (order.tableId) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'occupied' },
      })
      invalidateSnapshotCache(order.locationId)
    }

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
          paymentsVoided: order.payments.length,
          cardPaymentsVoided: cardPayments.length,
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    // Dispatch socket events for reopened order (fire-and-forget)
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'reopened',
      orderId,
      tableId: order.tableId || undefined,
    }, { async: true }).catch(() => {})

    // Update floor plan if order had a table (fire-and-forget)
    if (order.tableId) {
      void dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        order: {
          id: reopenedOrder.id,
          orderNumber: reopenedOrder.orderNumber,
          status: reopenedOrder.status,
          reopenedAt: reopenedOrder.reopenedAt,
        },
        paymentsVoided: order.payments.length,
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

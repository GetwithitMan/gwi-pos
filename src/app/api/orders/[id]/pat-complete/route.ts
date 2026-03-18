import { NextRequest, NextResponse } from 'next/server'
import { OrderStatus, TabStatus } from '@/generated/prisma/client'
import { adminDb } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import {
  dispatchOpenOrdersChanged,
  dispatchTabUpdated,
  dispatchTabStatusUpdate,
  dispatchFloorPlanUpdate,
  dispatchPaymentProcessed,
  dispatchOrderClosed,
  dispatchOrderSummaryUpdated,
} from '@/lib/socket-dispatch'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { OrderRepository } from '@/lib/repositories'

// POST /api/orders/[id]/pat-complete
// Called by pay-at-table after all datacap payments complete.
// Body: { employeeId, totalPaid, tipAmount, splits?: [{ amount, tipAmount, authCode, readerId }] }
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const {
      employeeId,
      totalPaid,
      tipAmount = 0,
      splits,
    } = body as {
      employeeId?: string
      totalPaid?: number
      tipAmount?: number
      splits?: Array<{ amount: number; tipAmount?: number; authCode?: string; readerId?: string }>
    }

    // Validate required fields
    if (!employeeId) {
      return NextResponse.json(
        { error: 'Missing required field: employeeId' },
        { status: 400 }
      )
    }
    if (totalPaid === undefined || totalPaid === null) {
      return NextResponse.json(
        { error: 'Missing required field: totalPaid' },
        { status: 400 }
      )
    }

    // Fetch the order -- use getLocationId() to bootstrap locationId, then use repository
    // TODO: pat-complete needs a way to resolve locationId before the order fetch; using db fallback
    const order = await adminDb.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        locationId: true,
        status: true,
        orderType: true,
        tableId: true,
        tipTotal: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId

    // Idempotent: if order already paid, return success silently
    if (order.status === 'paid') {
      return NextResponse.json({ data: { success: true } })
    }

    // Calculate totals from splits if provided, otherwise use body values
    const effectiveTip = splits
      ? splits.reduce((sum, s) => sum + (s.tipAmount ?? 0), 0)
      : (tipAmount ?? 0)

    // Update the order: mark as paid, close tab if applicable
    const updateData: {
      status: OrderStatus
      paidAt: Date
      tipTotal: number
      tabStatus?: TabStatus
    } = {
      status: 'paid' as OrderStatus,
      paidAt: new Date(),
      tipTotal: Number(order.tipTotal) + effectiveTip,
    }

    if (order.orderType === 'bar_tab') {
      updateData.tabStatus = 'closed' as TabStatus
    }

    await OrderRepository.updateOrder(orderId, locationId, updateData)

    // Create Payment records
    // TODO: PaymentRepository.createPayment uses Prisma's connect syntax which differs from
    // the flat locationId/orderId pattern here. Using adminDb.payment.create directly for now.
    if (splits && splits.length > 0) {
      // One Payment per split
      for (const split of splits) {
        await adminDb.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            paymentMethod: 'card',
            amount: split.amount,
            tipAmount: split.tipAmount ?? 0,
            totalAmount: split.amount + (split.tipAmount ?? 0),
            status: 'completed',
            settledAt: new Date(),
            ...(split.authCode ? { authCode: split.authCode } : {}),
            ...(split.readerId ? { paymentReaderId: split.readerId } : {}),
          },
        })
      }
    } else {
      // Single Payment for the full amount
      const baseAmount = totalPaid - (tipAmount ?? 0)
      await adminDb.payment.create({
        data: {
          locationId,
          orderId,
          employeeId,
          paymentMethod: 'card',
          amount: baseAmount,
          tipAmount: tipAmount ?? 0,
          totalAmount: totalPaid,
          status: 'completed',
          settledAt: new Date(),
        },
      })
    }

    // Fire-and-forget socket dispatches to sync all terminals
    dispatchOpenOrdersChanged(
      locationId,
      { trigger: 'paid', orderId, tableId: order.tableId || undefined },
      { async: true }
    ).catch(() => {})

    dispatchTabUpdated(locationId, { orderId, status: 'closed' }).catch(() => {})
    dispatchTabStatusUpdate(locationId, { orderId, status: 'closed' })

    if (order.tableId) {
      dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
    }

    // Dispatch payment:processed for cross-terminal sync (fire-and-forget)
    void dispatchPaymentProcessed(locationId, {
      orderId,
      status: 'completed',
      method: 'card',
      amount: totalPaid - effectiveTip,
      tipAmount: effectiveTip,
      totalAmount: totalPaid,
      isClosed: true,
    }).catch(console.error)

    // Dispatch order:closed for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderClosed(locationId, {
      orderId,
      status: 'paid',
      closedAt: new Date().toISOString(),
      closedByEmployeeId: employeeId || null,
      locationId,
    }, { async: true }).catch(console.error)

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(locationId, {
      orderId,
      orderNumber: 0, // Not available in this select
      status: 'paid',
      tableId: order.tableId || null,
      tableName: null,
      tabName: null,
      guestCount: 0,
      employeeId: null,
      subtotalCents: Math.round((totalPaid - effectiveTip) * 100),
      taxTotalCents: 0,
      discountTotalCents: 0,
      tipTotalCents: Math.round(effectiveTip * 100),
      totalCents: Math.round(totalPaid * 100),
      itemCount: 0,
      updatedAt: new Date().toISOString(),
      locationId,
    }, { async: true }).catch(console.error)

    // Event emission: pay-at-table completed — payment(s) applied + order closed
    const patEvents: Array<{ type: 'PAYMENT_APPLIED' | 'ORDER_CLOSED'; payload: Record<string, unknown> }> = []
    if (splits && splits.length > 0) {
      for (const split of splits) {
        patEvents.push({
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: orderId, // No individual IDs from loop creates
            method: 'card',
            amountCents: Math.round(split.amount * 100),
            tipCents: Math.round((split.tipAmount ?? 0) * 100),
            totalCents: Math.round((split.amount + (split.tipAmount ?? 0)) * 100),
            status: 'completed',
          },
        })
      }
    } else {
      const baseAmount = totalPaid - (tipAmount ?? 0)
      patEvents.push({
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId: orderId,
          method: 'card',
          amountCents: Math.round(baseAmount * 100),
          tipCents: Math.round((tipAmount ?? 0) * 100),
          totalCents: Math.round(totalPaid * 100),
          status: 'completed',
        },
      })
    }
    patEvents.push({
      type: 'ORDER_CLOSED',
      payload: { closedStatus: 'paid', reason: 'Pay-at-table completed' },
    })
    void emitOrderEvents(locationId, orderId, patEvents).catch(console.error)

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[pat-complete] Failed to complete pay-at-table payment:', error)
    return NextResponse.json(
      { error: 'Failed to complete pay-at-table payment' },
      { status: 500 }
    )
  }
})

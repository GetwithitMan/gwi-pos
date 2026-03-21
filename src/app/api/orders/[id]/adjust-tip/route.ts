import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getRequestLocationId } from '@/lib/request-context'

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { paymentId, newTipAmount, reason, managerId } = await request.json()

    // Validate inputs
    if (!paymentId || newTipAmount === undefined || !reason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (newTipAmount < 0) {
      return NextResponse.json(
        { error: 'Tip amount cannot be negative' },
        { status: 400 }
      )
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let locationId = getRequestLocationId()
    if (!locationId) {
      // Lightweight order check for locationId (needed by auth)
      // NOTE: First fetch uses db directly because we don't have locationId yet.
      // Once we have locationId from this order, all subsequent queries use repositories.
      const orderCheck = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      locationId = orderCheck.locationId
    }

    const authResult = await requirePermission(managerId, locationId, PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })
    }

    // Interactive transaction: FOR UPDATE on Payment row prevents concurrent tip adjustments
    const txResult = await db.$transaction(async (tx) => {
      // Acquire row lock on Payment
      await tx.$queryRawUnsafe('SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE', paymentId)

      // Re-read order with payment inside lock
      const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        payments: {
          where: { id: paymentId, deletedAt: null },
        },
      }, tx)

      if (!order) {
        return { error: 'Order not found', status: 404 } as const
      }

      // Status guard: block tip adjustments on voided/cancelled orders
      if (order.status === 'voided' || order.status === 'cancelled') {
        return { error: `Cannot adjust tip on ${order.status} order`, status: 400 } as const
      }

      // Time guard: block tip adjustments more than 24 hours after order close
      if (order.closedAt) {
        const hoursSinceClose = (Date.now() - new Date(order.closedAt).getTime()) / (1000 * 60 * 60)
        if (hoursSinceClose > 24) {
          return { error: 'Cannot adjust tip more than 24 hours after order close', status: 400 } as const
        }
      }

      const payment = order.payments[0]
      if (!payment) {
        return { error: 'Payment not found', status: 404 } as const
      }

      // Gift card guard: cannot increase tip on gift card payments (balance already consumed)
      const isGiftCard = !payment.datacapRecordNo && !payment.paymentReaderId && payment.paymentMethod === 'gift_card';
      if (isGiftCard && newTipAmount > Number(payment.tipAmount || 0)) {
        return { error: 'Cannot increase tip on gift card payment — gift card balance already consumed', status: 400 } as const
      }

      // Tip cap: if baseAmount is 0 or negative (comped/refunded), no tip allowed.
      // 500% cap matches the guard in the pay route (line 534-540).
      // payment.amount IS the base amount (food + tax, excluding tip); tip is stored separately in tipAmount
      const baseAmount = Number(payment.amount)
      const maxTip = baseAmount > 0 ? baseAmount * 5 : 0
      if (newTipAmount > maxTip) {
        return {
          error: `Tip amount $${newTipAmount.toFixed(2)} exceeds the maximum allowed for this payment`,
          status: 400,
        } as const
      }

      // If card payment: adjust gratuity on the Datacap reader before updating DB
      if (payment.datacapRecordNo && payment.paymentReaderId) {
        try {
          const datacapClient = await requireDatacapClient(order.locationId)
          const datacapResponse = await datacapClient.adjustGratuity(payment.paymentReaderId, {
            recordNo: payment.datacapRecordNo,
            purchaseAmount: Number(payment.amount),
            gratuityAmount: newTipAmount,
          })
          const datacapError = parseError(datacapResponse)
          if (datacapError || datacapResponse.cmdStatus !== 'Approved') {
            return {
              error: datacapError?.text ?? 'Datacap declined the tip adjustment',
              status: 422,
            } as const
          }
        } catch (datacapErr) {
          console.error('Datacap adjustGratuity failed:', datacapErr)
          return { error: 'Could not reach card reader to adjust tip', status: 503 } as const
        }
      }

      const oldTipAmount = Number(payment.tipAmount)

      // Calculate new total
      const newTotalAmount = Number(payment.amount) + newTipAmount

      // Update payment
      await PaymentRepository.updatePayment(paymentId, locationId, {
        tipAmount: newTipAmount,
        totalAmount: newTotalAmount,
        lastMutatedBy: 'local',
      }, tx)
      const updatedPayment = await PaymentRepository.getPaymentByIdOrThrow(paymentId, locationId, tx)

      // Update order tip total
      const allPayments = await PaymentRepository.getPaymentsForOrderByStatus(orderId, locationId, ['completed', 'refunded', 'pending'], tx)

      const newOrderTipTotal = allPayments.reduce(
        (sum, p) => sum + Number(p.tipAmount),
        0
      )

      // Bug 15: Recalculate Order.total to include new tip total
      const newOrderTotal = roundToCents(Number(order.subtotal) + Number(order.taxFromExclusive || 0) - Number(order.discountTotal) + newOrderTipTotal)

      await OrderRepository.updateOrder(orderId, locationId, {
        tipTotal: newOrderTipTotal,
        total: newOrderTotal,
        version: { increment: 1 },
        lastMutatedBy: 'local',
      }, tx)

      return { order, payment, updatedPayment, oldTipAmount, newTotalAmount, newOrderTipTotal, newOrderTotal }
    }, { timeout: 30000 })

    // Handle early-return errors from inside the transaction
    if ('error' in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status })
    }

    const { order, payment, updatedPayment, oldTipAmount, newTotalAmount, newOrderTipTotal, newOrderTotal } = txResult

    // If this is a split child, also update parent's tipTotal
    if (order.parentOrderId) {
      try {
        await db.$transaction(async (tx) => {
          const parentPayments = await tx.payment.findMany({
            where: {
              order: { OR: [{ id: order.parentOrderId! }, { parentOrderId: order.parentOrderId! }] },
              deletedAt: null,
              status: 'completed',
            },
            select: { tipAmount: true },
          })
          const parentTipTotal = parentPayments.reduce((sum, p) => sum + Number(p.tipAmount), 0)
          await tx.order.update({
            where: { id: order.parentOrderId! },
            data: { tipTotal: parentTipTotal },
          })
        })
      } catch (err) {
        console.error('[adjust-tip] Failed to update parent order tipTotal:', err)
      }
    }

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: newOrderTipTotal,
      discountTotal: Number(order.discountTotal),
      total: newOrderTotal,
      commissionTotal: Number(order.commissionTotal || 0),
    }, { async: true }).catch(() => {})

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(Number(order.subtotal) * 100),
      taxTotalCents: Math.round(Number(order.taxTotal) * 100),
      discountTotalCents: Math.round(Number(order.discountTotal) * 100),
      tipTotalCents: Math.round(newOrderTipTotal * 100),
      totalCents: Math.round(newOrderTotal * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(() => {})

    // Dispatch open orders changed for cross-terminal awareness (fire-and-forget)
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'payment_updated', orderId }).catch(console.error)

    // Queue outage writes if Neon is unreachable — read back full rows to
    // avoid NOT NULL constraint violations on replay (partial payloads are unsafe)
    if (isInOutageMode()) {
      const fullPayment = await PaymentRepository.getPaymentById(payment.id, order.locationId)
      if (fullPayment) {
        void queueOutageWrite('Payment', fullPayment.id, 'UPDATE', fullPayment as unknown as Record<string, unknown>, order.locationId).catch(console.error)
      }
      const fullOrder = await OrderRepository.getOrderById(orderId, order.locationId)
      if (fullOrder) {
        void queueOutageWrite('Order', orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>, order.locationId).catch(console.error)
      }
    }

    // Emit order event for tip adjustment (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'PAYMENT_APPLIED', {
      paymentId: payment.id,
      method: payment.paymentMethod,
      amountCents: Math.round(Number(payment.amount) * 100),
      tipCents: Math.round(newTipAmount * 100),
      totalCents: Math.round(newTotalAmount * 100),
      cardBrand: payment.cardBrand || null,
      cardLast4: payment.cardLast4 || null,
      status: payment.status,
    })

    // Bug 2: Trigger tip allocation for the adjusted tip amount (fire-and-forget)
    if (newTipAmount > 0 && order.employeeId) {
      const settings = await getLocationSettings(order.locationId)
      const locSettings = parseSettings(settings)
      void allocateTipsForPayment({
        locationId: order.locationId,
        orderId,
        primaryEmployeeId: order.employeeId,
        createdPayments: [{ id: payment.id, paymentMethod: payment.paymentMethod, tipAmount: newTipAmount }],
        totalTipsDollars: newTipAmount,
        tipBankSettings: locSettings.tipBank,
      }).catch(err => {
        console.error('Background tip allocation failed (adjust-tip):', err)
      })
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: managerId,
        action: 'tip_adjusted',
        entityType: 'payment',
        entityId: paymentId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          paymentId,
          oldTipAmount,
          newTipAmount,
          difference: newTipAmount - oldTipAmount,
          reason,
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    return NextResponse.json({
      data: {
        payment: {
          id: updatedPayment.id,
          tipAmount: Number(updatedPayment.tipAmount),
          totalAmount: Number(updatedPayment.totalAmount),
        },
        oldTipAmount,
        newTipAmount,
      },
    })
  } catch (error) {
    console.error('Failed to adjust tip:', error)
    return NextResponse.json(
      { error: 'Failed to adjust tip' },
      { status: 500 }
    )
  }
})

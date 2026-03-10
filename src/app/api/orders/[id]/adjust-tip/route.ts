import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'

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

    // Lightweight order check for locationId (needed by auth)
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

    const authResult = await requirePermission(managerId, orderCheck.locationId, PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })
    }

    // Interactive transaction: FOR UPDATE on Payment row prevents concurrent tip adjustments
    const txResult = await db.$transaction(async (tx) => {
      // Acquire row lock on Payment
      await tx.$queryRawUnsafe('SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE', paymentId)

      // Re-read order with payment inside lock
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          payments: {
            where: { id: paymentId, deletedAt: null },
          },
        },
      })

      if (!order) {
        return { error: 'Order not found', status: 404 } as const
      }

      // Status guard: block tip adjustments on voided/cancelled orders
      if (order.status === 'voided' || order.status === 'cancelled') {
        return { error: `Cannot adjust tip on ${order.status} order`, status: 400 } as const
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

      // Tip cap: if baseAmount is 0 or negative (comped/refunded), no tip allowed
      // payment.amount IS the base amount (food + tax, excluding tip); tip is stored separately in tipAmount
      const baseAmount = Number(payment.amount)
      const maxTip = baseAmount > 0 ? baseAmount : 0
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
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          tipAmount: newTipAmount,
          totalAmount: newTotalAmount,
          lastMutatedBy: 'local',
        },
      })

      // Update order tip total
      const allPayments = await tx.payment.findMany({
        where: {
          orderId,
          deletedAt: null,
          status: { not: 'voided' },
        },
      })

      const newOrderTipTotal = allPayments.reduce(
        (sum, p) => sum + Number(p.tipAmount),
        0
      )

      // Bug 15: Recalculate Order.total to include new tip total
      const newOrderTotal = roundToCents(Number(order.subtotal) + Number(order.taxTotal) - Number(order.discountTotal) + newOrderTipTotal)

      await tx.order.update({
        where: { id: orderId },
        data: {
          tipTotal: newOrderTipTotal,
          total: newOrderTotal,
          version: { increment: 1 },
          lastMutatedBy: 'local',
        },
      })

      return { order, payment, updatedPayment, oldTipAmount, newTotalAmount, newOrderTipTotal, newOrderTotal }
    }, { timeout: 30000 })

    // Handle early-return errors from inside the transaction
    if ('error' in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status })
    }

    const { order, payment, updatedPayment, oldTipAmount, newTotalAmount, newOrderTipTotal, newOrderTotal } = txResult

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

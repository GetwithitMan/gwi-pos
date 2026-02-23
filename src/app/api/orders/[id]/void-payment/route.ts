import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth-utils'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { dispatchPaymentProcessed, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'

/**
 * Voids a payment — handles both Datacap (card) and DB in a single atomic flow.
 *
 * For card payments:
 *   1. Calls Datacap voidSale to reverse the charge at the processor
 *   2. If Datacap succeeds, updates the DB
 *   3. If Datacap fails, returns error without modifying DB
 *   4. If Datacap succeeds but DB fails, logs a CRITICAL safety warning
 *
 * For cash payments:
 *   Skips Datacap and directly updates the DB.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { paymentId, reason, notes, managerId, readerId } = await request.json()

    // Validate inputs
    if (!paymentId || !reason || !managerId) {
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
    if (!hasPermission(permissions, 'manager.void_payments')) {
      return NextResponse.json({ error: 'Insufficient permissions to void payments' }, { status: 403 })
    }

    // Get the order with payment
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          where: { deletedAt: null },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Bug 14: Block voiding payments on closed/cancelled orders
    if (order.status === 'closed' || order.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Cannot void payments on a closed/cancelled order' },
        { status: 400 }
      )
    }

    const payment = order.payments.find((p) => p.id === paymentId)
    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    if (payment.status === 'voided') {
      return NextResponse.json(
        { error: 'Payment is already voided' },
        { status: 400 }
      )
    }

    // Step 1: If card payment, void at Datacap first
    const isCardPayment = payment.paymentMethod === 'card' || payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'
    if (isCardPayment) {
      const recordNo = payment.datacapRecordNo

      if (!recordNo) {
        return NextResponse.json(
          { error: 'Cannot void card payment: missing transaction record number. Void manually via Datacap portal.' },
          { status: 400 }
        )
      }

      // Determine which reader to use: caller-provided or from payment record
      const effectiveReaderId = readerId || payment.paymentReaderId

      if (!effectiveReaderId) {
        return NextResponse.json(
          { error: 'Cannot void card payment: no payment reader available. Void manually via Datacap portal.' },
          { status: 400 }
        )
      }

      try {
        const client = await requireDatacapClient(order.locationId)
        const datacapResponse = await client.voidSale(effectiveReaderId, { recordNo })
        const datacapError = parseError(datacapResponse)

        if (datacapResponse.cmdStatus !== 'Approved' || datacapError) {
          return NextResponse.json(
            { error: `Datacap void failed: ${datacapError?.text || datacapResponse.textResponse || 'Unknown error'}. DB not modified.` },
            { status: 502 }
          )
        }
      } catch (datacapErr) {
        const msg = datacapErr instanceof Error ? datacapErr.message : 'Datacap void request failed'
        return NextResponse.json(
          { error: `Datacap void failed: ${msg}. DB not modified.` },
          { status: 502 }
        )
      }
    }

    // Step 2: Datacap succeeded (or cash) — update DB
    // Check if there are other valid payments
    const activePayments = order.payments.filter(
      (p) => p.id !== paymentId && p.status !== 'voided'
    )

    // Update order status if needed
    let newOrderStatus = order.status
    if (activePayments.length === 0) {
      // No more active payments, mark order as voided
      newOrderStatus = 'voided'
    }

    let voidedPayment
    try {
      // Wrap all critical writes in a single transaction
      voidedPayment = await db.$transaction(async (tx) => {
        // 1. Update payment to voided
        const updated = await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: 'voided',
            voidedAt: new Date(),
            voidedBy: managerId,
            voidReason: reason,
          },
        })

        // 2. Update order status
        await tx.order.update({
          where: { id: orderId },
          data: {
            status: newOrderStatus,
          },
        })

        // 3. Create audit log
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId: managerId,
            action: 'payment_voided',
            entityType: 'payment',
            entityId: paymentId,
            details: {
              orderId,
              orderNumber: order.orderNumber,
              paymentId,
              amount: Number(payment.amount),
              tipAmount: Number(payment.tipAmount),
              totalAmount: Number(payment.totalAmount),
              paymentMethod: payment.paymentMethod,
              reason,
              notes: notes || null,
              oldOrderStatus: order.status,
              newOrderStatus,
            },
            ipAddress: request.headers.get('x-forwarded-for'),
            userAgent: request.headers.get('user-agent'),
          },
        })

        return updated
      })
    } catch (dbError) {
      // CRITICAL: Datacap voided but DB update failed
      if (isCardPayment) {
        console.error(
          `[PAYMENT-SAFETY] CRITICAL: Datacap voided but DB update failed. ` +
          `orderId=${orderId}, paymentId=${paymentId}, amount=${Number(payment.totalAmount)}, ` +
          `method=${payment.paymentMethod}, reason=${reason}. ` +
          `Reconcile manually via Datacap portal.`,
          dbError
        )

        // Bug 7: Still attempt tip chargeback even when DB update failed — the Datacap
        // void succeeded so the customer won't be charged. Best effort.
        if (Number(payment.tipAmount) > 0) {
          void handleTipChargeback({
            locationId: order.locationId,
            paymentId,
            memo: `Payment voided (DB failure path): ${reason}`,
          }).catch(err => {
            console.error(
              `[PAYMENT-SAFETY] CRITICAL: Tip chargeback also failed after DB failure. ` +
              `Manual reconciliation needed. paymentId=${paymentId}`,
              err
            )
          })
        }
      }
      throw dbError
    }

    // Dispatch socket events for voided payment (fire-and-forget)
    void dispatchPaymentProcessed(order.locationId, {
      orderId,
      paymentId,
      status: 'voided',
    }).catch(() => {})
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      discountTotal: Number(order.discountTotal),
      total: Number(order.total),
    }, { async: true }).catch(() => {})

    // Reverse tip allocations for this voided payment (fire-and-forget)
    // The chargeback policy (BUSINESS_ABSORBS vs EMPLOYEE_CHARGEBACK) is
    // determined by location settings automatically.
    if (Number(payment.tipAmount) > 0) {
      handleTipChargeback({
        locationId: order.locationId,
        paymentId,
        memo: `Payment voided: ${reason}`,
      }).catch((err) => {
        // If no TipTransaction exists for this payment (e.g., cash payment with no
        // tip allocation, or legacy payment), this is expected. Log but don't fail.
        console.warn('[void-payment] Tip chargeback skipped or failed:', err.message)
      })
    }

    return NextResponse.json({
      data: {
        voidedPayment: {
          id: voidedPayment.id,
          status: voidedPayment.status,
          voidedAt: voidedPayment.voidedAt,
        },
        order: {
          id: order.id,
          status: newOrderStatus,
        },
        refundAmount: Number(payment.totalAmount),
      },
    })
  } catch (error) {
    console.error('Failed to void payment:', error)
    return NextResponse.json(
      { error: 'Failed to void payment' },
      { status: 500 }
    )
  }
})

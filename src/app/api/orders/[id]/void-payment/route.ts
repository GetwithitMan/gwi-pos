import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { dispatchPaymentProcessed, dispatchOrderTotalsUpdate, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { restoreInventoryForOrder } from '@/lib/inventory/void-waste'
import { enableSyncReplication } from '@/lib/db-helpers'
import { dispatchAlert } from '@/lib/alert-service'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'

class VoidValidationError extends Error {
  statusCode: number
  constructor(message: string, statusCode: number) {
    super(message)
    this.statusCode = statusCode
  }
}

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

    // Lightweight order check before acquiring locks (for locationId needed by auth)
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

    // Verify manager has permission scoped to order's location
    const authResult = await requirePermission(managerId, orderCheck.locationId, PERMISSIONS.MGR_VOID_PAYMENTS)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })
    }

    // Phase 1: Read order + validate under FOR UPDATE lock on Order row.
    // This contends with pay/route.ts which also holds FOR UPDATE on Order.
    const lockedRead = await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)

      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          payments: {
            where: { deletedAt: null },
          },
        },
      })

      if (!order) {
        return { error: 'Order not found', status: 404 } as const
      }

      if (order.status === 'voided' || order.status === 'cancelled') {
        return { error: `Cannot void payment on ${order.status} order`, status: 400 } as const
      }

      const payment = order.payments.find((p) => p.id === paymentId)
      if (!payment) {
        return { error: 'Payment not found', status: 404 } as const
      }

      if (payment.status === 'voided') {
        return { error: 'Payment is already voided', status: 400 } as const
      }

      return { order, payment }
    }, { timeout: 15000 })

    if ('error' in lockedRead) {
      return NextResponse.json({ error: lockedRead.error }, { status: lockedRead.status })
    }

    const { order, payment } = lockedRead

    // Step 1: If card payment, void at Datacap first (outside DB transaction)
    const isCardPayment = payment.paymentMethod === 'card' || payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'
    if (isCardPayment) {
      const recordNo = payment.datacapRecordNo

      if (!recordNo) {
        return NextResponse.json(
          { error: 'Cannot void card payment: missing transaction record number. Void manually via Datacap portal.' },
          { status: 400 }
        )
      }

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
    const activePayments = order.payments.filter(
      (p) => p.id !== paymentId && p.status !== 'voided'
    )

    let newOrderStatus = order.status
    if (activePayments.length === 0) {
      newOrderStatus = 'voided'
    }

    let voidedPayment
    try {
      voidedPayment = await db.$transaction(async (tx) => {
        // Acquire row locks on Order + Payment + synchronous replication for void durability
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', orderId)
        await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
        await enableSyncReplication(tx)

        // Re-check payment status inside lock (may have changed since Phase 1)
        const freshPayment = await tx.payment.findUnique({ where: { id: paymentId } })
        if (freshPayment?.status === 'voided') {
          throw new VoidValidationError('Payment is already voided', 400)
        }

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
      if (dbError instanceof VoidValidationError) {
        return NextResponse.json({ error: dbError.message }, { status: dbError.statusCode })
      }
      // CRITICAL: Datacap voided but DB update failed
      if (isCardPayment) {
        const recordNo = payment.datacapRecordNo
        const criticalMsg =
          `[PAYMENT-SAFETY] CRITICAL: Datacap voided but DB update failed. ` +
          `orderId=${orderId}, paymentId=${paymentId}, recordNo=${recordNo}, ` +
          `amount=${Number(payment.totalAmount)}, ` +
          `method=${payment.paymentMethod}, reason=${reason}. ` +
          `Reconcile manually via Datacap portal.`
        console.error(criticalMsg, dbError)

        // Report to Sentry if available
        try {
          const Sentry = await import('@sentry/nextjs')
          Sentry.captureException(dbError, {
            tags: { handler: 'void-payment-db-failure', paymentId, orderId },
            extra: { recordNo, amount: Number(payment.totalAmount), method: payment.paymentMethod },
          })
        } catch {
          // Sentry not available — already logged above
        }

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

        // Do NOT re-throw — return error response so the client can warn the manager
        return NextResponse.json(
          {
            error: `CRITICAL: Card voided at processor but database update failed. Record number: ${recordNo}. Manual reconciliation required.`,
            critical: true,
            recordNo,
            paymentId,
          },
          { status: 500 }
        )
      }
      throw dbError
    }

    // Emit order event for voided payment (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'PAYMENT_VOIDED', {
      paymentId: payment.id,
      reason: reason || null,
      employeeId: managerId || null,
    })

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

    // Release the table when the full order is voided (C12: prevent zombie tables)
    if (newOrderStatus === 'voided' && order.tableId) {
      await db.table.update({ where: { id: order.tableId }, data: { status: 'available' } })
      void dispatchFloorPlanUpdate(order.locationId).catch(console.error)
    }

    // Restore inventory deductions when ALL payments on the order are voided.
    // The original sale deductions from deductInventoryForOrder() are reversed
    // so stock levels reflect the fully-reversed sale.
    // Inventory restore is best-effort — payment void takes priority
    if (newOrderStatus === 'voided') {
      try {
        await restoreInventoryForOrder(orderId, order.locationId)
      } catch (err) {
        console.error('[VOID] Inventory restoration failed — manual stock adjustment may be needed:', err)
      }
    }

    // Alert dispatch: notify if void exceeds threshold (fire-and-forget)
    void (async () => {
      try {
        const locSettings = parseSettings(await getLocationSettings(order.locationId))
        if (!locSettings.alerts.enabled) return
        const voidAmount = Number(payment.totalAmount)
        if (voidAmount < locSettings.alerts.largeVoidThreshold) return

        // Resolve manager name for the alert message
        const manager = await db.employee.findUnique({
          where: { id: managerId },
          select: { firstName: true, lastName: true, displayName: true },
        })
        const managerName = manager?.displayName || `${manager?.firstName ?? ''} ${manager?.lastName ?? ''}`.trim() || 'Unknown'

        void dispatchAlert({
          severity: 'HIGH',
          errorType: 'void_processed',
          category: 'transaction',
          message: `Void processed: Order #${order.orderNumber} - $${voidAmount.toFixed(2)} by ${managerName}`,
          locationId: order.locationId,
          employeeId: managerId,
          orderId,
          paymentId,
          groupId: `void-${order.locationId}-${orderId}`,
        }).catch(console.error)
      } catch (err) {
        console.error('[void-payment] Alert dispatch failed:', err)
      }
    })()

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

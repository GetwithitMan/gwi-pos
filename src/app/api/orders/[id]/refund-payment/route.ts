import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { restoreInventoryForOrder } from '@/lib/inventory/void-waste'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { paymentId, refundAmount, refundReason, notes, managerId, readerId, remoteApprovalCode, approvedById } =
      await request.json()

    // Validate required fields
    if (!paymentId || refundAmount === undefined || refundAmount === null || !refundReason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Fetch order (unlocked — lightweight check before acquiring lock)
    const order = await db.order.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true, locationId: true, orderNumber: true, status: true, deletedAt: true,
        tableId: true, tabName: true, guestCount: true, employeeId: true, itemCount: true,
        subtotal: true, taxTotal: true, tipTotal: true, discountTotal: true, total: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Validate refund amount (cheap check before lock)
    if (refundAmount <= 0) {
      return NextResponse.json(
        { error: 'Refund amount must be greater than 0' },
        { status: 400 }
      )
    }

    // Verify manager has permission to issue refunds
    const authResult = await requirePermission(managerId, order.locationId, PERMISSIONS.MGR_REFUNDS)
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })

    // W5-11: 2FA enforcement for large refunds
    const locationSettings = parseSettings(await getLocationSettings(order.locationId))
    const securitySettings = locationSettings.security
    if (securitySettings.require2FAForLargeRefunds && refundAmount > securitySettings.refund2FAThreshold) {
      if (!remoteApprovalCode && !approvedById) {
        return NextResponse.json(
          { error: `Manager approval required for refund over $${securitySettings.refund2FAThreshold}`, requiresApproval: true },
          { status: 403 }
        )
      }
    }

    // Interactive transaction: FOR UPDATE on Payment row prevents concurrent over-refund
    const txResult = await db.$transaction(async (tx) => {
      // Acquire row lock on Payment
      await tx.$queryRawUnsafe('SELECT id FROM "Payment" WHERE id = $1 FOR UPDATE', paymentId)

      // Re-read payment inside lock
      const payment = await tx.payment.findFirst({
        where: { id: paymentId, orderId: id, deletedAt: null },
      })

      if (!payment) {
        return { error: 'Payment not found', status: 404 } as const
      }

      if (payment.status === 'voided') {
        return { error: 'Cannot refund a voided payment', status: 400 } as const
      }

      if (payment.status === 'refunded') {
        return { error: 'Payment has already been fully refunded', status: 400 } as const
      }

      if (refundAmount > Number(payment.amount)) {
        return { error: 'Refund amount exceeds payment amount', status: 400 } as const
      }

      // Check cumulative refunds inside lock
      const existingRefunds = await tx.refundLog.aggregate({
        where: { paymentId },
        _sum: { refundAmount: true },
      })
      const totalAlreadyRefunded = Number(existingRefunds._sum.refundAmount ?? 0)
      if (totalAlreadyRefunded + refundAmount > Number(payment.amount)) {
        return {
          error: `Refund amount exceeds remaining refundable balance. Already refunded: $${totalAlreadyRefunded.toFixed(2)}, remaining: $${(Number(payment.amount) - totalAlreadyRefunded).toFixed(2)}`,
          status: 400,
        } as const
      }

      // Process Datacap refund for card payments (idempotent at processor)
      let datacapRefNo: string | null = null

      const isCardPayment =
        payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'

      const effectiveReaderId = readerId ?? payment.paymentReaderId ?? null
      if (isCardPayment && effectiveReaderId && payment.datacapRecordNo) {
        await validateReader(effectiveReaderId, order.locationId)
        const client = await requireDatacapClient(order.locationId)

        const response = await client.emvReturn(effectiveReaderId, {
          recordNo: payment.datacapRecordNo,
          invoiceNo: order.orderNumber?.toString() ?? id,
          amount: refundAmount,
          cardPresent: false,
        })

        const approved = response.cmdStatus === 'Approved'

        if (!approved) {
          return { error: response.textResponse || 'Refund declined', status: 422 } as const
        }

        datacapRefNo = response.refNo ?? null
      }

      const isPartial = refundAmount < Number(payment.amount)

      // Update payment status
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: isPartial ? 'completed' : 'refunded',
          refundedAt: new Date(),
          refundedAmount: totalAlreadyRefunded + refundAmount,
          lastMutatedBy: 'local',
        },
      })

      // Create RefundLog
      const refundLog = await tx.refundLog.create({
        data: {
          locationId: order.locationId,
          orderId: id,
          paymentId,
          employeeId: managerId,
          refundAmount,
          originalAmount: Number(payment.amount),
          refundReason,
          notes: notes ?? null,
          datacapRecordNo: payment.datacapRecordNo ?? null,
          datacapRefNo: datacapRefNo ?? null,
          approvedById: managerId,
          approvedAt: new Date(),
        },
      })

      // Create AuditLog
      await tx.auditLog.create({
        data: {
          locationId: order.locationId,
          action: 'payment_refunded',
          employeeId: managerId,
          details: JSON.stringify({
            paymentId,
            refundAmount,
            originalAmount: Number(payment.amount),
            refundReason,
            isPartial,
          }),
        },
      })

      return { refundLog, isPartial, totalAlreadyRefunded, payment }
    }, { timeout: 30000 })

    // Handle early-return errors from inside the transaction
    if ('error' in txResult) {
      return NextResponse.json({ error: txResult.error }, { status: txResult.status })
    }

    const { refundLog, isPartial, totalAlreadyRefunded, payment } = txResult

    // Emit PAYMENT_VOIDED event (fire-and-forget)
    void emitOrderEvent(order.locationId, id, 'PAYMENT_VOIDED', {
      paymentId,
      reason: refundReason,
      employeeId: managerId,
    })

    // Dispatch socket events for cross-terminal sync (fire-and-forget)
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'payment_updated',
      orderId: id,
      tableId: order.tableId || undefined,
    }, { async: true }).catch(console.error)

    void dispatchOrderTotalsUpdate(order.locationId, id, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      discountTotal: Number(order.discountTotal),
      total: Number(order.total),
    }, { async: true }).catch(console.error)

    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: id,
      orderNumber: order.orderNumber ?? 0,
      status: order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(Number(order.subtotal) * 100),
      taxTotalCents: Math.round(Number(order.taxTotal) * 100),
      discountTotalCents: Math.round(Number(order.discountTotal) * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(Number(order.total) * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(console.error)

    // Queue outage write if Neon is unreachable (fire-and-forget)
    if (isInOutageMode()) {
      void queueOutageWrite('Payment', paymentId, 'UPDATE', {
        id: paymentId,
        status: isPartial ? 'completed' : 'refunded',
        refundedAmount: totalAlreadyRefunded + refundAmount,
      }, order.locationId).catch(console.error)
    }

    // Bug 8 + C5 fix: Proportional tip reduction on partial/full refund (fire-and-forget)
    // Uses FOR UPDATE lock to prevent concurrent refund races on stale tip/amount values
    void (async () => {
      try {
        const tipReductionResult = await db.$transaction(async (tx) => {
          // Lock the payment row to prevent concurrent refund races
          await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
          const freshPayment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } })

          const paymentTipAmount = Number(freshPayment.tipAmount)
          const paymentOriginalAmount = Number(freshPayment.amount)

          if (paymentTipAmount <= 0 || paymentOriginalAmount <= 0) {
            return null // No tip to reduce
          }

          // Check cumulative refunds inside the lock to prevent over-refund of tip
          const cumulativeRefunds = await tx.refundLog.aggregate({
            where: { paymentId },
            _sum: { refundAmount: true },
          })
          const totalRefunded = Number(cumulativeRefunds._sum.refundAmount ?? 0)
          if (totalRefunded > paymentOriginalAmount) {
            return null // Over-refund guard
          }

          const tipReduction = Math.round(paymentTipAmount * (refundAmount / paymentOriginalAmount) * 100) / 100
          if (tipReduction <= 0) {
            return null
          }

          // Update Payment.tipAmount and totalAmount with fresh locked values
          const newTipAmount = Math.max(0, paymentTipAmount - tipReduction)
          await tx.payment.update({
            where: { id: paymentId },
            data: {
              tipAmount: newTipAmount,
              totalAmount: Number(freshPayment.amount) - totalRefunded + newTipAmount,
              lastMutatedBy: 'local',
            },
          })

          // Update Order.tipTotal from all non-voided payments (inside lock)
          const allPayments = await tx.payment.findMany({
            where: { orderId: id, deletedAt: null, status: { not: 'voided' } },
          })
          const newOrderTipTotal = allPayments.reduce((sum, p) => sum + Number(p.tipAmount), 0)
          await tx.order.update({
            where: { id },
            data: { tipTotal: newOrderTipTotal, lastMutatedBy: 'local' },
          })

          return { tipReduction, newOrderTipTotal }
        }, { timeout: 15000 })

        if (tipReductionResult) {
          // Fire-and-forget event emission for tip update
          void emitOrderEvent(order.locationId, id, 'ORDER_METADATA_UPDATED', {
            tipTotalCents: Math.round(tipReductionResult.newOrderTipTotal * 100),
          }).catch(console.error)

          // Trigger tip chargeback for the proportional amount
          void handleTipChargeback({
            locationId: order.locationId,
            paymentId,
            memo: `Partial refund ($${refundAmount.toFixed(2)}): proportional tip reduction of $${tipReductionResult.tipReduction.toFixed(2)}`,
          }).catch(err => {
            console.warn('[refund-payment] Tip chargeback skipped or failed:', err.message)
          })
        }
      } catch (err) {
        console.error('[refund-payment] Failed to adjust tip proportionally:', err)
      }
    })()

    // Restore inventory deductions when a FULL refund leaves no active payments.
    // Check all payments on the order: if every one is now voided or fully refunded,
    // the sale is fully reversed and stock should be restored. Fire-and-forget.
    if (!isPartial) {
      void (async () => {
        try {
          const allPayments = await db.payment.findMany({
            where: { orderId: id, deletedAt: null },
            select: { id: true, status: true },
          })
          const hasActivePayments = allPayments.some(
            (p) => p.status !== 'voided' && p.status !== 'refunded'
          )
          if (!hasActivePayments) {
            await restoreInventoryForOrder(id, order.locationId)
          }
        } catch (err) {
          console.error('[refund-payment] Failed to restore inventory:', err)
        }
      })()
    }

    return NextResponse.json({
      data: {
        refundLog: {
          id: refundLog.id,
          refundAmount: Number(refundLog.refundAmount),
          refundReason: refundLog.refundReason,
          createdAt: refundLog.createdAt,
        },
        isPartial,
      },
    })
  } catch (error) {
    console.error('Failed to refund payment:', error)
    return NextResponse.json(
      { error: 'Failed to refund payment' },
      { status: 500 }
    )
  }
})

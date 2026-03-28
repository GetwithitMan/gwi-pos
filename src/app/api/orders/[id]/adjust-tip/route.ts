import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated, dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { postToTipLedger, dollarsToCents } from '@/lib/domain/tips/tip-ledger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { withAuth, type AuthenticatedContext } from '@/lib/api-auth-middleware'
import { PERMISSIONS } from '@/lib/auth-utils'
import { roundToCents } from '@/lib/pricing'
import { isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream, queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { getRequestLocationId } from '@/lib/request-context'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-adjust-tip')

export const PATCH = withVenue(withAuth({ allowCellular: true }, async function PATCH(
  request: NextRequest,
  ctx: AuthenticatedContext
) {
  try {
    const { id: orderId } = await ctx.params
    const { paymentId, newTipAmount, reason, managerId } = await request.json()

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularTip = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularTip ? 'cloud' : 'local'

    // Validate inputs
    if (!paymentId || newTipAmount === undefined || !reason || !managerId) {
      return err('Missing required fields')
    }

    if (newTipAmount < 0) {
      return err('Tip amount cannot be negative')
    }

    // Fast path: locationId from auth context or request context. Fallback: bootstrap from DB.
    let locationId = ctx.auth.locationId || getRequestLocationId()
    if (!locationId) {
      // Lightweight order check for locationId (needed by auth)
      // NOTE: First fetch uses db directly because we don't have locationId yet.
      // Once we have locationId from this order, all subsequent queries use repositories.
      const orderCheck = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return notFound('Order not found')
      }
      locationId = orderCheck.locationId
    }

    // SECURITY: The manager (approver) ID comes from the body, but their permission
    // is verified server-side via requirePermission which checks their PIN/role in DB.
    // The caller must be authenticated (withAuth above ensures this).
    const authResult = await requirePermission(managerId, locationId, PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS)
    if (!authResult.authorized) {
      return err(authResult.error, authResult.status ?? 403)
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
        lastMutatedBy: mutationOrigin,
      }, tx)
      const updatedPayment = await PaymentRepository.getPaymentByIdOrThrow(paymentId, locationId, tx)

      // Update order tip total
      const allPayments = await PaymentRepository.getPaymentsForOrderByStatus(orderId, locationId, ['completed', 'refunded', 'pending'], tx)

      const newOrderTipTotal = allPayments.reduce(
        (sum, p) => sum + Number(p.tipAmount),
        0
      )

      // Bug 15: Recalculate Order.total to include new tip total
      const newOrderTotal = roundToCents(Number(order.subtotal) + Number(order.taxTotal) - Number(order.discountTotal) + newOrderTipTotal + Number(order.donationAmount || 0) + Number(order.convenienceFee || 0))

      await OrderRepository.updateOrder(orderId, locationId, {
        tipTotal: newOrderTipTotal,
        total: newOrderTotal,
        version: { increment: 1 },
        lastMutatedBy: mutationOrigin,
      }, tx)

      return { order, payment, updatedPayment, oldTipAmount, newTotalAmount, newOrderTipTotal, newOrderTotal }
    }, { timeout: 30000 })

    // Handle early-return errors from inside the transaction
    if ('error' in txResult) {
      return err(txResult.error!, txResult.status)
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
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.adjust-tip'))
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
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.adjust-tip'))
    void dispatchOpenOrdersChanged(order.locationId, { trigger: 'payment_updated', orderId }).catch(err => log.warn({ err }, 'Background task failed'))
    // Read back full rows to avoid NOT NULL constraint violations on replay (partial payloads are unsafe)
    if (isInOutageMode()) {
      try {
        const fullPayment = await PaymentRepository.getPaymentById(payment.id, order.locationId)
        if (fullPayment) {
          await queueIfOutageOrFail('Payment', order.locationId, fullPayment.id, 'UPDATE', fullPayment as unknown as Record<string, unknown>)
        }
        const fullOrder = await OrderRepository.getOrderById(orderId, order.locationId)
        if (fullOrder) {
          await queueIfOutageOrFail('Order', order.locationId, orderId, 'UPDATE', fullOrder as unknown as Record<string, unknown>)
        }
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return NextResponse.json(
            { error: 'Tip adjusted but outage queue is full — manual reconciliation required', critical: true },
            { status: 507 }
          )
        }
        throw err
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

    // Tip ledger delta adjustment: find existing TipTransaction and post a
    // CREDIT or DEBIT for the difference. TipLedgerEntry records are IMMUTABLE
    // (INVARIANT-6) — we never update existing entries, only create new ones.
    void (async () => {
      try {
        const deltaDollars = newTipAmount - oldTipAmount
        if (deltaDollars === 0) return // No change — nothing to post

        const deltaCents = dollarsToCents(deltaDollars)

        // Find the existing TipTransaction for this payment
        const existingTipTxn = await db.tipTransaction.findFirst({
          where: {
            paymentId: payment.id,
            locationId: order.locationId,
            deletedAt: null,
          },
        })

        if (!existingTipTxn) {
          console.warn(`[adjust-tip] No TipTransaction found for paymentId=${payment.id} — skipping ledger adjustment`)
          return
        }

        // Find all original CREDIT entries for this TipTransaction to determine
        // which employees received the original allocation
        const originalCredits = await db.tipLedgerEntry.findMany({
          where: {
            sourceId: existingTipTxn.id,
            sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
            type: 'CREDIT',
            deletedAt: null,
          },
        })

        if (originalCredits.length === 0) {
          console.warn(`[adjust-tip] No CREDIT entries found for TipTransaction ${existingTipTxn.id} — skipping ledger adjustment`)
          return
        }

        // For each original CREDIT entry, post a proportional delta entry.
        // If it was a group split, each member gets their proportional share of
        // the delta. If it was a single direct tip, that employee gets the full delta.
        const originalTotalCents = originalCredits.reduce((sum, c) => sum + Math.abs(Number(c.amountCents)), 0)

        let remainingDelta = Math.abs(deltaCents)
        for (let i = 0; i < originalCredits.length; i++) {
          const credit = originalCredits[i]
          const creditCents = Math.abs(Number(credit.amountCents))

          // Last entry absorbs rounding remainder
          let entryDeltaCents: number
          if (i === originalCredits.length - 1) {
            entryDeltaCents = remainingDelta
          } else {
            entryDeltaCents = Math.round(Math.abs(deltaCents) * (creditCents / originalTotalCents))
            remainingDelta -= entryDeltaCents
          }

          if (entryDeltaCents <= 0) continue

          await postToTipLedger({
            locationId: order.locationId,
            employeeId: credit.employeeId,
            amountCents: entryDeltaCents,
            type: deltaCents > 0 ? 'CREDIT' : 'DEBIT',
            sourceType: 'ADJUSTMENT',
            sourceId: existingTipTxn.id,
            orderId,
            memo: `Tip adjustment: ${deltaCents > 0 ? 'increased' : 'decreased'} by $${Math.abs(deltaDollars).toFixed(2)} on order ${orderId}`,
            idempotencyKey: `tip-adjust:${orderId}:${payment.id}:${credit.employeeId}:${Date.now()}`,
          })
        }

        // Update the TipTransaction's amountCents to reflect the new total
        const newTipCents = dollarsToCents(newTipAmount)
        await db.tipTransaction.update({
          where: { id: existingTipTxn.id },
          data: { amountCents: newTipCents },
        })
      } catch (err) {
        console.error('[adjust-tip] Tip ledger delta adjustment failed:', err)
      }
    })()

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

    return ok({
        payment: {
          id: updatedPayment.id,
          tipAmount: Number(updatedPayment.tipAmount),
          totalAmount: Number(updatedPayment.totalAmount),
        },
        oldTipAmount,
        newTipAmount,
      })
  } catch (error) {
    console.error('Failed to adjust tip:', error)
    return err('Failed to adjust tip', 500)
  }
}))

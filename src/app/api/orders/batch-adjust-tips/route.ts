import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { postToTipLedger, dollarsToCents } from '@/lib/domain/tips/tip-ledger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { isInOutageMode } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream, queueIfOutageOrFail, OutageQueueFullError } from '@/lib/sync/outage-safe-write'
import { roundToCents } from '@/lib/pricing'
import { getRequestLocationId } from '@/lib/request-context'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-batch-adjust-tips')

interface TipAdjustment {
  orderId: string
  paymentId: string
  tipAmount: number
}

// POST - Batch adjust tips for multiple orders
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const { adjustments, employeeId } = await request.json() as {
      adjustments: TipAdjustment[]
      employeeId: string
    }

    if (!adjustments?.length || !employeeId) {
      return err('Missing required fields: adjustments array and employeeId')
    }

    if (adjustments.some(a => a.tipAmount < 0)) {
      return err('Tip amounts cannot be negative')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let batchLocationId = getRequestLocationId()
    if (!batchLocationId) {
      const firstOrderLookup = await db.order.findUnique({
        where: { id: adjustments[0].orderId },
        select: { locationId: true },
      })
      if (!firstOrderLookup) {
        return notFound('Order not found')
      }
      batchLocationId = firstOrderLookup.locationId
    }
    // Synthetic object for backward compat with downstream code that reads firstOrder.locationId
    const firstOrder = { locationId: batchLocationId }
    const authResult = await requirePermission(employeeId, firstOrder.locationId, PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS)
    if (!authResult.authorized) {
      return err(authResult.error, authResult.status ?? 403)
    }

    const results: { orderId: string; success: boolean; error?: string }[] = []
    let totalTips = 0
    const dispatchInfos: { locationId: string; orderId: string; subtotal: number; taxTotal: number; tipTotal: number; discountTotal: number; total: number; commissionTotal: number }[] = []
    const allocationInfos: { locationId: string; orderId: string; employeeId: string; paymentId: string; paymentMethod: string; oldTipAmount: number; newTipAmount: number }[] = []

    // Phase 1: Pre-fetch orders and call Datacap for card payments (before DB transaction)
    // Datacap calls are network I/O to hardware — must happen outside the transaction.
    const datacapApproved = new Set<string>() // paymentIds that passed Datacap
    const datacapSkipped = new Set<string>()  // paymentIds that are non-card (no Datacap needed)
    const datacapFailed = new Map<string, string>() // paymentId → error message

    // Pre-fetch all orders+payments for validation and Datacap calls
     
    const prefetched = new Map<string, { order: any; adj: TipAdjustment }>()

    // Pre-fetch all orders + payments in batch to avoid N+1
    // TODO: Add batch getOrdersByIds to OrderRepository for tenant-safe batch fetch
    const allOrderIds = [...new Set(adjustments.map(a => a.orderId))]
    // TODO: Add batch getOrdersByIds to OrderRepository for tenant-safe batch fetch
    const allOrders = await db.order.findMany({
      where: { id: { in: allOrderIds }, locationId: firstOrder.locationId },
      include: { payments: { where: { deletedAt: null } } },
    })
    const orderMap = new Map(allOrders.map(o => [o.id, o]))

    for (const adj of adjustments) {
      const order = orderMap.get(adj.orderId)

      if (!order) {
        results.push({ orderId: adj.orderId, success: false, error: 'Order not found' })
        continue
      }

      const payment = order.payments.find(p => p.id === adj.paymentId)
      if (!payment) {
        results.push({ orderId: adj.orderId, success: false, error: 'Payment not found' })
        continue
      }

      // Tip cap: 500% of base amount (matches validation.ts and adjust-tip route).
      // payment.amount IS the base amount (food + tax, excluding tip) — tipAmount
      // is stored separately, so we must NOT subtract it.
      const baseAmount = Number(payment.amount)
      const maxTip = baseAmount > 0 ? baseAmount * 5 : 0
      if (adj.tipAmount > maxTip) {
        results.push({ orderId: adj.orderId, success: false, error: `Tip $${adj.tipAmount.toFixed(2)} exceeds the maximum allowed (500% of $${baseAmount.toFixed(2)})` })
        continue
      }

      // Re-shape order to match the expected structure (single payment in array)
      const orderWithFilteredPayment = { ...order, payments: [payment] }
      prefetched.set(adj.paymentId, { order: orderWithFilteredPayment, adj })

      // Call Datacap for card payments
      if (payment.datacapRecordNo && payment.paymentReaderId) {
        try {
          const datacapClient = await requireDatacapClient(order.locationId)
          const datacapResponse = await datacapClient.adjustGratuity(payment.paymentReaderId, {
            recordNo: payment.datacapRecordNo,
            purchaseAmount: Number(payment.amount),
            gratuityAmount: adj.tipAmount,
          })
          const datacapError = parseError(datacapResponse)
          if (datacapError || datacapResponse.cmdStatus !== 'Approved') {
            datacapFailed.set(adj.paymentId, datacapError?.text ?? 'Datacap declined the tip adjustment')
            results.push({ orderId: adj.orderId, success: false, error: datacapError?.text ?? 'Datacap declined the tip adjustment' })
          } else {
            datacapApproved.add(adj.paymentId)
          }
        } catch (datacapErr) {
          console.error(`Datacap adjustGratuity failed for payment ${adj.paymentId}:`, datacapErr)
          datacapFailed.set(adj.paymentId, 'Could not reach card reader to adjust tip')
          results.push({ orderId: adj.orderId, success: false, error: 'Could not reach card reader to adjust tip' })
        }
      } else {
        // Non-card payment — no Datacap call needed
        datacapSkipped.add(adj.paymentId)
      }
    }

    // Phase 2: DB transaction — only update payments that passed Datacap (or don't need it)
    // Filter to eligible adjustments first to avoid repeated checks inside transaction
    const eligibleEntries = [...prefetched.entries()].filter(([paymentId]) =>
      !datacapFailed.has(paymentId) && (datacapApproved.has(paymentId) || datacapSkipped.has(paymentId))
    )

    if (eligibleEntries.length > 0) {
      await db.$transaction(async (tx) => {
        // Batch 1: Update all payment tips in parallel
        await Promise.all(
          eligibleEntries.map(([, { order, adj }]) => {
            const payment = order.payments[0]
            const newTotalAmount = Number(payment.amount) + adj.tipAmount
            return PaymentRepository.updatePayment(adj.paymentId, order.locationId, {
              tipAmount: adj.tipAmount,
              totalAmount: newTotalAmount,
              lastMutatedBy: 'local',
            }, tx)
          })
        )

        // Batch 2: Fetch all payments for affected orders in one query (avoid N+1 findMany per order)
        // TODO: Add batch getPaymentsForOrders to PaymentRepository for tenant-safe batch fetch
        const affectedOrderIds = [...new Set(eligibleEntries.map(([, { adj }]) => adj.orderId))]
        const allOrderPayments = await (tx as any).payment.findMany({
          where: {
            orderId: { in: affectedOrderIds },
            locationId: firstOrder.locationId,
            deletedAt: null,
            status: { not: 'voided' },
          },
        })

        // Group payments by orderId for tip recalculation
        const paymentsByOrder = new Map<string, typeof allOrderPayments>()
        for (const p of allOrderPayments) {
          const list = paymentsByOrder.get(p.orderId) ?? []
          list.push(p)
          paymentsByOrder.set(p.orderId, list)
        }

        // Build a map of paymentId → new tip amount from this batch
        const tipOverrides = new Map(eligibleEntries.map(([, { adj }]) => [adj.paymentId, adj.tipAmount]))

        // Batch 3: Update all order totals in parallel + create all audit logs in parallel
        const orderUpdates: Promise<unknown>[] = []
        const auditCreates: Promise<unknown>[] = []

        for (const [paymentId, { order, adj }] of eligibleEntries) {
          const payment = order.payments[0]
          const oldTipAmount = Number(payment.tipAmount)

          // Recalculate order tip total from all non-voided payments (using overrides for this batch)
          const orderPayments = paymentsByOrder.get(adj.orderId) ?? []
          const newOrderTipTotal = orderPayments.reduce(
            (sum: number, p: { id: string; tipAmount: unknown }) => sum + (tipOverrides.has(p.id) ? tipOverrides.get(p.id)! : Number(p.tipAmount)),
            0
          )

          // Recalculate Order.total to include new tip total (BUG #410 fix)
          const newOrderTotal = roundToCents(Number(order.subtotal) + Number(order.taxFromExclusive || 0) - Number(order.discountTotal) + newOrderTipTotal)

          orderUpdates.push(
            OrderRepository.updateOrder(adj.orderId, order.locationId, {
              tipTotal: newOrderTipTotal,
              total: newOrderTotal,
              version: { increment: 1 },
              lastMutatedBy: 'local',
            }, tx)
          )

          auditCreates.push(
            tx.auditLog.create({
              data: {
                locationId: order.locationId,
                employeeId,
                action: 'tip_adjusted',
                entityType: 'payment',
                entityId: adj.paymentId,
                details: {
                  orderId: adj.orderId,
                  orderNumber: order.orderNumber,
                  paymentId: adj.paymentId,
                  oldTipAmount,
                  newTipAmount: adj.tipAmount,
                  difference: adj.tipAmount - oldTipAmount,
                  reason: 'Batch tip adjustment',
                  batchSize: adjustments.length,
                  datacapAdjusted: datacapApproved.has(paymentId),
                },
              },
            })
          )

          totalTips += adj.tipAmount
          results.push({ orderId: adj.orderId, success: true })
          dispatchInfos.push({
            locationId: order.locationId,
            orderId: adj.orderId,
            subtotal: Number(order.subtotal),
            taxTotal: Number(order.taxTotal),
            tipTotal: newOrderTipTotal,
            discountTotal: Number(order.discountTotal),
            total: newOrderTotal,
            commissionTotal: Number(order.commissionTotal || 0),
          })

          // Collect info for tip ledger delta adjustment (mirrors single adjust-tip)
          if (order.employeeId) {
            allocationInfos.push({
              locationId: order.locationId,
              orderId: adj.orderId,
              employeeId: order.employeeId,
              paymentId: adj.paymentId,
              paymentMethod: payment.paymentMethod,
              oldTipAmount,
              newTipAmount: adj.tipAmount,
            })
          }
        }

        // Execute order updates and audit log creates in parallel
        await Promise.all([...orderUpdates, ...auditCreates])
      })
    }

    // Queue outage writes if in outage mode (fail-hard — tip data loss is unacceptable)
    if (isInOutageMode() && eligibleEntries.length > 0) {
      // Batch-fetch all updated payments and orders in two queries instead of N+1
      const eligiblePaymentIds = eligibleEntries.map(([, { adj }]) => adj.paymentId)
      const eligibleOrderIds = [...new Set(eligibleEntries.map(([, { adj }]) => adj.orderId))]

      // TODO: Add batch getPaymentsByIds / getOrdersByIds to repositories for tenant-safe batch fetch
      const [fullPayments, fullOrders] = await Promise.all([
        db.payment.findMany({ where: { id: { in: eligiblePaymentIds }, locationId: firstOrder.locationId } }),
        db.order.findMany({ where: { id: { in: eligibleOrderIds }, locationId: firstOrder.locationId } }),
      ])

      try {
        for (const fp of fullPayments) {
          const entry = eligibleEntries.find(([, { adj }]) => adj.paymentId === fp.id)
          if (entry) {
            await queueIfOutageOrFail('Payment', entry[1].order.locationId, fp.id, 'UPDATE', fp as unknown as Record<string, unknown>)
          }
        }
        for (const fo of fullOrders) {
          await queueIfOutageOrFail('Order', fo.locationId, fo.id, 'UPDATE', fo as unknown as Record<string, unknown>)
        }
      } catch (err) {
        if (err instanceof OutageQueueFullError) {
          return NextResponse.json(
            { error: 'Tips adjusted but outage queue is full — manual reconciliation required', critical: true },
            { status: 507 }
          )
        }
        throw err
      }
    }

    // Fire-and-forget event emission per order
    for (const info of dispatchInfos) {
      void emitOrderEvent(info.locationId, info.orderId, 'ORDER_METADATA_UPDATED', {
        tipTotalCents: Math.round(info.tipTotal * 100),
        totalCents: Math.round(info.total * 100),
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Fire-and-forget tip ledger delta adjustments — mirrors single adjust-tip route.
    // Posts only the delta (new - old) to the ledger, NOT the full new amount.
    for (const alloc of allocationInfos) {
      void (async () => {
        const deltaDollars = alloc.newTipAmount - alloc.oldTipAmount
        if (deltaDollars === 0) return // No change — nothing to post

        const deltaCents = dollarsToCents(deltaDollars)

        // Find the existing TipTransaction for this payment
        const existingTipTxn = await db.tipTransaction.findFirst({
          where: {
            paymentId: alloc.paymentId,
            locationId: alloc.locationId,
            deletedAt: null,
          },
        })

        if (!existingTipTxn) {
          log.warn(`[batch-adjust] No TipTransaction for paymentId=${alloc.paymentId} — skipping ledger delta`)
          return
        }

        // Find original CREDIT entries to determine proportional split
        const originalCredits = await db.tipLedgerEntry.findMany({
          where: {
            sourceId: existingTipTxn.id,
            sourceType: { in: ['DIRECT_TIP', 'TIP_GROUP'] },
            type: 'CREDIT',
            deletedAt: null,
          },
        })

        if (originalCredits.length === 0) {
          log.warn(`[batch-adjust] No CREDIT entries for TipTransaction ${existingTipTxn.id} — skipping ledger delta`)
          return
        }

        // Post proportional delta to each original recipient
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
            locationId: alloc.locationId,
            employeeId: credit.employeeId,
            amountCents: entryDeltaCents,
            type: deltaCents > 0 ? 'CREDIT' : 'DEBIT',
            sourceType: 'ADJUSTMENT',
            sourceId: existingTipTxn.id,
            orderId: alloc.orderId,
            memo: `Batch tip adjustment: ${deltaCents > 0 ? 'increased' : 'decreased'} by $${Math.abs(deltaDollars).toFixed(2)} on order ${alloc.orderId}`,
            idempotencyKey: `tip-adjust-batch:${alloc.orderId}:${alloc.paymentId}:${credit.employeeId}:${Date.now()}`,
          })
        }

        // Update the TipTransaction amount to reflect the new total
        const newTipCents = dollarsToCents(alloc.newTipAmount)
        await db.tipTransaction.update({
          where: { id: existingTipTxn.id },
          data: { amountCents: newTipCents },
        })
      })().catch(err => {
        log.error({ err }, 'Background tip ledger delta failed (batch-adjust-tip)')
      })
    }

    // Fire-and-forget socket dispatches for cross-terminal sync
    for (const info of dispatchInfos) {
      void dispatchOrderTotalsUpdate(info.locationId, info.orderId, {
        subtotal: info.subtotal,
        taxTotal: info.taxTotal,
        tipTotal: info.tipTotal,
        discountTotal: info.discountTotal,
        total: info.total,
        commissionTotal: info.commissionTotal,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.batch-adjust-tips'))
      void dispatchOpenOrdersChanged(info.locationId, {
        trigger: 'payment_updated',
        orderId: info.orderId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchOrderSummaryUpdated(info.locationId, {
        orderId: info.orderId,
        orderNumber: 0,
        status: 'paid',
        tableId: null,
        tableName: null,
        tabName: null,
        guestCount: 0,
        employeeId: null,
        subtotalCents: Math.round(info.subtotal * 100),
        taxTotalCents: Math.round(info.taxTotal * 100),
        discountTotalCents: Math.round(info.discountTotal * 100),
        tipTotalCents: Math.round(info.tipTotal * 100),
        totalCents: Math.round(info.total * 100),
        itemCount: 0,
        updatedAt: new Date().toISOString(),
        locationId: info.locationId,
      }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    const adjusted = results.filter(r => r.success).length
    const errors = results.filter(r => !r.success)

    return ok({
        adjusted,
        totalTips,
        total: adjustments.length,
        errors,
      })
  } catch (error) {
    console.error('Failed to batch adjust tips:', error)
    return err('Failed to batch adjust tips', 500)
  }
})

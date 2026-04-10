import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as PaymentRepository from '@/lib/repositories/payment-repository'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { getPayApiClient, isPayApiSuccess } from '@/lib/datacap/payapi-client'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated, dispatchPaymentProcessed, dispatchGiftCardBalanceChanged } from '@/lib/socket-dispatch'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { queueIfOutageOrFail,  pushUpstream } from '@/lib/sync/outage-safe-write'
import { restoreInventoryForOrder } from '@/lib/inventory/void-waste'
import { validateCellularRefundFromHeaders, validateManagerReauthFromHeaders, CellularAuthError } from '@/lib/cellular-validation'
import { validateMutationApproval } from '@/lib/approval-tokens'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-refund-payment')

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { paymentId, refundAmount, refundReason, notes, managerId, readerId, remoteApprovalCode, approvedById, approvalToken, managerPinHash } =
      await request.json()

    // Validate required fields
    if (!paymentId || refundAmount === undefined || refundAmount === null || !refundReason || !managerId) {
      return err('Missing required fields')
    }

    // Validate mutation-bound approval token (if present)
    const tokenCheck = validateMutationApproval({ approvalToken, approvedById, routeName: 'refund-payment' })
    if (!tokenCheck.valid) {
      return err(tokenCheck.error, tokenCheck.status)
    }

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularRefund = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularRefund ? 'cloud' : 'local'

    // Cellular terminal: block refunds entirely (canRefund=false for CELLULAR_ROAMING)
    try {
      validateCellularRefundFromHeaders(request)
    } catch (caughtErr) {
      if (caughtErr instanceof CellularAuthError) {
        return err(caughtErr.message, caughtErr.status)
      }
      throw caughtErr
    }

    // Cellular terminal: require manager PIN re-authentication for refund
    try {
      validateManagerReauthFromHeaders(request, managerId, managerPinHash)
    } catch (caughtErr) {
      if (caughtErr instanceof CellularAuthError) {
        return err(caughtErr.message, caughtErr.status)
      }
      throw caughtErr
    }

    // Fetch order (unlocked — lightweight check before acquiring lock)
    // NOTE: First fetch uses db directly because we don't have locationId yet.
    // Once we have locationId from this order, all subsequent queries use repositories.
    const order = await db.order.findUnique({
      where: { id, deletedAt: null },
      select: {
        id: true, locationId: true, orderNumber: true, status: true, deletedAt: true,
        tableId: true, tabName: true, guestCount: true, employeeId: true, itemCount: true,
        subtotal: true, taxTotal: true, tipTotal: true, discountTotal: true, total: true,
      },
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Validate refund amount (cheap check before lock)
    if (refundAmount <= 0) {
      return err('Refund amount must be greater than 0')
    }

    // Verify manager has permission to issue refunds
    const authResult = await requirePermission(managerId, order.locationId, PERMISSIONS.MGR_REFUNDS)
    if (!authResult.authorized) return err(authResult.error, authResult.status ?? 403)

    // 3-Phase pattern (matches void-payment): Datacap call OUTSIDE the DB transaction
    // to prevent holding the FOR UPDATE lock during network I/O.
    //
    // Phase 1: Read + validate under FOR UPDATE lock, then release lock
    // Phase 2: Call Datacap outside transaction
    // Phase 3: Write under FOR UPDATE lock (record refund result)
    //
    // PAY-P2-1: Advisory lock prevents concurrent refunds on the same payment from
    // both passing Phase 1 validation and both calling Datacap. The advisory lock
    // is held for the entire 3-phase span (acquired before Phase 1, released after Phase 3).
    // Uses pg_try_advisory_lock to fail fast if another refund is already in progress.

    // PAY-P2-2: Derive advisory lock key from orderId (not paymentId) so that refund
    // and void operations on the same order block each other. Both refund-payment and
    // void-payment use this same derivation to share the lock key space.
    const lockKey = parseInt(id.replace(/-/g, '').slice(0, 12), 16)
    // Defensive cleanup: release any stale lock on this key from a prior crashed request
    // that happened to use this same pooled connection. Safe because Prisma serializes
    // requests per connection, so no other in-flight request can hold this lock here.
    await db.$queryRaw`SELECT pg_advisory_unlock(${lockKey}::bigint)`.catch(() => {})
    const [{ acquired }] = await db.$queryRaw<[{ acquired: boolean }]>`
      SELECT pg_try_advisory_lock(${lockKey}::bigint) as acquired
    `
    if (!acquired) {
      return err('Another refund or void is already in progress for this order', 409)
    }

    try {
    // ── Phase 1: Validate under lock ──────────────────────────────────────────
    const phase1Result = await db.$transaction(async (tx) => {
      // Lock both Payment AND Order rows to serialize void-vs-refund on the same order.
      // The void route locks the Order row; without this, void and refund can both pass
      // Phase 1 simultaneously on the same order.
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${id} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`

      // W5-11: 2FA enforcement for large refunds — MUST be inside the FOR UPDATE lock
      // to prevent concurrent requests from bypassing the check before the lock serializes them.
      const locationSettings = parseSettings(await getLocationSettings(order.locationId))
      const securitySettings = locationSettings.security
      if (securitySettings.require2FAForLargeRefunds && refundAmount > securitySettings.refund2FAThreshold) {
        if (!remoteApprovalCode && !approvedById) {
          return { error: `Manager approval required for refund over $${securitySettings.refund2FAThreshold}`, requiresApproval: true, status: 403 } as const
        }
      }

      const payment = await PaymentRepository.getPaymentById(paymentId, order.locationId, tx)

      if (!payment || payment.orderId !== id) {
        return { error: 'Payment not found', status: 404 } as const
      }

      if (payment.status === 'voided') {
        return { error: 'Cannot refund a voided payment', status: 400 } as const
      }

      if (payment.status === 'refunded') {
        return { error: 'Payment has already been fully refunded', status: 400 } as const
      }

      if (payment.status === 'declined' || payment.status === 'failed') {
        return { error: `Cannot refund a ${payment.status} payment`, status: 400 } as const
      }

      if (refundAmount > Number(payment.amount)) {
        return { error: 'Refund amount exceeds payment amount', status: 400 } as const
      }

      // Over-refund guard: check payment.refundedAmount field (fast path before aggregate query)
      const totalRefunded = Number(payment.refundedAmount || 0) + refundAmount
      if (totalRefunded > Number(payment.amount)) {
        return {
          error: `Refund amount $${refundAmount} would exceed original payment of $${payment.amount} (already refunded: $${payment.refundedAmount || 0})`,
          status: 400,
        } as const
      }

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

      return { payment, totalAlreadyRefunded }
    }, { timeout: 15000 })

    if ('error' in phase1Result) {
      // 2FA enforcement returns requiresApproval flag for the client to show approval UI
      if ('requiresApproval' in phase1Result && phase1Result.requiresApproval) {
        return NextResponse.json(
          { error: phase1Result.error, requiresApproval: true },
          { status: phase1Result.status }
        )
      }
      return err(phase1Result.error!, phase1Result.status)
    }

    const { payment, totalAlreadyRefunded } = phase1Result

    // ── Phase 2: Call Datacap OUTSIDE the transaction ──────────────────────────
    // Re-check payment status immediately before calling processor (concurrent void/refund guard)
    const freshCheck = await db.payment.findUnique({ where: { id: paymentId }, select: { status: true } })
    if (!freshCheck || freshCheck.status !== 'completed') {
      return err('Payment status changed — cannot refund', 409)
    }

    let datacapRefNo: string | null = null
    let refundActionId: string | null = null
    const isCardPayment =
      payment.paymentMethod === 'card' || payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'

    const effectiveReaderId = readerId ?? payment.paymentReaderId ?? null
    if (isCardPayment && effectiveReaderId && payment.datacapRecordNo) {
      await validateReader(effectiveReaderId, order.locationId)
      const client = await requireDatacapClient(order.locationId)

      // Structured processor action tracking — log intent before calling Datacap
      refundActionId = `refund-${paymentId}-${Date.now()}`
      console.log(
        `[PROCESSOR-ACTION] PENDING: action=${refundActionId}, type=refund, ` +
        `orderId=${id}, paymentId=${paymentId}, recordNo=${payment.datacapRecordNo}, ` +
        `refundAmount=${refundAmount}, readerId=${effectiveReaderId}`
      )

      const response = await client.emvReturn(effectiveReaderId, {
        recordNo: payment.datacapRecordNo,
        invoiceNo: order.orderNumber?.toString() ?? id,
        amount: refundAmount,
        cardPresent: false,
      })

      if (response.cmdStatus !== 'Approved') {
        console.log(
          `[PROCESSOR-ACTION] DECLINED: action=${refundActionId}, ` +
          `response=${response.textResponse || 'Unknown'}`
        )
        return err(response.textResponse || 'Refund declined', 422)
      }

      console.log(`[PROCESSOR-ACTION] APPROVED: action=${refundActionId}, type=refund, refNo=${response.refNo ?? 'none'}`)
      datacapRefNo = response.refNo ?? null
    }

    // ── Phase 2b: ACH refund via PayAPI /ach/return/{RefNo} ────────────────────
    const isAchPayment = payment.paymentMethod === 'ach'
    if (isAchPayment && payment.datacapRefNumber) {
      refundActionId = `ach-refund-${paymentId}-${Date.now()}`
      log.info(
        { action: refundActionId, paymentId, refNo: payment.datacapRefNumber, refundAmount },
        'ACH refund initiated'
      )

      // ACH returns require routing/account info. Since we don't store raw bank details
      // (PCI compliance), we rely on the Datacap token stored during the original authorize.
      // The return endpoint also accepts the original RefNo to reference the authorization.
      //
      // Note: ACH returns must be within 45 days and cannot exceed original amount.
      try {
        const achResult = await getPayApiClient().achReturn({
          refNo: payment.datacapRefNumber,
          routingNo: '000000000', // Datacap fills from original txn via RefNo
          acctNo: '0000',         // Datacap fills from original txn via RefNo
          amount: refundAmount.toFixed(2),
          custFirstName: 'Refund',
          custLastName: 'Customer',
          entryClass: 'Personal',
        })

        if (!isPayApiSuccess(achResult.status)) {
          log.warn(
            { action: refundActionId, status: achResult.status, message: achResult.message },
            'ACH refund declined'
          )
          return err(achResult.message || 'ACH refund declined by processor', 422)
        }

        log.info({ action: refundActionId, refNo: achResult.refNo }, 'ACH refund approved')
        datacapRefNo = achResult.refNo ?? null
      } catch (achErr) {
        log.error({ err: achErr, action: refundActionId }, 'ACH refund failed')
        return err('ACH refund processing failed. Please try again.', 502)
      }
    }

    // ── Phase 3: Write under lock (record refund result) ──────────────────────
    const txResult = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`

      // Re-check payment status inside lock (may have changed between Phase 1 and Phase 3)
      const freshPayment = await PaymentRepository.getPaymentById(paymentId, order.locationId, tx)
      if (freshPayment?.status === 'voided') {
        return { error: 'Payment was voided between refund phases', status: 400 } as const
      }
      if (freshPayment?.status === 'refunded') {
        return { error: 'Payment was fully refunded between refund phases', status: 400 } as const
      }

      // Re-check cumulative refunds inside lock
      const freshRefunds = await tx.refundLog.aggregate({
        where: { paymentId },
        _sum: { refundAmount: true },
      })
      const freshTotalRefunded = Number(freshRefunds._sum.refundAmount ?? 0)
      if (freshTotalRefunded + refundAmount > Number(payment.amount)) {
        return {
          error: `Refund amount exceeds remaining refundable balance (concurrent refund detected).`,
          status: 400,
        } as const
      }

      const isPartial = refundAmount < Number(payment.amount)

      await PaymentRepository.updatePayment(paymentId, order.locationId, {
        status: isPartial ? 'completed' : 'refunded',
        refundedAt: new Date(),
        refundedAmount: freshTotalRefunded + refundAmount,
        lastMutatedBy: mutationOrigin,
      }, tx)

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

      // Outage queue write INSIDE the transaction for atomicity
      if (isInOutageMode()) {
        await queueIfOutageOrFail('RefundLog', order.locationId, refundLog.id, 'INSERT', refundLog as unknown as Record<string, unknown>, tx)
        const fullPayment = await tx.payment.findUnique({ where: { id: paymentId } })
        if (fullPayment) await queueIfOutageOrFail('Payment', order.locationId, paymentId, 'UPDATE', fullPayment as unknown as Record<string, unknown>, tx)
      }

      return { refundLog, isPartial, totalAlreadyRefunded: freshTotalRefunded, payment }
    }, { timeout: 15000 })

    if ('error' in txResult) {
      // CRITICAL: If Datacap succeeded but Phase 3 failed, log for reconciliation
      if (isCardPayment && datacapRefNo) {
        console.error(
          `[PAYMENT-SAFETY] CRITICAL: Datacap refund succeeded (refNo=${datacapRefNo}) but DB write failed. ` +
          `actionId=${refundActionId}, orderId=${id}, paymentId=${paymentId}, amount=${refundAmount}. ` +
          `Manual reconciliation required.`
        )
      }
      return err(txResult.error!, txResult.status)
    }

    const { refundLog, isPartial } = txResult

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
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    void dispatchOrderTotalsUpdate(order.locationId, id, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      discountTotal: Number(order.discountTotal),
      total: Number(order.total),
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

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
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))

    // Dispatch payment:processed with refunded status (fire-and-forget)
    void dispatchPaymentProcessed(order.locationId, {
      orderId: id,
      paymentId,
      status: 'refunded',
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Queue outage write if Neon is unreachable — read back full row to
    // avoid NOT NULL constraint violations on replay (partial payloads are unsafe)
    if (isInOutageMode()) {
      // Flag refund processed during outage for reconciliation
      void PaymentRepository.updatePayment(paymentId, order.locationId, {
        needsReconciliation: true,
      }).catch(err => log.warn({ err }, 'Background task failed'))

      const fullPayment = await PaymentRepository.getPaymentById(paymentId, order.locationId)
      if (fullPayment) {
        void queueOutageWrite('Payment', fullPayment.id, 'UPDATE', fullPayment as unknown as Record<string, unknown>, order.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // Bug 8 + C5 fix: Proportional tip reduction on partial/full refund (fire-and-forget)
    // Uses FOR UPDATE lock to prevent concurrent refund races on stale tip/amount values
    void (async () => {
      try {
        const tipReductionResult = await db.$transaction(async (tx) => {
          // Lock the payment row to prevent concurrent refund races
          // TODO: FOR UPDATE lock kept as raw SQL — no repository equivalent
          await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`
          const freshPayment = await PaymentRepository.getPaymentByIdOrThrow(paymentId, order.locationId, tx)

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
          if (totalRefunded >= paymentOriginalAmount) {
            return null // Over-refund guard
          }

          const tipReduction = Math.round(paymentTipAmount * (refundAmount / paymentOriginalAmount) * 100) / 100
          if (tipReduction <= 0) {
            return null
          }

          // Update Payment.tipAmount and totalAmount with fresh locked values
          const newTipAmount = Math.max(0, paymentTipAmount - tipReduction)
          await PaymentRepository.updatePayment(paymentId, order.locationId, {
            tipAmount: newTipAmount,
            totalAmount: Number(freshPayment.amount) - totalRefunded + newTipAmount,
            lastMutatedBy: mutationOrigin,
          }, tx)

          // Update Order.tipTotal from all non-voided payments (inside lock)
          const allPayments = await PaymentRepository.getPaymentsForOrderByStatus(id, order.locationId, ['completed', 'refunded', 'pending'], tx)
          const newOrderTipTotal = allPayments.reduce((sum, p) => sum + Number(p.tipAmount), 0)
          await OrderRepository.updateOrder(id, order.locationId, { tipTotal: newOrderTipTotal, lastMutatedBy: mutationOrigin }, tx)

          return { tipReduction, newOrderTipTotal }
        }, { timeout: 15000 })

        if (tipReductionResult) {
          // Fire-and-forget event emission for tip update
          void emitOrderEvent(order.locationId, id, 'ORDER_METADATA_UPDATED', {
            tipTotalCents: Math.round(tipReductionResult.newOrderTipTotal * 100),
          }).catch(err => log.warn({ err }, 'Background task failed'))

          // Trigger tip chargeback for the proportional amount only.
          // Pass tipReductionCents so chargeback creates proportional DEBITs
          // instead of reversing the full original CREDIT amounts.
          const tipReductionCents = Math.round(tipReductionResult.tipReduction * 100)
          void handleTipChargeback({
            locationId: order.locationId,
            paymentId,
            memo: `Partial refund ($${refundAmount.toFixed(2)}): proportional tip reduction of $${tipReductionResult.tipReduction.toFixed(2)}`,
            tipReductionCents,
          }).catch(err => {
            console.warn('[refund-payment] Tip chargeback skipped or failed:', err.message)
          })
        }
      } catch (caughtErr) {
        console.error('[refund-payment] Failed to adjust tip proportionally:', caughtErr)
      }
    })()

    // Loyalty point reversal: reverse earned points proportionally for refund (fire-and-forget)
    void (async () => {
      try {
        if (!order.id) return
        // Fetch order's customerId (not included in initial lightweight query)
        const orderWithCustomer = await db.order.findUnique({
          where: { id },
          select: { customerId: true, orderNumber: true },
        })
        if (!orderWithCustomer?.customerId) return

        const locSettings = parseSettings(await getLocationSettings(order.locationId))
        if (!locSettings.loyalty.enabled) return

        // Find all 'earn' loyalty transactions for this order
        const earnTxns = await db.$queryRaw<Array<{ points: unknown }>>`
          SELECT "points" FROM "LoyaltyTransaction" WHERE "orderId" = ${id} AND "type" = 'earn'
        `.catch(() => [] as Array<{ points: unknown }>)

        const earnedPoints = earnTxns.reduce((sum, t) => sum + (Number(t.points) || 0), 0)
        if (earnedPoints <= 0) return

        const paymentAmount = Number(payment.amount)
        // Full refund: reverse all points. Partial: reverse proportionally.
        const pointsToReverse = isPartial
          ? Math.round(earnedPoints * (refundAmount / paymentAmount))
          : earnedPoints

        if (pointsToReverse <= 0) return

        // Decrement customer loyalty points and stats (proportional for partial)
        const spentReduction = isPartial ? refundAmount : paymentAmount
        if (isPartial) {
          await db.$executeRaw`
            UPDATE "Customer" SET
              "loyaltyPoints" = GREATEST(0, "loyaltyPoints" - ${pointsToReverse}),
              "lifetimePoints" = GREATEST(0, "lifetimePoints" - ${pointsToReverse}),
              "totalSpent" = GREATEST(0, "totalSpent" - ${spentReduction}),
              "updatedAt" = NOW()
            WHERE "id" = ${orderWithCustomer.customerId}`
        } else {
          await db.$executeRaw`
            UPDATE "Customer" SET
              "loyaltyPoints" = GREATEST(0, "loyaltyPoints" - ${pointsToReverse}),
              "lifetimePoints" = GREATEST(0, "lifetimePoints" - ${pointsToReverse}),
              "totalSpent" = GREATEST(0, "totalSpent" - ${spentReduction}),
              "totalOrders" = GREATEST(0, "totalOrders" - 1),
              "updatedAt" = NOW()
            WHERE "id" = ${orderWithCustomer.customerId}`
        }

        // Create reversal LoyaltyTransaction
        const txnId = crypto.randomUUID()
        const desc = isPartial
          ? `Reversed ${pointsToReverse} points: partial refund ($${refundAmount.toFixed(2)}) on order #${orderWithCustomer.orderNumber}`
          : `Reversed: payment refunded on order #${orderWithCustomer.orderNumber}`
        const mgrId = managerId || null
        await db.$executeRaw`
          INSERT INTO "LoyaltyTransaction" (
            "id", "customerId", "locationId", "orderId", "type", "points",
            "balanceBefore", "balanceAfter", "description", "employeeId", "createdAt"
          ) VALUES (${txnId}, ${orderWithCustomer.customerId}, ${order.locationId}, ${id}, 'adjust', ${-pointsToReverse}, 0, 0, ${desc}, ${mgrId}, NOW())`
      } catch (caughtErr) {
        console.error('[refund-payment] Loyalty point reversal failed:', caughtErr)
      }
    })()

    // Gift card balance restoration: if this refund is on a gift card payment,
    // restore the refund amount to the gift card balance (fire-and-forget)
    void (async () => {
      try {
        if (payment.paymentMethod !== 'gift_card') return

        // Find the GiftCardTransaction for this payment via orderId + type='redemption'
        // The gift card payment creates a 'redemption' transaction linked to the orderId
        const gcTxns = await db.$queryRaw<Array<{ giftCardId: string }>>`
          SELECT DISTINCT "giftCardId" FROM "GiftCardTransaction"
           WHERE "orderId" = ${id} AND "type" = 'redemption' AND "deletedAt" IS NULL
           LIMIT 1
        `

        if (gcTxns.length === 0) {
          console.warn(`[refund-payment] Gift card payment refunded but no GiftCardTransaction found for orderId=${id}`)
          return
        }

        const giftCardId = gcTxns[0].giftCardId

        // Lock the gift card row and restore balance
        let newBalance = 0
        await db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "GiftCard" WHERE id = ${giftCardId} FOR UPDATE`

          const gcRows = await tx.$queryRaw<Array<{ currentBalance: unknown; status: string }>>`
            SELECT "currentBalance", "status" FROM "GiftCard" WHERE "id" = ${giftCardId}
          `
          if (gcRows.length === 0) return

          const currentBalance = Number(gcRows[0].currentBalance)
          newBalance = currentBalance + refundAmount

          await tx.$executeRaw`
            UPDATE "GiftCard"
             SET "currentBalance" = ${newBalance}, "status" = 'active', "updatedAt" = NOW()
             WHERE "id" = ${giftCardId}
          `

          const gcTxnId = crypto.randomUUID()
          const gcMgrId = managerId || null
          const gcNotes = isPartial
            ? `Partial refund of $${refundAmount.toFixed(2)} restored to gift card`
            : `Full refund of $${refundAmount.toFixed(2)} restored to gift card`
          await tx.$executeRaw`
            INSERT INTO "GiftCardTransaction" (
              "id", "locationId", "giftCardId", "type", "amount",
              "balanceBefore", "balanceAfter", "orderId", "employeeId", "notes",
              "createdAt", "updatedAt"
            ) VALUES (
              ${gcTxnId}, ${order.locationId}, ${giftCardId}, 'refund', ${refundAmount},
              ${currentBalance}, ${newBalance}, ${id}, ${gcMgrId}, ${gcNotes},
              NOW(), NOW()
            )
          `
        }, { timeout: 10000 })

        console.log(`[refund-payment] Gift card ${giftCardId} balance restored by $${refundAmount.toFixed(2)} for orderId=${id}`)
        void dispatchGiftCardBalanceChanged(order.locationId, { giftCardId, newBalance })
      } catch (caughtErr) {
        console.error('[refund-payment] Gift card balance restoration failed:', caughtErr)
      }
    })()

    // Restore inventory deductions when a FULL refund leaves no active payments.
    // Check all payments on the order: if every one is now voided or fully refunded,
    // the sale is fully reversed and stock should be restored. Fire-and-forget.
    if (!isPartial) {
      void (async () => {
        try {
          const allPayments = await PaymentRepository.getPaymentsForOrder(id, order.locationId)
          const hasActivePayments = allPayments.some(
            (p) => p.status !== 'voided' && p.status !== 'refunded'
          )
          if (!hasActivePayments) {
            await restoreInventoryForOrder(id, order.locationId)
          }
        } catch (caughtErr) {
          console.error('[refund-payment] Failed to restore inventory:', caughtErr)
        }
      })()
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    return ok({
        refundLog: {
          id: refundLog.id,
          refundAmount: Number(refundLog.refundAmount),
          refundReason: refundLog.refundReason,
          createdAt: refundLog.createdAt,
        },
        isPartial,
      })
    } finally {
      // PAY-P2-1: Release advisory lock after all 3 phases complete (success or failure)
      await db.$queryRaw`SELECT pg_advisory_unlock(${lockKey}::bigint)`.catch(err => log.warn({ err }, 'Background task failed'))
    }
  } catch (error) {
    console.error('Failed to refund payment:', error)
    return err('Failed to refund payment', 500)
  }
})

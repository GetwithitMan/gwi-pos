/**
 * Commit Payment Transaction
 *
 * Extracted from the pay route: everything that happens INSIDE the $transaction
 * after the payment loop completes. This includes:
 *
 *   1. Tip total & paid status calculation
 *   2. Loyalty points pre-compute
 *   3. Customer stats pre-compute
 *   4. Payment events build (PAYMENT_APPLIED + ORDER_CLOSED)
 *   5. Event ingestion via ingestAndProject()
 *   6. Pending capture completion
 *   7. Already-paid race guard
 *
 * Called INSIDE the existing db.$transaction — receives tx, returns the result.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { OrderStatus, PaymentMethod } from '@/generated/prisma/client'
import { roundToCents, toNumber } from '@/lib/pricing'
import { ingestAndProject, type IngestEvent } from '@/lib/order-events/ingester'
import * as OrderRepository from '@/lib/repositories/order-repository'
import type { TxClient, PaymentRecord } from '@/lib/domain/payment/types'
import type { LocationSettings } from '@/lib/settings'
import type { PaymentLoopResult } from '@/lib/domain/payment/executors/process-payment-loop'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('commit-payment')

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommitPaymentParams {
  tx: TxClient
  /** Outer db client — used for loyalty tier query outside the transaction lock */
  outerDb: { $queryRaw: TxClient['$queryRaw'] }
  order: any
  loopResult: PaymentLoopResult
  payments: Array<{ method: string; amount: number }>
  settings: LocationSettings
  alreadyPaid: number
  paymentBaseTotal: number
  orderTotal: number
  businessDayStart: Date
  employeeId: string | null
  terminalId: string | null
  orderId: string
  pendingCaptureInserted: boolean
  finalIdempotencyKey: string
  splitPayRemainingOverride: number | null
  isCellular: boolean
  autoGratApplied: boolean
  autoGratNote: string | null
  isTrainingPayment: boolean
  totalDriftWarning: { capturedTotal: number; currentTotal: number; drift: number } | null
  unsentItems: any[]
  timing?: { start: (label: string) => void; end: (label: string, desc?: string) => void }
}

export interface CommitPaymentSuccess {
  order: any
  ingestResult: any
  settings: LocationSettings
  payments: Array<{ method: string; amount: number }>
  employeeId: string | null
  terminalId: string | null
  allPendingPayments: PaymentRecord[]
  totalTips: number
  newTipTotal: number
  newPaidTotal: number
  effectiveTotal: number
  paidTolerance: number
  orderIsPaid: boolean
  updateData: {
    tipTotal: number
    primaryPaymentMethod?: PaymentMethod
    status?: OrderStatus
    paidAt?: Date
    closedAt?: Date
    businessDayDate: Date
  }
  pointsEarned: number
  newAverageTicket: number | null
  loyaltyEarningBase: number
  shouldUpdateCustomerStats: boolean
  pmsAttemptId: string | null
  pmsTransactionNo: string | null
  unsentItems: any[]
  businessDayStart: Date
  paymentMutationOrigin: 'cloud' | 'local'
  hasCash: boolean
  autoGratApplied: boolean
  autoGratNote: string | null
  isTrainingPayment: boolean
  giftCardBalanceChanges: Array<{ giftCardId: string; newBalance: number }>
  isSplitPayRemaining: boolean
  totalDriftWarning: { capturedTotal: number; currentTotal: number; drift: number } | null
  /** Card payment records that need auto-void on tx failure */
  autoVoidRecords: Record<string, unknown>[]
  autoVoidTerminalId: string | undefined
  autoVoidLocationId: string | undefined
  loyaltyTierMultiplier: number
}

export type CommitPaymentResult =
  | { earlyReturn: NextResponse }
  | CommitPaymentSuccess

// ─── Main ───────────────────────────────────────────────────────────────────

export async function commitPaymentTransaction(params: CommitPaymentParams): Promise<CommitPaymentResult> {
  const {
    tx,
    outerDb,
    order,
    loopResult,
    payments,
    settings,
    alreadyPaid,
    paymentBaseTotal,
    orderTotal,
    businessDayStart,
    employeeId,
    terminalId,
    orderId,
    pendingCaptureInserted,
    finalIdempotencyKey,
    splitPayRemainingOverride,
    isCellular,
    autoGratApplied,
    autoGratNote,
    isTrainingPayment,
    totalDriftWarning,
    unsentItems,
    timing,
  } = params

  const { allPendingPayments, totalTips, giftCardBalanceChanges, pmsAttemptId, pmsTransactionNo } = loopResult

  // ── 1. Tip total & paid status calculation ──────────────────────────

  // Update order status and tip total
  const newTipTotal = roundToCents(toNumber(order.tipTotal ?? 0) + totalTips)
  // Use paymentBaseTotal (excludes tips) for balance comparison — tips should NOT
  // count toward paying the order balance, only base payment amounts do.
  const newPaidTotal = alreadyPaid + paymentBaseTotal

  // When price rounding is active for cash, the paid amount may be less than orderTotal
  // by up to the rounding increment (e.g., $3.25 paid for $3.29 order with quarter rounding).
  // The tolerance must cover this gap so the order is marked fully paid.
  const hasCash = payments.some(p => p.method === 'cash')
  const paidTolerance = (hasCash && settings.priceRounding?.enabled && settings.priceRounding.applyToCash)
    ? roundToCents(parseFloat(settings.priceRounding.increment) / 2)  // Half the increment covers rounding in either direction
    : 0.01

  const updateData: {
    tipTotal: number
    primaryPaymentMethod?: PaymentMethod
    status?: OrderStatus
    paidAt?: Date
    closedAt?: Date
    businessDayDate: Date
  } = {
    tipTotal: newTipTotal,
    businessDayDate: businessDayStart,
  }

  // Set primary payment method based on the payment with the largest amount.
  // In split-tender scenarios, the largest payment determines the primary method
  // (e.g., $80 card + $20 cash → primary is 'card'). If tied, first wins.
  if (!order.primaryPaymentMethod) {
    const largestPayment = payments.reduce((max, p) =>
      (p.amount || 0) > (max.amount || 0) ? p : max
    , payments[0])
    const primaryMethod = largestPayment.method
    updateData.primaryPaymentMethod = (primaryMethod === 'cash' ? 'cash' : 'card') as PaymentMethod
  }

  // Mark as paid if fully paid
  // Dual pricing: orderTotal IS the cash price (stored price model).
  // Card price = orderTotal * (1 + cashDiscountPercent/100).
  // For cash payments effectiveTotal is simply orderTotal — do NOT call
  // calculateCashPrice() on it, which would incorrectly reduce it a second time.
  // Cash rounding (applied earlier to validationRemaining) is handled separately;
  // the paid-detection threshold here uses the raw cash total.
  const effectiveTotal = orderTotal
  if (newPaidTotal >= effectiveTotal - paidTolerance) {
    updateData.status = 'paid'
    updateData.paidAt = new Date()
    updateData.closedAt = new Date()
  } else if (newPaidTotal > 0) {
    // H8: Partial payment received — lock order from silent abandonment.
    // Orders in 'in_progress' status remain in the open orders list and are
    // visible on all terminals. Recovery paths:
    //   1. Additional payment(s) to reach full balance
    //   2. Manager void of the partial payment (returns order to 'open')
    //   3. Shift-close reconciliation — manager must resolve open partials
    // There is no automatic timeout or expiry — manual resolution is required.
    if (order.status === 'open' || order.status === 'draft') {
      updateData.status = 'in_progress'
    }
    if (!order.paidAt) {
      updateData.paidAt = new Date()
    }
  }

  // ── 2. Loyalty points pre-compute ───────────────────────────────────

  // Pre-compute loyalty points BEFORE the transaction (avoid nested findUnique inside tx)
  let pointsEarned = 0
  let loyaltyEarningBase = 0
  let loyaltyTierMultiplier = 1.0
  if (updateData.status === 'paid' && order.customer && settings.loyalty.enabled) {
    loyaltyEarningBase = settings.loyalty.earnOnSubtotal
      ? toNumber(order.subtotal ?? 0)
      : toNumber(order.total ?? 0)
    if (settings.loyalty.earnOnTips) {
      loyaltyEarningBase += newTipTotal
    }
    // Check for tier multiplier from LoyaltyTier (Loyalty System migration 098)
    const custTierId = (order.customer as any).loyaltyTierId
    if (custTierId) {
      try {
        const tierRows = await outerDb.$queryRaw<Array<{ pointsMultiplier: unknown }>>`
          SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = ${custTierId} AND "deletedAt" IS NULL
        `
        if (tierRows.length > 0) {
          loyaltyTierMultiplier = Number(tierRows[0].pointsMultiplier) || 1.0
        }
      } catch { /* table may not exist yet — graceful fallback */ }
    }
    if (loyaltyEarningBase >= settings.loyalty.minimumEarnAmount) {
      pointsEarned = Math.round(loyaltyEarningBase * settings.loyalty.pointsPerDollar * loyaltyTierMultiplier)
    }
  }

  // ── 3. Customer stats pre-compute ───────────────────────────────────

  // Pre-compute averageTicket using already-fetched customer data (no extra query needed)
  // Customer stats (totalSpent, totalOrders, lastVisit, averageTicket) update whenever
  // a linked customer's order is fully paid — regardless of loyalty being enabled.
  let newAverageTicket: number | null = null
  const shouldUpdateCustomerStats = updateData.status === 'paid' && order.status !== 'paid' && !!order.customer
  if (shouldUpdateCustomerStats) {
    const currentTotalSpent = toNumber((order.customer as any).totalSpent ?? 0)
    const currentTotalOrders = (order.customer as any).totalOrders ?? 0
    const newTotal = roundToCents(currentTotalSpent + toNumber(order.total ?? 0))
    const newOrders = currentTotalOrders + 1
    newAverageTicket = roundToCents(newTotal / newOrders)
  }

  // ── 4. Build payment events ─────────────────────────────────────────

  const paymentEvents: IngestEvent[] = []
  const bridgeOverrides: Record<string, Record<string, unknown>> = {}

  // HA cellular sync — detect mutation origin for Payment stamping
  const paymentMutationOrigin: 'cloud' | 'local' = isCellular ? 'cloud' : 'local'

  for (const record of allPendingPayments) {
    const rec = record as any
    const paymentId = rec.id || crypto.randomUUID()

    // Ensure the record has an ID for bridge override keying
    rec.id = paymentId

    paymentEvents.push({
      type: 'PAYMENT_APPLIED',
      payload: {
        paymentId,
        method: rec.paymentMethod,
        amountCents: Math.round(toNumber(rec.amount) * 100),
        tipCents: Math.round(toNumber(rec.tipAmount ?? 0) * 100),
        totalCents: Math.round(toNumber(rec.totalAmount) * 100),
        cardBrand: rec.cardBrand ?? null,
        cardLast4: rec.cardLast4 ?? null,
        status: 'approved',
      },
    })

    // All the extra Payment fields that aren't in the domain event
    bridgeOverrides[paymentId] = { ...rec, lastMutatedBy: paymentMutationOrigin }
    // Remove fields already in the event payload to avoid conflicts
    delete bridgeOverrides[paymentId].amount
    delete bridgeOverrides[paymentId].tipAmount
    delete bridgeOverrides[paymentId].totalAmount
    delete bridgeOverrides[paymentId].paymentMethod
    delete bridgeOverrides[paymentId].cardBrand
    delete bridgeOverrides[paymentId].cardLast4
    delete bridgeOverrides[paymentId].status
    delete bridgeOverrides[paymentId].orderId
    delete bridgeOverrides[paymentId].locationId
  }

  // Add ORDER_CLOSED if fully paid
  const orderIsPaid = newPaidTotal >= effectiveTotal - paidTolerance
  if (orderIsPaid) {
    paymentEvents.push({
      type: 'ORDER_CLOSED',
      payload: { closedStatus: 'paid' },
    })
  }

  // ── 5. Event ingestion ──────────────────────────────────────────────

  // Collect auto-void info for post-transaction cleanup on failure
  const autoVoidRecords = allPendingPayments.filter(
    (r: any) => (r.paymentMethod === 'credit' || r.paymentMethod === 'debit') && r.datacapRecordNo
  )
  const autoVoidTerminalId = terminalId || undefined
  const autoVoidLocationId = order.locationId

  timing?.start('db-pay')
  const ingestResult = await ingestAndProject(tx as any, orderId, order.locationId, paymentEvents, {
    paymentBridgeOverrides: bridgeOverrides,
    employeeId: employeeId || undefined,
  })
  timing?.end('db-pay', 'Payment ingestion')

  // ── 6. Pending capture completion ───────────────────────────────────

  // DOUBLE-CHARGE PREVENTION: Mark pending capture as 'completed' now that payment is recorded.
  // This runs inside the same transaction, so if the tx rolls back the capture stays 'processing'
  // (which is correct — it will be retryable). Fire-and-forget with savepoint for safety.
  if (pendingCaptureInserted) {
    try {
      await tx.$executeRaw`SAVEPOINT pc_complete`
      const responseJson = JSON.stringify({
        orderId,
        paymentIds: allPendingPayments.map((r: any) => r.id).filter(Boolean),
        amount: allPendingPayments.reduce((sum: number, r: any) => sum + toNumber(r.amount ?? 0), 0),
      })
      await tx.$executeRaw`
        UPDATE "_pending_captures" SET "status" = 'completed', "completedAt" = NOW(), "response_json" = ${responseJson}
         WHERE "idempotencyKey" = ${finalIdempotencyKey} AND "status" = 'processing'
      `
      await tx.$executeRaw`RELEASE SAVEPOINT pc_complete`
    } catch {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT pc_complete`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
    }
  }

  // ── 7. Already-paid race guard ──────────────────────────────────────

  if (ingestResult.alreadyPaid) {
    // TX-KEEP: COMPLEX — latest payment lookup after ingest race inside FOR UPDATE lock; no repo method
    const existingPayment = await tx.payment.findFirst({
      where: { orderId, locationId: order.locationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
    })
    const freshOrder = await OrderRepository.getOrderByIdWithSelect(orderId, order.locationId, { total: true, status: true }, tx)
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      alreadyPaid: true,
      orderId,
      paymentId: existingPayment?.id ?? 'already-paid',
      amount: existingPayment ? toNumber(existingPayment.amount) : toNumber(freshOrder?.total ?? 0),
      tipAmount: existingPayment ? toNumber(existingPayment.tipAmount) : 0,
      totalAmount: existingPayment ? toNumber(existingPayment.totalAmount) : toNumber(freshOrder?.total ?? 0),
      paymentMethod: existingPayment?.paymentMethod ?? 'cash',
      newOrderBalance: 0,
      orderStatus: freshOrder?.status ?? 'paid',
    } }) }
  }

  // ── Return full transaction result ──────────────────────────────────

  return {
    order,
    ingestResult,
    settings,
    payments,
    employeeId,
    terminalId,
    allPendingPayments,
    totalTips,
    newTipTotal,
    newPaidTotal,
    effectiveTotal,
    paidTolerance,
    orderIsPaid,
    updateData,
    pointsEarned,
    newAverageTicket,
    loyaltyEarningBase,
    shouldUpdateCustomerStats,
    pmsAttemptId,
    pmsTransactionNo,
    unsentItems,
    businessDayStart,
    paymentMutationOrigin,
    hasCash,
    autoGratApplied,
    autoGratNote,
    isTrainingPayment,
    giftCardBalanceChanges,
    isSplitPayRemaining: splitPayRemainingOverride != null,
    totalDriftWarning,
    autoVoidRecords,
    autoVoidTerminalId,
    autoVoidLocationId,
    loyaltyTierMultiplier,
  }
}

/**
 * Payment Idempotency Guards
 *
 * Guards that detect duplicate/orphaned payments INSIDE the pay transaction.
 * Each function returns either `null` (continue) or an earlyReturn object.
 */

import { NextResponse } from 'next/server'
import { createChildLogger } from '@/lib/logger'
import { toNumber } from '@/lib/pricing'
import { checkIdempotencyByKey, checkIdempotencyByRecordNo } from '../validation'
import type { TxClient } from '../types'

const log = createChildLogger('payment-guards')

// ─── Types ──────────────────────────────────────────────────────────────────

/** Payment subset used by key-based and recordNo-based idempotency */
export interface ExistingPayment {
  id: string
  idempotencyKey: string | null
  datacapRecordNo: string | null
  status: string
  paymentMethod: string
  amount: unknown
  tipAmount: unknown
  totalAmount: unknown
}

/** Payment input subset used by amount/time and SAF dedup */
export interface PaymentInputForDedup {
  method: string
  amount: number
  datacapRecordNo?: string
}

/** Standard guard result: null = continue, object = early return */
export type GuardResult = { earlyReturn: NextResponse } | null

// ─── Guard #1: Orphaned Datacap Sales ───────────────────────────────────────

/**
 * Detect orphaned pending Datacap sales from HA failover.
 * Uses a savepoint so a missing table doesn't abort the outer transaction.
 */
export async function checkOrphanedDatacapSales(
  tx: TxClient,
  orderId: string,
): Promise<void> {
  let orphanedSales: Array<{ id: string; amount: unknown; datacapRecordNo: string | null; invoiceNo: string | null }> = []
  try {
    await tx.$executeRaw`SAVEPOINT orphan_check`
    orphanedSales = await tx.$queryRaw<typeof orphanedSales>`
      SELECT id, amount, "datacapRecordNo", "invoiceNo" FROM "_pending_datacap_sales"
       WHERE "orderId" = ${orderId} AND "status" = 'pending' AND "createdAt" < NOW() - INTERVAL '60 seconds'
    `
    await tx.$executeRaw`RELEASE SAVEPOINT orphan_check`
  } catch {
    // Table may not exist on this NUC — roll back savepoint to keep transaction alive
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT orphan_check`.catch(err => log.warn({ err }, 'savepoint rollback failed'))
  }

  if (orphanedSales.length > 0) {
    console.warn(`[PAY] Found ${orphanedSales.length} orphaned pending Datacap sale(s) for order ${orderId}. These may need manual void.`)
    for (const sale of orphanedSales) {
      await tx.$executeRaw`
        UPDATE "_pending_datacap_sales" SET "status" = 'orphaned', "resolvedAt" = NOW() WHERE id = ${sale.id}
      `
    }
  }
}

// ─── Guard #2: Idempotency by Key ──────────────────────────────────────────

/**
 * Check if a payment request is a duplicate by idempotencyKey.
 * Delegates to the pure function in validation.ts, wraps result in NextResponse.
 */
export function checkIdempotencyByKeyGuard(
  idempotencyKey: string | undefined,
  existingPayments: ExistingPayment[],
  orderStatus: string,
): GuardResult {
  const idempDup = checkIdempotencyByKey(idempotencyKey, existingPayments, orderStatus)
  if (idempDup) {
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      duplicate: true,
      ...idempDup.response,
      remainingBalance: 0,
    } }) }
  }
  return null
}

// ─── Guard #3: Idempotency by RecordNo ─────────────────────────────────────

/**
 * Check ALL payments for matching datacapRecordNo.
 * Returns early if any payment's recordNo already exists.
 */
export function checkIdempotencyByRecordNoGuard(
  payments: PaymentInputForDedup[],
  existingPayments: ExistingPayment[],
): GuardResult {
  for (const payment of payments) {
    if (payment.datacapRecordNo) {
      const recordNoDup = checkIdempotencyByRecordNo(payment.datacapRecordNo, existingPayments)
      if (recordNoDup) {
        return { earlyReturn: NextResponse.json(
          {
            error: 'Payment with this recordNo already exists for this order',
            code: 'DUPLICATE_RECORD_NO',
            existingPaymentId: recordNoDup.existingPaymentId,
          },
          { status: 409 }
        ) }
      }
    }
  }
  return null
}

// ─── Guard #4: Amount+Time Dedup (R1) ──────────────────────────────────────

/**
 * R1: SECONDARY IDEMPOTENCY — amount+time dedup for network retries with new keys.
 * If a terminal retries a payment with a DIFFERENT idempotencyKey (client generated
 * a fresh UUID on retry), the key-based check above won't catch it. This query
 * detects a Payment for the same order with the same amount created in the last 30s.
 * MUST run BEFORE Datacap is called to prevent double-charging the card.
 */
export async function checkAmountTimeDedup(
  tx: TxClient,
  orderId: string,
  payments: PaymentInputForDedup[],
): Promise<GuardResult> {
  const requestedBaseTotal = payments.reduce((sum, p) => sum + p.amount, 0)
  const recentDuplicate = await tx.payment.findFirst({
    where: {
      orderId,
      amount: { gte: requestedBaseTotal - 0.01, lte: requestedBaseTotal + 0.01 },
      createdAt: { gte: new Date(Date.now() - 30000) },
      status: { in: ['completed', 'pending'] },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
  })
  if (recentDuplicate) {
    log.warn({ orderId, existingPaymentId: recentDuplicate.id, amount: requestedBaseTotal }, 'R1: Blocked duplicate payment (amount+time dedup)')
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      duplicate: true,
      orderId,
      paymentId: recentDuplicate.id,
      amount: toNumber(recentDuplicate.amount),
      tipAmount: toNumber(recentDuplicate.tipAmount),
      totalAmount: toNumber(recentDuplicate.totalAmount),
      paymentMethod: recentDuplicate.paymentMethod,
      newOrderBalance: 0,
      remainingBalance: 0,
      message: 'Duplicate payment detected (same amount within 30s window)',
    } }) }
  }
  return null
}

// ─── Guard #5: SAF Duplicate Prevention ────────────────────────────────────

/**
 * SAF2: SAF DUPLICATE PREVENTION — if client retries payment while offline (SAF captures
 * with UUID-X on the reader), then network returns and client retries with UUID-Y, BOTH
 * charges succeed. Detect existing SAF payments for this order to prevent double-charge.
 * This check runs BEFORE Datacap is called so we never send a second authorization.
 */
export async function checkSafDuplicate(
  tx: TxClient,
  orderId: string,
  payments: PaymentInputForDedup[],
): Promise<GuardResult> {
  const hasCardPayment = payments.some(p => p.method === 'credit' || p.method === 'debit')
  if (!hasCardPayment) return null

  const safDuplicate = await tx.payment.findFirst({
    where: {
      orderId,
      deletedAt: null,
      status: 'completed',
      OR: [
        { isOfflineCapture: true },
        { safStatus: { in: ['APPROVED_SAF_PENDING_UPLOAD', 'UPLOAD_PENDING', 'UPLOAD_SUCCESS'] } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true, safStatus: true },
  })
  if (safDuplicate) {
    log.warn(
      { orderId, existingPaymentId: safDuplicate.id, safStatus: safDuplicate.safStatus, amount: toNumber(safDuplicate.amount) },
      'SAF2: Blocked duplicate payment — SAF payment already exists for this order'
    )
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      duplicate: true,
      orderId,
      paymentId: safDuplicate.id,
      amount: toNumber(safDuplicate.amount),
      tipAmount: toNumber(safDuplicate.tipAmount),
      totalAmount: toNumber(safDuplicate.totalAmount),
      paymentMethod: safDuplicate.paymentMethod,
      safStatus: safDuplicate.safStatus,
      newOrderBalance: 0,
      remainingBalance: 0,
      message: 'Duplicate payment detected — SAF (offline) payment already captured for this order',
    } }) }
  }
  return null
}

// ─── Guard #7: Already-Paid Guard ──────────────────────────────────────────

/**
 * Return existing payment if order is already paid/closed/cancelled/voided.
 * For paid/closed, returns success with the last payment. For cancelled/voided, returns error.
 */
export async function checkAlreadyPaid(
  tx: TxClient,
  orderId: string,
  order: {
    status: string
    locationId: string
    total: unknown
    paymentMethod?: string
  },
  bodyPaymentMethod?: string,
): Promise<GuardResult> {
  if (!['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) return null

  if (order.status === 'paid' || order.status === 'closed') {
    // TX-KEEP: COMPLEX — latest payment lookup inside FOR UPDATE lock; no repo method for latest-payment-by-order
    const existingPayment = await tx.payment.findFirst({
      where: { orderId, locationId: order.locationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, amount: true, tipAmount: true, totalAmount: true, paymentMethod: true },
    })
    return { earlyReturn: NextResponse.json({ data: {
      success: true,
      alreadyPaid: true,
      orderId,
      paymentId: existingPayment?.id ?? 'already-paid',
      amount: existingPayment ? toNumber(existingPayment.amount) : toNumber(order.total ?? 0),
      tipAmount: existingPayment ? toNumber(existingPayment.tipAmount) : 0,
      totalAmount: existingPayment ? toNumber(existingPayment.totalAmount) : toNumber(order.total ?? 0),
      paymentMethod: existingPayment?.paymentMethod ?? bodyPaymentMethod ?? 'cash',
      newOrderBalance: 0,
      orderStatus: order.status,
      message: `Order already ${order.status}`,
    } }) }
  }

  return { earlyReturn: NextResponse.json(
    { error: 'Cannot pay an order with status: ' + order.status },
    { status: 400 }
  ) }
}

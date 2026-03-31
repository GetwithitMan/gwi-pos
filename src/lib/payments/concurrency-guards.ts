/**
 * Concurrency Guards — row locks, orphan detection, pending capture dedup.
 *
 * All functions run INSIDE the FOR UPDATE transaction.
 * They protect against double-charges from concurrent terminals and HA failover.
 */

import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { enableSyncReplication } from '@/lib/db-helpers'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('pay-guards')

// ─── Row Lock + Sync Replication ──────────────────────────────────────────

/**
 * Acquire row-level lock on the order and enable sync replication.
 * Returns null on success, or a NextResponse early-exit if order not found.
 */
export async function acquireOrderLock(
  tx: any,
  orderId: string,
): Promise<{ earlyReturn: NextResponse } | null> {
  const [lockedRow] = await tx.$queryRawUnsafe(
    `SELECT id FROM "Order" WHERE id = $1 FOR UPDATE`,
    orderId,
  ) as Array<{ id: string }>
  if (!lockedRow) {
    return { earlyReturn: NextResponse.json({ error: 'Order not found' }, { status: 404 }) }
  }

  // PAYMENT-SAFETY: Synchronous replication for payment durability.
  await enableSyncReplication(tx)
  return null
}

// ─── Orphaned Datacap Sales Detection ─────────────────────────────────────

/**
 * HA FAILOVER PROTECTION: Detect and mark orphaned pending Datacap sales.
 * Uses a savepoint so a missing table doesn't abort the outer transaction.
 */
export async function detectOrphanedSales(
  tx: any,
  orderId: string,
): Promise<void> {
  let orphanedSales: Array<{ id: string; amount: unknown; datacapRecordNo: string | null; invoiceNo: string | null }> = []
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT orphan_check`)
    orphanedSales = await tx.$queryRawUnsafe(
      `SELECT id, amount, "datacapRecordNo", "invoiceNo" FROM "_pending_datacap_sales"
       WHERE "orderId" = $1 AND "status" = 'pending' AND "createdAt" < NOW() - INTERVAL '60 seconds'`,
      orderId,
    ) as typeof orphanedSales
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT orphan_check`)
  } catch {
    // Table may not exist on this NUC -- roll back savepoint to keep transaction alive
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT orphan_check`).catch((err: unknown) => log.warn({ err }, 'savepoint rollback failed'))
  }

  if (orphanedSales.length > 0) {
    console.warn(`[PAY] Found ${orphanedSales.length} orphaned pending Datacap sale(s) for order ${orderId}. These may need manual void.`)
    for (const sale of orphanedSales) {
      await tx.$executeRawUnsafe(
        `UPDATE "_pending_datacap_sales" SET "status" = 'orphaned', "resolvedAt" = NOW() WHERE id = $1`,
        sale.id
      )
    }
  }
}

// ─── SAF Duplicate Prevention ─────────────────────────────────────────────

/**
 * SAF2: Detect existing SAF payments for this order to prevent double-charge.
 * Runs BEFORE Datacap is called so we never send a second authorization.
 */
export async function checkSafDuplicate(
  tx: any,
  orderId: string,
  hasCardPayment: boolean,
): Promise<{ earlyReturn: NextResponse } | null> {
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
    const { toNumber } = await import('@/lib/pricing')
    log.warn(
      { orderId, existingPaymentId: safDuplicate.id, safStatus: safDuplicate.safStatus, amount: toNumber(safDuplicate.amount) },
      'SAF2: Blocked duplicate payment -- SAF payment already exists for this order'
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
      message: 'Duplicate payment detected -- SAF (offline) payment already captured for this order',
    } }) }
  }

  return null
}

// ─── R1: Secondary Idempotency (amount+time dedup) ───────────────────────

/**
 * R1: Detect duplicate payments by amount+time window (30s).
 * Catches network retries with different idempotencyKeys.
 */
export async function checkAmountTimeDedup(
  tx: any,
  orderId: string,
  requestedBaseTotal: number,
): Promise<{ earlyReturn: NextResponse } | null> {
  const { toNumber } = await import('@/lib/pricing')
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

// ─── Pending Capture Lock ─────────────────────────────────────────────────

/**
 * DOUBLE-CHARGE PREVENTION: Lock-and-check on _pending_captures table.
 * Uses a savepoint so a missing table (pre-migration NUCs) doesn't abort the transaction.
 *
 * Returns whether a pending capture record was inserted (for cleanup in catch blocks).
 */
export async function acquirePendingCaptureLock(
  tx: any,
  orderId: string,
  locationId: string,
  finalIdempotencyKey: string,
): Promise<{ earlyReturn: NextResponse } | { inserted: boolean }> {
  try {
    await tx.$executeRawUnsafe(`SAVEPOINT pending_capture_check`)
    const existingPending = await tx.$queryRawUnsafe(
      `SELECT id, status, response_json FROM "_pending_captures" WHERE "idempotencyKey" = $1 LIMIT 1`,
      finalIdempotencyKey
    ) as Array<{ id: string; status: string; response_json: string | null }>

    if (Array.isArray(existingPending) && existingPending.length > 0) {
      const pending = existingPending[0] as any
      if (pending.status === 'processing') {
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pending_capture_check`)
        return { earlyReturn: NextResponse.json(
          { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
          { status: 409 }
        ) }
      }
      if (pending.status === 'completed' && pending.response_json) {
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pending_capture_check`)
        return { earlyReturn: NextResponse.json(
          { error: 'Payment already processed', code: 'DUPLICATE_PAYMENT', existingPayment: JSON.parse(pending.response_json) },
          { status: 409 }
        ) }
      }
      // status is 'failed' or 'pending' without response -- allow retry
      await tx.$executeRawUnsafe(
        `UPDATE "_pending_captures" SET "status" = 'processing', "errorMessage" = NULL WHERE "id" = $1`,
        pending.id
      )
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pending_capture_check`)
      return { inserted: true }
    } else {
      // No existing record -- insert a new one
      const captureId = crypto.randomUUID()
      await tx.$executeRawUnsafe(
        `INSERT INTO "_pending_captures" ("id", "orderId", "locationId", "cardRecordNo", "purchaseAmount", "totalAmount", "status", "idempotencyKey", "createdAt")
         VALUES ($1, $2, $3, '', 0, 0, 'processing', $4, NOW())
         ON CONFLICT ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL DO NOTHING`,
        captureId,
        orderId,
        locationId,
        finalIdempotencyKey
      )
      // Check if our insert won
      const verifyInsert = await tx.$queryRawUnsafe(
        `SELECT id FROM "_pending_captures" WHERE "idempotencyKey" = $1 AND "id" = $2 LIMIT 1`,
        finalIdempotencyKey,
        captureId
      ) as Array<{ id: string }>
      if (Array.isArray(verifyInsert) && verifyInsert.length > 0) {
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pending_capture_check`)
        return { inserted: true }
      } else {
        // Another concurrent request won the insert
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pending_capture_check`)
        return { earlyReturn: NextResponse.json(
          { error: 'Payment is already being processed. Please wait.', code: 'PAYMENT_IN_PROGRESS' },
          { status: 409 }
        ) }
      }
    }
  } catch (pcError) {
    // Table may not exist on pre-migration NUCs
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT pending_capture_check`).catch((err: unknown) => log.warn({ err }, 'savepoint rollback failed'))
    console.warn('[PAY] _pending_captures check failed (table may not exist), proceeding without lock', {
      orderId, error: pcError instanceof Error ? pcError.message : String(pcError),
    })
    return { inserted: false }
  }
}

/**
 * Mark pending capture as 'completed' inside the transaction.
 * Fire-and-forget with savepoint for safety.
 */
export async function completePendingCapture(
  tx: any,
  finalIdempotencyKey: string,
  allPendingPayments: any[],
  orderId: string,
): Promise<void> {
  try {
    const { toNumber } = await import('@/lib/pricing')
    await tx.$executeRawUnsafe(`SAVEPOINT pc_complete`)
    const responseJson = JSON.stringify({
      orderId,
      paymentIds: allPendingPayments.map((r: any) => r.id).filter(Boolean),
      amount: allPendingPayments.reduce((sum: number, r: any) => sum + toNumber(r.amount ?? 0), 0),
    })
    await tx.$executeRawUnsafe(
      `UPDATE "_pending_captures" SET "status" = 'completed', "completedAt" = NOW(), "response_json" = $2
       WHERE "idempotencyKey" = $1 AND "status" = 'processing'`,
      finalIdempotencyKey,
      responseJson
    )
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT pc_complete`)
  } catch {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT pc_complete`).catch((err: unknown) => log.warn({ err }, 'savepoint rollback failed'))
  }
}

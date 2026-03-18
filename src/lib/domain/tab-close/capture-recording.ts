/**
 * Capture Result Recording (Phase 3)
 *
 * recordCaptureFailure: Records a declined/failed capture — increments retry count, auto-walkout.
 * recordCaptureSuccess: Records an approved capture — creates Payment, updates OrderCard + Order.
 *
 * Both are ORCHESTRATION: own DB writes within the caller's transaction.
 */

import type { TxClient, CaptureFailureResult, CaptureSuccessInput } from './types'
import { enableSyncReplication } from '@/lib/db-helpers'
import { emitOrderEvent } from '@/lib/order-events/emitter'

interface BarTabSettings {
  maxCaptureRetries?: number
  autoFlagWalkoutAfterDeclines?: boolean
}

/**
 * Record a capture failure/decline in the database.
 *
 * Tracks the declined capture, increments retry count, and auto-flags
 * walkout if threshold is reached.
 *
 * ORCHESTRATION: Owns DB writes within the caller's transaction.
 */
export async function recordCaptureFailure(
  tx: TxClient,
  orderId: string,
  errorMessage: string,
  barTabSettings: BarTabSettings,
  locationId: string,
  employeeId: string,
): Promise<CaptureFailureResult> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`

  await tx.order.update({
    where: { id: orderId },
    data: {
      tabStatus: 'declined_capture',
      captureDeclinedAt: new Date(),
      captureRetryCount: { increment: 1 },
      lastCaptureError: errorMessage,
    },
  })

  // Check if auto-walkout threshold reached
  const updatedOrder = await tx.order.findUnique({
    where: { id: orderId },
    select: { captureRetryCount: true },
  })

  const maxRetries = barTabSettings.maxCaptureRetries ?? 5
  const retryCount = updatedOrder?.captureRetryCount || 1
  const autoWalkout = barTabSettings.autoFlagWalkoutAfterDeclines ?? false

  // Phase 2: Emit TAB_CAPTURE_DECLINED event alongside direct write
  void emitOrderEvent(locationId, orderId, 'TAB_CAPTURE_DECLINED', {
    employeeId,
    errorMessage,
    retryCount,
    maxRetries,
  })

  if (autoWalkout && updatedOrder && updatedOrder.captureRetryCount >= maxRetries) {
    await tx.order.update({
      where: { id: orderId },
      data: { isWalkout: true, walkoutAt: new Date() },
    })

    // Phase 2: Emit WALKOUT_MARKED event alongside direct write
    void emitOrderEvent(locationId, orderId, 'WALKOUT_MARKED', {
      reason: 'capture_max_retries_exceeded',
      retryCount,
    })
  }

  return { retryCount, maxRetries }
}

/**
 * Record a successful capture in the database.
 * Creates Payment record, updates OrderCard, transitions Order to 'paid',
 * voids remaining authorized cards.
 *
 * PAYMENT-SAFETY: The Datacap capture succeeded. We MUST record it in the DB.
 * The order transitions to 'paid' ONLY inside this transaction, AFTER the
 * Datacap capture response is confirmed as 'Approved'. Never optimistic.
 *
 * Returns the created Payment ID.
 *
 * ORCHESTRATION: Owns DB writes within the caller's transaction.
 */
export async function recordCaptureSuccess(
  tx: TxClient,
  input: CaptureSuccessInput,
): Promise<string> {
  // Acquire row lock for the write phase
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`

  // PAYMENT-SAFETY: Synchronous replication for tab capture durability.
  // Guarantees the standby has applied this transaction's WAL before commit returns.
  await enableSyncReplication(tx)

  // Re-verify order hasn't been closed by another path while we were calling Datacap.
  // The 'closing' status we set in Phase 1 should still be there.
  const currentOrder = await tx.order.findFirst({
    where: { id: input.orderId, deletedAt: null },
    select: { status: true, tabStatus: true },
  })

  if (!currentOrder) {
    throw new Error('Order disappeared between Phase 1 and Phase 3')
  }

  // If order was already paid/closed (shouldn't happen due to 'closing' guard, but safety net)
  if (currentOrder.status === 'paid' || currentOrder.status === 'closed') {
    // Capture already recorded by another path — the Datacap charge happened but
    // someone else closed the tab. Log for reconciliation (possible double-capture).
    console.error('[PAYMENT-SAFETY] Order already closed when recording capture', {
      orderId: input.orderId,
      currentStatus: currentOrder.status,
      capturedAmount: input.totalCaptured,
      authCode: input.authCode,
      datacapRecordNo: input.capturedCard.recordNo,
    })
    throw new Error('Order was already closed — capture recorded for reconciliation')
  }

  // Update OrderCard status to captured
  await tx.orderCard.update({
    where: { id: input.capturedCard.id },
    data: {
      status: 'captured',
      capturedAmount: input.totalCaptured,
      capturedAt: input.now,
      tipAmount: input.tipAmount,
      lastMutatedBy: 'local',
    },
  })

  // Update Order status to paid/closed
  // BUG #456 FIX: Use explicit conditional for tipTotal — 0 is a valid tip amount, not falsy.
  await tx.order.update({
    where: { id: input.orderId },
    data: {
      status: 'paid',
      tabStatus: 'closed',
      paidAt: input.now,
      closedAt: input.now,
      tipTotal: input.tipAmount,
      total: input.totalCaptured,
      version: { increment: 1 },
      lastMutatedBy: 'local',
    },
  })

  // BUG #455: Create Payment record for close-tab capture
  // Use sellingEmployeeId (the selling employee) for sale credit, not the
  // request body's employeeId (the person who physically closed the tab).
  const createdPayment = await tx.payment.create({
    data: {
      locationId: input.locationId,
      orderId: input.orderId,
      employeeId: input.sellingEmployeeId || input.employeeId,
      amount: input.purchaseAmount,
      tipAmount: input.tipAmount,
      totalAmount: input.totalCaptured,
      paymentMethod: input.capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
      cardBrand: input.capturedCard.cardType || 'unknown',
      cardLast4: input.capturedCard.cardLast4,
      authCode: input.authCode || null,
      datacapRecordNo: input.capturedCard.recordNo,
      entryMethod: 'Chip', // Tab was opened with card present
      status: 'completed',
      lastMutatedBy: 'local',
      // Datacap processor metadata from capture response
      acqRefData: input.datacapResponse.acqRefData || null,
      processData: input.datacapResponse.processData || null,
      aid: input.datacapResponse.aid || null,
      cvmResult: input.datacapResponse.cvm ? String(input.datacapResponse.cvm) : null,
      level2Status: input.datacapResponse.level2Status || null,
      tokenFrequency: 'Recurring', // From pre-auth (tab capture)
    },
  })

  // Void any remaining authorized cards
  for (const c of input.allCards.filter(c => c.id !== input.capturedCard.id && c.status === 'authorized')) {
    await tx.orderCard.update({
      where: { id: c.id },
      data: { status: 'voided' },
    })
  }

  // Phase 2: Emit PAYMENT_APPLIED event alongside direct write
  void emitOrderEvent(input.locationId, input.orderId, 'PAYMENT_APPLIED', {
    paymentId: createdPayment.id,
    method: input.capturedCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit',
    amountCents: Math.round(input.purchaseAmount * 100),
    tipCents: Math.round(input.tipAmount * 100),
    totalCents: Math.round(input.totalCaptured * 100),
    cardBrand: input.capturedCard.cardType || null,
    cardLast4: input.capturedCard.cardLast4 || null,
    status: 'approved',
  })

  // Phase 2: Emit ORDER_CLOSED event alongside direct write
  void emitOrderEvent(input.locationId, input.orderId, 'ORDER_CLOSED', {
    closedStatus: 'paid',
  })

  return createdPayment.id
}

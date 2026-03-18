/**
 * Walkout Retry Service
 *
 * Extracted from the route handler so that both the API endpoint
 * and the server.ts scheduler can call it without localhost HTTP.
 *
 * The scheduler calls listPendingRetries + processWalkoutRetry directly,
 * bypassing HTTP auth (trusted context — no employeeId needed).
 *
 * EVENT CHANNEL CONTRACT:
 * This service emits through two independent channels:
 *   1. Socket outbox (queueSocketEvent) — persisted in the same DB transaction.
 *      Authoritative for real-time terminal/UI synchronization.
 *      Crash-durable: recovered by flushAllPendingOutbox() on restart.
 *   2. Order event stream (emitOrderEvents) — emitted after commit.
 *      Authoritative for domain/audit event-sourced truth (OrderEvent table).
 *      Best-effort: a crash between commit and emit loses the event.
 *      Consumers must tolerate missing events (reconcile from snapshots).
 * Both channels are required. Neither is a projection of the other.
 */

// TODO: Refactor to use emitOrderAndSocketEvents() from '@/lib/domain/emit-order-and-socket'
// to enforce the dual-channel contract structurally instead of manually.

import { db } from '@/lib/db'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { parseSettings, DEFAULT_WALKOUT_SETTINGS } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { logger } from '@/lib/logger'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { PaymentProcessedPayload, OrderClosedPayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PendingRetry {
  id: string
  nextRetryAt: string | null
  retryCount: number
  maxRetries: number
}

export interface RetryResult {
  success: boolean
  status?: string
  amount?: number
  authCode?: string
  duplicate?: boolean
  retryCount?: number
  nextRetryAt?: string | null
  error?: string | { code: string; message: string }
}

// ── List ─────────────────────────────────────────────────────────────────────

/**
 * List pending walkout retries for a location.
 */
export async function listPendingRetries(locationId: string): Promise<PendingRetry[]> {
  const retries = await db.walkoutRetry.findMany({
    where: { locationId, status: 'pending', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      nextRetryAt: true,
      retryCount: true,
      maxRetries: true,
    },
  })

  return retries.map(r => ({
    id: r.id,
    nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
    retryCount: r.retryCount,
    maxRetries: r.maxRetries,
  }))
}

// ── Process ──────────────────────────────────────────────────────────────────

/**
 * Process a single walkout retry attempt.
 * Called by both the route handler (with employeeId) and the scheduler (without).
 */
export async function processWalkoutRetry(
  walkoutRetryId: string,
  employeeId?: string,
): Promise<RetryResult> {
  const retry = await db.walkoutRetry.findFirst({
    where: { id: walkoutRetryId, deletedAt: null, status: 'pending' },
  })

  if (!retry) {
    return { success: false, error: 'Walkout retry not found or already resolved' }
  }

  const orderCard = await db.orderCard.findFirst({
    where: { id: retry.orderCardId, deletedAt: null },
    select: { id: true, readerId: true, recordNo: true, cardType: true, cardLast4: true },
  })

  if (!orderCard) {
    return { success: false, error: 'Order card not found' }
  }

  const locationId = retry.locationId
  const settings = parseSettings(await getLocationSettings(locationId))
  const { walkoutRetryFrequencyDays, walkoutMaxRetryDays } = settings.payments

  // Enforce walkout.maxCaptureRetries limit
  const walkoutConfig = settings.walkout ?? DEFAULT_WALKOUT_SETTINGS
  const maxCaptureRetries = walkoutConfig.maxCaptureRetries
  if (retry.retryCount >= maxCaptureRetries) {
    await db.walkoutRetry.update({
      where: { id: walkoutRetryId },
      data: { status: 'exhausted' },
    })
    return {
      success: false,
      status: 'exhausted',
      retryCount: retry.retryCount,
      error: `Maximum retry attempts (${maxCaptureRetries}) reached`,
    }
  }

  try {
    await validateReader(orderCard.readerId, locationId)
    const client = await requireDatacapClient(locationId)

    const response = await client.preAuthCapture(orderCard.readerId, {
      recordNo: orderCard.recordNo,
      purchaseAmount: Number(retry.amount),
    })

    const error = parseError(response)
    const approved = response.cmdStatus === 'Approved'
    const now = new Date()

    if (approved) {
      // Atomic guard — prevent double-charge
      const { count: updatedCount } = await db.walkoutRetry.updateMany({
        where: { id: walkoutRetryId, status: 'pending' },
        data: {
          status: 'collected',
          collectedAt: now,
          lastRetryAt: now,
          retryCount: retry.retryCount + 1,
        },
      })

      if (updatedCount === 0) {
        return { success: true, duplicate: true, status: 'collected', amount: Number(retry.amount) }
      }

      const captureAmount = Number(retry.amount)
      const paymentMethod = orderCard.cardType?.toLowerCase() === 'debit' ? 'debit' : 'credit'

      // Interactive transaction: DB mutations + socket outbox in one atomic unit.
      // If the process crashes after commit, SocketEventLog rows survive and
      // flushAllPendingOutbox() picks them up on restart.
      const createdPayment = await db.$transaction(async (tx) => {
        await tx.orderCard.update({
          where: { id: orderCard.id },
          data: { status: 'captured', capturedAmount: captureAmount, capturedAt: now },
        })
        await tx.order.update({
          where: { id: retry.orderId },
          data: { status: 'paid', tabStatus: 'closed', paidAt: now, closedAt: now },
        })
        const payment = await tx.payment.create({
          data: {
            locationId,
            orderId: retry.orderId,
            employeeId: employeeId || null,
            amount: captureAmount,
            tipAmount: 0,
            totalAmount: captureAmount,
            paymentMethod,
            cardBrand: orderCard.cardType || 'unknown',
            cardLast4: orderCard.cardLast4,
            authCode: response.authCode || null,
            datacapRecordNo: orderCard.recordNo,
            status: 'completed',
          },
        })

        // ── Channel 1: Socket outbox (transactional, crash-durable) ──
        // These queueSocketEvent calls are INSIDE the $transaction. They persist
        // in SocketEventLog atomically with the payment/order updates. If the
        // process crashes after commit, flushAllPendingOutbox() recovers them.
        const paymentPayload: PaymentProcessedPayload = {
          orderId: retry.orderId,
          paymentId: payment.id,
          status: 'approved',
          method: paymentMethod,
          amount: captureAmount,
          tipAmount: 0,
          totalAmount: captureAmount,
          employeeId: employeeId || null,
          isClosed: true,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.PAYMENT_PROCESSED, paymentPayload)

        const closedPayload: OrderClosedPayload = {
          orderId: retry.orderId,
          status: 'paid',
          closedAt: now.toISOString(),
          closedByEmployeeId: employeeId || null,
          locationId,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_CLOSED, closedPayload)

        const listPayload: OrdersListChangedPayload = { trigger: 'paid', orderId: retry.orderId }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)

        return payment
      })

      // Flush socket outbox after commit — best-effort, catch-up handles failures
      void flushSocketOutbox(locationId).catch((err) => {
        console.warn('[walkout-retry] Outbox flush failed, catch-up will deliver:', err)
      })

      // ── Channel 2: Order event stream (post-commit, best-effort) ──
      // These emitOrderEvents calls run AFTER the transaction has committed.
      // They write to the OrderEvent table for event-sourced audit/domain truth.
      // A crash between the commit above and this emit loses these events.
      // Downstream consumers must tolerate gaps and reconcile from snapshots.
      await emitOrderEvents(locationId, retry.orderId, [
        {
          type: 'PAYMENT_APPLIED',
          payload: {
            paymentId: createdPayment.id,
            method: paymentMethod,
            amountCents: Math.round(captureAmount * 100),
            tipCents: 0,
            totalCents: Math.round(captureAmount * 100),
            cardBrand: orderCard.cardType || 'unknown',
            cardLast4: orderCard.cardLast4,
            status: 'approved',
          },
        },
        {
          type: 'ORDER_CLOSED',
          payload: { closedStatus: 'paid' },
        },
      ]).catch((err) => {
        console.error(`[walkout-retry] Failed to emit events for order ${retry.orderId}:`, err)
      })

      return {
        success: true,
        status: 'collected',
        amount: captureAmount,
        authCode: response.authCode,
      }
    } else {
      const nextRetry = new Date(now)
      nextRetry.setDate(nextRetry.getDate() + walkoutRetryFrequencyDays)

      const createdAt = new Date(retry.createdAt)
      const maxDate = new Date(createdAt)
      maxDate.setDate(maxDate.getDate() + walkoutMaxRetryDays)

      const exhausted = nextRetry > maxDate

      await db.walkoutRetry.update({
        where: { id: walkoutRetryId },
        data: {
          retryCount: retry.retryCount + 1,
          lastRetryAt: now,
          lastRetryError: error?.text || response.textResponse || 'Declined',
          status: exhausted ? 'exhausted' : 'pending',
          nextRetryAt: exhausted ? retry.nextRetryAt : nextRetry,
        },
      })

      return {
        success: false,
        status: exhausted ? 'exhausted' : 'pending',
        retryCount: retry.retryCount + 1,
        nextRetryAt: exhausted ? null : nextRetry.toISOString(),
        error: error ? { code: error.code, message: error.text } : undefined,
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Retry failed'

    await db.walkoutRetry.update({
      where: { id: walkoutRetryId },
      data: {
        retryCount: retry.retryCount + 1,
        lastRetryAt: new Date(),
        lastRetryError: errorMsg,
      },
    })

    return { success: false, error: errorMsg }
  }
}

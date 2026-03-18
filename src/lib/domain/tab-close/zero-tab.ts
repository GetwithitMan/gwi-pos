/**
 * Zero-Tab Handling
 *
 * recordZeroTabResult: ORCHESTRATION — owns DB writes within caller's transaction.
 * buildZeroTabResponse: PURE — builds HTTP response data from release results.
 */

import type { TxClient, ZeroTabReleaseResult } from './types'
import { enableSyncReplication } from '@/lib/db-helpers'
import { emitOrderEvent } from '@/lib/order-events/emitter'

/**
 * Record zero-tab release results in the database.
 *
 * C6 FIX: Tracks per-card release status. On partial failure, released cards
 * are marked 'released' and only failed cards stay 'authorized'. On full release,
 * closes the tab. On any failure, reverts to 'open' for retry.
 *
 * ORCHESTRATION: Owns DB writes within the caller's transaction.
 */
export async function recordZeroTabResult(
  tx: TxClient,
  orderId: string,
  releaseResults: ZeroTabReleaseResult[],
  locationId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`
  await enableSyncReplication(tx)

  // C6 FIX: Update each card individually based on its release result
  for (const result of releaseResults) {
    if (result.released) {
      await tx.orderCard.update({
        where: { id: result.cardId },
        data: { status: 'released' },
      })
    }
    // Failed cards stay as 'authorized' — they can be retried or manually voided
  }

  const allReleased = releaseResults.every(r => r.released)

  if (allReleased) {
    // All cards released — close the tab completely
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'voided',
        tabStatus: 'closed',
        paidAt: new Date(),
        closedAt: new Date(),
        version: { increment: 1 },
      },
    })

    // Phase 2: Emit ORDER_CLOSED event alongside direct write
    void emitOrderEvent(locationId, orderId, 'ORDER_CLOSED', {
      closedStatus: 'voided',
    })
  } else {
    // Partial or full failure — revert to 'open' for retry.
    // C6 FIX: Do NOT revert to 'open' because released cards are already gone.
    // Move to 'open' so the tab can be retried, but the already-released
    // cards won't be re-fetched (query filters status: 'authorized' only).
    await tx.order.update({
      where: { id: orderId },
      data: {
        tabStatus: 'open',
        version: { increment: 1 },
      },
    })

    // Phase 2: Emit ORDER_REOPENED event alongside direct write
    void emitOrderEvent(locationId, orderId, 'ORDER_REOPENED', {
      reason: 'card_release_partial_failure',
    })
  }
}

/**
 * Build the HTTP response data for a zero-tab close.
 * PURE — no side effects.
 */
export function buildZeroTabResponse(releaseResults: ZeroTabReleaseResult[]): {
  httpStatus: number
  data: Record<string, unknown>
} {
  const allReleased = releaseResults.every(r => r.released)
  const anyReleased = releaseResults.some(r => r.released)

  const httpStatus = allReleased ? 200 : (anyReleased ? 207 : 400)
  return {
    httpStatus,
    data: {
      success: allReleased,
      partialSuccess: anyReleased && !allReleased,
      zeroTab: true,
      message: allReleased
        ? 'Tab had no charges. Pre-auth released.'
        : anyReleased
          ? 'Tab had no charges. Some cards released, others failed — void remaining cards manually.'
          : 'Tab had no charges. All card releases failed — void the tab manually.',
      releaseResults,
    },
  }
}

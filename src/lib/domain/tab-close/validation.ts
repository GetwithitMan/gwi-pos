/**
 * Tab Close Validation (Phase 1)
 *
 * ORCHESTRATION: Acquires FOR UPDATE lock, validates order state,
 * handles zombie recovery, and marks tab as 'closing'.
 * Takes a TxClient param — owns DB reads/writes within caller's transaction.
 */

import { createChildLogger } from '@/lib/logger'
import type { TxClient, TabCloseInput, TabCloseValidationResult, TabCloseOrder } from './types'

const log = createChildLogger('tab-close')

const ZOMBIE_THRESHOLD_MS = 60_000

/**
 * Phase 1: Validate an order for tab close.
 * Acquires FOR UPDATE lock, checks status guards, handles zombie recovery,
 * and marks tab as 'closing'.
 *
 * ORCHESTRATION: Owns DB reads/writes within the caller's transaction.
 */
export async function validateTabForClose(
  tx: TxClient,
  input: TabCloseInput,
): Promise<TabCloseValidationResult> {
  // Acquire row lock — blocks concurrent close-tab requests for this order
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${input.orderId} FOR UPDATE`

  // Get order with cards
  const order = await tx.order.findFirst({
    where: { id: input.orderId, deletedAt: null },
    include: {
      cards: {
        where: { deletedAt: null, status: 'authorized' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      },
      items: {
        where: { deletedAt: null, status: 'active' },
      },
    },
  })

  if (!order) {
    return { valid: false, error: 'Order not found', status: 404 }
  }

  // Status guard: voided/cancelled
  if (order.status === 'voided' || order.status === 'cancelled') {
    return { valid: false, error: `Cannot close tab on order in '${order.status}' status`, status: 400 }
  }

  // PAYMENT-SAFETY: Double-capture prevention
  if (order.status === 'paid' || order.status === 'closed') {
    return {
      valid: false,
      error: 'Tab already closed',
      status: 200,
      extra: { success: true, duplicate: true, message: 'Tab already closed', tabStatus: 'closed' },
    }
  }

  // EDGE-7: Reject orders stuck in pending_auth
  if (order.tabStatus === 'pending_auth') {
    return {
      valid: false,
      error: 'Cannot close tab while card authorization is in progress. Please wait or retry opening the tab.',
      status: 400,
      extra: { tabStatus: 'pending_auth' },
    }
  }

  // H6 FIX: Recover zombie "closing" state (stuck >60s)
  if (order.tabStatus === 'closing') {
    const lastUpdated = order.updatedAt ? new Date(order.updatedAt).getTime() : 0
    const isZombie = Date.now() - lastUpdated > ZOMBIE_THRESHOLD_MS

    if (isZombie) {
      log.warn({
        orderId: input.orderId,
        lastUpdated: order.updatedAt,
        stuckForMs: Date.now() - lastUpdated,
      }, 'Recovering zombie closing state')
      await tx.order.update({
        where: { id: input.orderId },
        data: { tabStatus: 'open', version: { increment: 1 } },
      })
      order.tabStatus = 'open'
    } else {
      return {
        valid: false,
        error: 'Tab is already being closed by another terminal',
        status: 409,
        extra: { tabStatus: 'closing' },
      }
    }
  }

  // Optimistic concurrency check
  if (input.version != null && order.version !== input.version) {
    return {
      valid: false,
      error: 'Tab was modified on another terminal',
      status: 409,
      extra: { conflict: true, currentVersion: order.version },
    }
  }

  if (order.cards.length === 0) {
    return { valid: false, error: 'No authorized cards on this tab', status: 400 }
  }

  // AUDIT: Empty tab with pre-auth — will release card holds ($0 capture path)
  if (order.items.length === 0 && order.cards.length > 0) {
    log.warn({
      orderId: input.orderId,
      cardCount: order.cards.length,
      employeeId: input.employeeId,
      audit: 'EMPTY_TAB_CLOSE',
    }, 'Order has pre-auth cards but zero items — releasing holds')
  }

  // Mark tab as 'closing' to prevent concurrent close-tab from another terminal.
  // This is the idempotency gate — only one request gets past this point.
  const versionBeforeClose = order.version
  await tx.order.update({
    where: { id: input.orderId },
    data: {
      tabStatus: 'closing',
      version: { increment: 1 },
    },
  })

  return { valid: true, order: order as unknown as TabCloseOrder, versionBeforeClose }
}

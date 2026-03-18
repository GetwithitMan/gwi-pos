/**
 * Stale Order Cleanup Service
 *
 * Extracted from the route handler so that both the API endpoint
 * and the server.ts schedulers can call it without localhost HTTP.
 *
 * EVENT CHANNEL CONTRACT:
 * This service emits through two independent channels:
 *   1. Socket outbox (queueSocketEvent) — persisted in the same DB transaction.
 *      Authoritative for real-time terminal/UI synchronization.
 *      Crash-durable: recovered by flushAllPendingOutbox() on restart.
 *   2. Order event stream (emitOrderEvent) — emitted after commit.
 *      Authoritative for domain/audit event-sourced truth (OrderEvent table).
 *      Best-effort: a crash between commit and emit loses the event.
 *      Consumers must tolerate missing events (reconcile from snapshots).
 * Both channels are required. Neither is a projection of the other.
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderClosedPayload, OrdersListChangedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'

export interface CleanupResult {
  closedCount: number
  cutoffTime: string
  orderIds: string[]
}

export interface CleanupOptions {
  locationId: string
  maxAgeHours?: number
  dryRun?: boolean
}

/**
 * Find and cancel stale $0 draft orders older than the given threshold.
 *
 * @returns The count and IDs of cancelled orders
 */
export async function cleanupStaleOrders(opts: CleanupOptions): Promise<CleanupResult> {
  const { locationId, maxAgeHours = 4, dryRun = false } = opts

  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - maxAgeHours)

  // Find stale draft orders: status='draft' or 'open', total=$0, no items sent, older than cutoff
  // Read from OrderSnapshot (event-sourced projection) — cents-based fields
  const staleOrders = await db.orderSnapshot.findMany({
    where: {
      locationId,
      status: { in: ['draft', 'open'] },
      totalCents: 0,
      subtotalCents: 0,
      sentAt: null,
      paidAmountCents: 0,
      createdAt: { lt: cutoff },
      deletedAt: null,
    },
    select: {
      id: true,
      orderNumber: true,
      createdAt: true,
      itemCount: true,
    },
  })

  // Filter to only truly empty orders (0 items)
  const emptyStaleOrders = staleOrders.filter(o => o.itemCount === 0)

  if (dryRun || emptyStaleOrders.length === 0) {
    return {
      closedCount: emptyStaleOrders.length,
      cutoffTime: cutoff.toISOString(),
      orderIds: emptyStaleOrders.map(o => o.id),
    }
  }

  const now = new Date()
  const ids = emptyStaleOrders.map(o => o.id)
  const reason = `Auto-cancelled: stale $0 draft (older than ${maxAgeHours}h)`

  // Wrap DB mutation + socket outbox in a single transaction for crash safety.
  // If the process crashes after commit, SocketEventLog rows survive and
  // flushAllPendingOutbox() picks them up on restart.
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'cancelled',
        closedAt: now,
        deletedAt: now,
        notes: reason,
      },
    })

    // ── Channel 1: Socket outbox (transactional, crash-durable) ──
    // These queueSocketEvent calls are INSIDE the $transaction. They persist
    // in SocketEventLog atomically with the order update. If the process
    // crashes after commit, flushAllPendingOutbox() recovers them on restart.
    for (const id of ids) {
      const closedPayload: OrderClosedPayload = {
        orderId: id,
        status: 'cancelled',
        closedAt: now.toISOString(),
        closedByEmployeeId: null,
        locationId,
      }
      await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_CLOSED, closedPayload)

      const listPayload: OrdersListChangedPayload = { trigger: 'cancelled', orderId: id }
      await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)
    }

    return updated
  })

  logger.log(`[cleanup-stale-orders] Closed ${result.count} stale draft orders for location ${locationId}`)

  // Flush socket outbox after commit — best-effort, catch-up handles failures
  void flushSocketOutbox(locationId).catch((err) => {
    console.warn('[cleanup-stale-orders] Outbox flush failed, catch-up will deliver:', err)
  })

  // ── Channel 2: Order event stream (post-commit, best-effort) ──
  // These emitOrderEvent calls run AFTER the transaction has committed.
  // They write to the OrderEvent table for event-sourced audit/domain truth.
  // A crash between the commit above and this loop loses these events.
  // Downstream consumers must tolerate gaps and reconcile from snapshots.
  for (const id of ids) {
    await emitOrderEvent(locationId, id, 'ORDER_CLOSED', {
      closedStatus: 'cancelled',
      reason,
    }).catch((err) => {
      console.error(`[cleanup-stale-orders] Failed to emit ORDER_CLOSED event for order ${id}:`, err)
    })
  }

  return {
    closedCount: result.count,
    cutoffTime: cutoff.toISOString(),
    orderIds: ids,
  }
}

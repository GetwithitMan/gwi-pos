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
import { SOCKET_EVENTS } from '@/lib/socket-events'
import { emitOrderAndSocketEvents } from '@/lib/domain/emit-order-and-socket'

export interface CleanupResult {
  closedCount: number
  cutoffTime: string
  orderIds: string[]
}

export interface CleanupOptions {
  locationId: string
  maxAgeHours?: number
  /** Use minutes instead of hours for the stale threshold. Takes precedence over maxAgeHours. */
  maxAgeMinutes?: number
  dryRun?: boolean
  /** Clear tableId on cancelled orders to unblock tables. Default: false. */
  clearTable?: boolean
  /** Override the notes/reason string on closed orders. */
  reason?: string
}

/**
 * Find and cancel stale $0 draft orders older than the given threshold.
 *
 * @returns The count and IDs of cancelled orders
 */
export async function cleanupStaleOrders(opts: CleanupOptions): Promise<CleanupResult> {
  const { locationId, maxAgeHours = 4, maxAgeMinutes, dryRun = false, clearTable = false } = opts

  const cutoff = new Date()
  if (maxAgeMinutes !== undefined) {
    cutoff.setMinutes(cutoff.getMinutes() - maxAgeMinutes)
  } else {
    cutoff.setHours(cutoff.getHours() - maxAgeHours)
  }

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
  const ageLabel = maxAgeMinutes !== undefined ? `${maxAgeMinutes}m` : `${maxAgeHours}h`
  const reason = opts.reason ?? `Auto-cancelled: stale $0 draft (older than ${ageLabel})`

  // Dual-channel emission via unified wrapper: socket outbox (transactional)
  // + order events (post-commit). See emit-order-and-socket.ts for contract.
  const flushFns: Array<() => Promise<void>> = []

  const result = await db.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {
      status: 'cancelled',
      closedAt: now,
      deletedAt: now,
      notes: reason,
    }
    if (clearTable) {
      updateData.tableId = null
    }

    const updated = await tx.order.updateMany({
      where: { id: { in: ids } },
      data: updateData as any,
    })

    for (const id of ids) {
      const { flush } = await emitOrderAndSocketEvents(tx, locationId, id, [
        { socketEvent: SOCKET_EVENTS.ORDER_CLOSED, socketPayload: { orderId: id, status: 'cancelled', closedAt: now.toISOString(), closedByEmployeeId: null, locationId } },
        { socketEvent: SOCKET_EVENTS.ORDERS_LIST_CHANGED, socketPayload: { trigger: 'cancelled', orderId: id } },
      ], [
        { type: 'ORDER_CLOSED', payload: { closedStatus: 'cancelled', reason } },
      ])
      flushFns.push(flush)
    }

    return updated
  })

  logger.log(`[cleanup-stale-orders] Closed ${result.count} stale draft orders (threshold: ${ageLabel}) for location ${locationId}`)

  // Post-commit: flush socket outbox + emit domain events
  for (const flush of flushFns) {
    void flush()
  }

  return {
    closedCount: result.count,
    cutoffTime: cutoff.toISOString(),
    orderIds: ids,
  }
}

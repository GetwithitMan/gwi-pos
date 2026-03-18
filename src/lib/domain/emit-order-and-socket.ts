/**
 * Unified dual-channel event emission.
 * Enforces the invariant: socket outbox (transactional) + order events (post-commit).
 * Use this instead of manually calling queueSocketEvent + emitOrderEvent separately.
 *
 * EVENT CHANNEL CONTRACT:
 *   1. Socket outbox (queueSocketEvent) — persisted in the same DB transaction.
 *      Authoritative for real-time terminal/UI synchronization.
 *      Crash-durable: recovered by flushAllPendingOutbox() on restart.
 *   2. Order event stream (emitOrderEvent) — emitted after commit.
 *      Authoritative for domain/audit event-sourced truth (OrderEvent table).
 *      Best-effort: a crash between commit and emit loses the event.
 *      Consumers must tolerate missing events (reconcile from snapshots).
 * Both channels are required. Neither is a projection of the other.
 *
 * Usage:
 *   const { flush } = await emitOrderAndSocketEvents(tx, locationId, orderId, [
 *     { socketEvent: 'order:closed', socketPayload: { orderId, status: 'paid', ... } },
 *   ], [
 *     { type: 'ORDER_CLOSED', payload: { closedStatus: 'paid' } },
 *   ])
 *   // ... complete the transaction ...
 *   // AFTER commit:
 *   await flush()
 */

import { createChildLogger } from '@/lib/logger'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import type { OrderEventType } from '@/lib/order-events/types'

const log = createChildLogger('event-emission')

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrderSocketEvent {
  /** Socket event name (e.g., 'order:closed', 'orders:list-changed') */
  socketEvent: string
  /** Payload to persist in socket outbox (JSONB) */
  socketPayload: Record<string, unknown>
  /** Optional socket room override. Defaults to `location:{locationId}`. */
  room?: string
}

export interface OrderDomainEvent {
  /** Order event type (e.g., 'ORDER_CLOSED', 'PAYMENT_APPLIED') */
  type: OrderEventType
  /** Domain event payload for the OrderEvent table */
  payload: Record<string, unknown>
}

export interface EmitResult {
  /**
   * Call this AFTER the enclosing $transaction commits.
   * Flushes the socket outbox and emits domain events to the OrderEvent table.
   *
   * Errors are caught and logged — callers should use `void flush()` or
   * `flush().catch(...)` to avoid blocking on post-commit side effects.
   */
  flush: () => Promise<void>
  /** IDs of the SocketEventLog rows created inside the transaction. */
  socketEventLogIds: number[]
}

// ── Main Function ────────────────────────────────────────────────────────────

/**
 * Queue socket events inside the active transaction and return a flush
 * function for post-commit domain event emission.
 *
 * Channel 1 (socket outbox) is written INSIDE the transaction — crash-durable.
 * Channel 2 (order events) is emitted by the returned flush() — best-effort.
 *
 * @param tx            Active Prisma transaction client ($transaction callback argument)
 * @param locationId    Venue location ID
 * @param orderId       Order ID
 * @param socketEvents  Events to persist in socket outbox (transactional)
 * @param domainEvents  Events to emit to order event stream (post-commit)
 * @returns             Object with flush() to call after commit
 */
export async function emitOrderAndSocketEvents(
  tx: any, // Prisma transaction client
  locationId: string,
  orderId: string,
  socketEvents: OrderSocketEvent[],
  domainEvents: OrderDomainEvent[],
): Promise<EmitResult> {
  // ── Channel 1: Socket outbox (transactional, crash-durable) ──
  // These queueSocketEvent calls run INSIDE the $transaction. They persist
  // in SocketEventLog atomically with the business data change. If the
  // process crashes after commit, flushAllPendingOutbox() recovers them.
  const socketEventLogIds: number[] = []
  for (const evt of socketEvents) {
    const id = await queueSocketEvent(tx, locationId, evt.socketEvent, evt.socketPayload, evt.room)
    socketEventLogIds.push(id)
  }

  // Return flush function — caller MUST invoke after the transaction commits.
  const flush = async () => {
    // Flush socket outbox — best-effort, catch-up handles failures
    await flushSocketOutbox(locationId).catch((err) => {
      log.warn(
        { err: err instanceof Error ? err : undefined, locationId },
        'Outbox flush failed, catch-up will deliver',
      )
    })

    // ── Channel 2: Order event stream (post-commit, best-effort) ──
    // These writes go to the OrderEvent table for event-sourced audit/domain truth.
    // A crash between the transaction commit and this point loses these events.
    // Downstream consumers must tolerate gaps and reconcile from snapshots.
    if (domainEvents.length === 1) {
      await emitOrderEvent(
        locationId,
        orderId,
        domainEvents[0].type,
        domainEvents[0].payload,
      ).catch((err) => {
        log.error(
          { err: err instanceof Error ? err : undefined, orderId, eventType: domainEvents[0].type },
          'Failed to emit domain event',
        )
      })
    } else if (domainEvents.length > 1) {
      await emitOrderEvents(
        locationId,
        orderId,
        domainEvents.map((e) => ({ type: e.type, payload: e.payload })),
      ).catch((err) => {
        log.error(
          { err: err instanceof Error ? err : undefined, orderId, eventCount: domainEvents.length },
          'Failed to emit domain events',
        )
      })
    }
  }

  return { flush, socketEventLogIds }
}

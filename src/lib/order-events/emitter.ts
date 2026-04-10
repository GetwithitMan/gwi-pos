/**
 * Order Event Sourcing — Event Emitter
 *
 * Fire-and-forget helper for emitting domain events from existing API routes.
 * Each call:
 *   1. Assigns a globally-ordered serverSequence via Postgres SEQUENCE
 *   2. Inserts an OrderEvent row
 *   3. Broadcasts `order:event` via Socket.IO so Android devices receive it in real-time
 *
 * All errors are caught and logged — callers should use `void emitOrderEvent(...)`
 * to avoid blocking the request on event persistence.
 */

import { Prisma } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
import type { OrderEventType } from './types'

const log = createChildLogger('order-events')

interface EmitOptions {
  /** Originating device ID. Defaults to 'nuc-web'. */
  deviceId?: string
  /** Monotonic counter from the device. Defaults to 0. */
  deviceCounter?: number
  /** Correlation ID for grouping related events. */
  correlationId?: string | null
  /** Schema version for payload evolution. Defaults to 1. */
  schemaVersion?: number
  /** Client-generated event ID. If provided, reused instead of generating a new UUID. */
  clientEventId?: string
}

/**
 * Insert an event row inside an existing Prisma transaction.
 * Use for critical events that MUST be atomically committed with business writes
 * (e.g. ORDER_SENT inside the send transaction).
 *
 * After commit, call broadcastOrderEvent() to push to connected clients.
 */
export async function insertOrderEventTx(
  tx: any,
  locationId: string,
  orderId: string,
  type: OrderEventType,
  payload: Record<string, unknown>,
  opts?: EmitOptions
): Promise<{ eventId: string; serverSequence: number; deviceId: string; deviceCounter: number }> {
  const eventId = opts?.clientEventId ?? crypto.randomUUID()
  const deviceId = opts?.deviceId ?? 'nuc-web'
  const deviceCounter = opts?.deviceCounter ?? 0

  const [seqRow] = await tx.$queryRaw<{ nextval: bigint | number }[]>(
    Prisma.sql`SELECT nextval('order_event_server_seq')`
  )
  const serverSequence = Number(seqRow.nextval)

  await tx.orderEvent.create({
    data: {
      eventId, orderId, locationId, deviceId, deviceCounter, serverSequence,
      type, payloadJson: payload as any,
      schemaVersion: opts?.schemaVersion ?? 1,
      correlationId: opts?.correlationId ?? null,
      deviceCreatedAt: new Date(),
    },
  })

  return { eventId, serverSequence, deviceId, deviceCounter }
}

/**
 * Broadcast a previously-inserted event to connected clients via Socket.IO.
 * Fire-and-forget safe — call after the transaction commits.
 */
export function broadcastOrderEvent(
  locationId: string,
  orderId: string,
  result: { eventId: string; serverSequence: number; deviceId: string; deviceCounter: number },
  type: OrderEventType,
  payload: Record<string, unknown>,
): void {
  void emitToLocation(locationId, 'order:event', {
    eventId: result.eventId,
    orderId,
    serverSequence: result.serverSequence,
    type,
    payload,
    deviceId: result.deviceId,
    deviceCounter: result.deviceCounter,
  }).catch(err => log.warn({ err }, 'broadcast failed in order-events.emitter'))
}

/**
 * Emit a single domain event. Fire-and-forget safe.
 *
 * For critical events that must be atomically committed with business logic,
 * use insertOrderEventTx() + broadcastOrderEvent() instead.
 *
 * Usage in an API route:
 * ```ts
 * void emitOrderEvent(locationId, orderId, 'ITEM_ADDED', {
 *   lineItemId: item.id, menuItemId: item.menuItemId, name: item.name,
 *   priceCents: Number(item.price) * 100, quantity: item.quantity,
 *   isHeld: false, soldByWeight: false,
 * })
 * ```
 *
 * For idempotent event sourcing, pass `opts.clientEventId` to reuse the client's eventId
 * instead of generating a new UUID. This ensures server echoes have the same eventId as
 * the client's optimistic inserts, enabling proper deduplication via Room's INSERT OR IGNORE.
 */
export async function emitOrderEvent(
  locationId: string,
  orderId: string,
  type: OrderEventType,
  payload: Record<string, unknown>,
  opts?: EmitOptions
): Promise<{ eventId: string; serverSequence: number } | null> {
  try {
    // Reuse client eventId if provided (for idempotency), otherwise generate new UUID
    const eventId = opts?.clientEventId ?? crypto.randomUUID()
    const deviceId = opts?.deviceId ?? 'nuc-web'
    const deviceCounter = opts?.deviceCounter ?? 0

    // Assign serverSequence atomically via Postgres SEQUENCE
    const [seqRow] = await db.$queryRaw<
      { nextval: bigint | number }[]
    >(Prisma.sql`SELECT nextval('order_event_server_seq')`)
    const serverSequence = Number(seqRow.nextval)

    // Insert the event
    await db.orderEvent.create({
      data: {
        eventId,
        orderId,
        locationId,
        deviceId,
        deviceCounter,
        serverSequence,
        type,
        payloadJson: payload as any,
        schemaVersion: opts?.schemaVersion ?? 1,
        correlationId: opts?.correlationId ?? null,
        deviceCreatedAt: new Date(),
      },
    })

    // Broadcast to all terminals in this location
    void emitToLocation(locationId, 'order:event', {
      eventId,
      orderId,
      serverSequence,
      type,
      payload,
      deviceId,
      deviceCounter,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in order-events.emitter'))

    return { eventId, serverSequence }
  } catch (err) {
    log.error({ err: err }, `[order-events/emitter] Failed to emit ${type} for order ${orderId}:`)
    return null
  }
}

/**
 * Emit multiple domain events for the same order in sequence.
 * Each event gets its own serverSequence (ordered).
 * Fire-and-forget safe.
 *
 * Usage:
 * ```ts
 * void emitOrderEvents(locationId, orderId, [
 *   { type: 'ORDER_CREATED', payload: { ... } },
 *   { type: 'ITEM_ADDED', payload: { ... } },
 *   { type: 'ITEM_ADDED', payload: { ... } },
 * ])
 * ```
 */
export async function emitOrderEvents(
  locationId: string,
  orderId: string,
  events: Array<{
    type: OrderEventType
    payload: Record<string, unknown>
  }>,
  opts?: EmitOptions
): Promise<void> {
  // Sequential loop — each event must get a monotonically increasing
  // serverSequence number. Promise.all would race and produce out-of-order sequences.
  for (const evt of events) {
    await emitOrderEvent(locationId, orderId, evt.type, evt.payload, opts)
  }
}

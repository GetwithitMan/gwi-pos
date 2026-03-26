import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('socket-ack')

/**
 * Socket Acknowledgment Queue — QoS 1 for Critical Events
 *
 * For financial events (payment processed, order closed, tab closed), we need
 * at-least-once delivery. This queue tracks unacknowledged events and retries
 * them until the client confirms receipt or a timeout expires.
 *
 * Design:
 * - Server emits event with a unique `_ackId`
 * - Client must emit `ack` with the same `_ackId` within 10 seconds
 * - If no ack received, retry up to 3 times (2s, 4s, 8s intervals)
 * - After max retries, log a warning (event was best-effort delivered)
 * - Queue auto-cleans expired entries every 30 seconds
 *
 * Per-client tracking (F-04):
 * - When targetSocketIds are provided, each socket must ack independently
 * - Retries only target sockets that haven't acked yet
 * - When a socket disconnects, it's removed from pending acks
 *   (it will receive the event via catch-up on reconnect)
 */

interface PendingAck {
  ackId: string
  locationId: string
  room: string
  event: string
  data: unknown
  /** Sockets that haven't acked yet. Empty set = legacy room-level ack. */
  unackedSocketIds: Set<string>
  attempts: number
  maxAttempts: number
  nextRetryAt: number
  createdAt: number
}

const pendingAcks = new Map<string, PendingAck>()
const MAX_ATTEMPTS = 3
const BASE_RETRY_MS = 2000 // 2s, 4s, 8s (exponential)
const ACK_TIMEOUT_MS = 30_000 // 30s max lifetime

let ackCounter = 0

/**
 * Enqueue a critical event for acknowledged delivery.
 * Returns the ackId that the client must send back.
 *
 * @param targetSocketIds  If provided, tracks ack per-socket. Each socket in
 *                         the set must independently ack. If omitted, any single
 *                         ack removes the entry (legacy room-level behavior).
 */
export function enqueueAck(
  locationId: string,
  room: string,
  event: string,
  data: unknown,
  targetSocketIds?: Set<string>,
): string {
  const ackId = `ack_${locationId}_${++ackCounter}_${Date.now()}`
  pendingAcks.set(ackId, {
    ackId,
    locationId,
    room,
    event,
    data,
    unackedSocketIds: targetSocketIds ? new Set(targetSocketIds) : new Set(),
    attempts: 1, // First attempt already sent
    maxAttempts: MAX_ATTEMPTS,
    nextRetryAt: Date.now() + BASE_RETRY_MS,
    createdAt: Date.now(),
  })
  return ackId
}

/**
 * Mark an event as acknowledged by a specific socket.
 * When all tracked sockets have acked, the entry is removed.
 *
 * @param ackId    The acknowledgment ID
 * @param socketId The socket that sent the ack (optional for backward compat)
 */
export function acknowledgeEvent(ackId: string, socketId?: string): boolean {
  const pending = pendingAcks.get(ackId)
  if (!pending) return false

  // Per-socket tracking: remove this socket from unacked set
  if (socketId && pending.unackedSocketIds.size > 0) {
    pending.unackedSocketIds.delete(socketId)
    if (pending.unackedSocketIds.size === 0) {
      pendingAcks.delete(ackId) // All sockets acked — fully delivered
    }
    return true
  }

  // Legacy: no per-socket tracking or no socketId provided — single ack clears
  pendingAcks.delete(ackId)
  return true
}

/**
 * Remove a socket from all pending ack tracking.
 * Called when a socket disconnects — it can't ack after disconnecting.
 * The event will be delivered via catch-up when it reconnects.
 */
export function removeSocketFromAcks(socketId: string): void {
  for (const [ackId, pending] of pendingAcks) {
    // Only auto-delete if this socket was actually being tracked per-client.
    // Set.delete() returns true if the element existed — false for legacy entries
    // (empty set, room-level ack) which must NOT be prematurely deleted.
    const wasTracked = pending.unackedSocketIds.delete(socketId)
    if (wasTracked && pending.unackedSocketIds.size === 0) {
      // All tracked sockets have now acked or disconnected.
      // Catch-up handles reconnecting clients.
      pendingAcks.delete(ackId)
    }
  }
}

/**
 * Get events that need retrying (past their retry deadline).
 * Called by the retry interval.
 *
 * Returns unacked socket IDs so the caller can target retries per-socket
 * instead of broadcasting to the whole room.
 */
export function getRetryableEvents(): Array<PendingAck & { retrySocketIds: string[] }> {
  const now = Date.now()
  const retryable: Array<PendingAck & { retrySocketIds: string[] }> = []

  for (const [ackId, pending] of pendingAcks) {
    // Expired — remove and warn
    if (now - pending.createdAt > ACK_TIMEOUT_MS) {
      log.warn('[socket-ack] Event expired without acknowledgment', {
        ackId,
        event: pending.event,
        locationId: pending.locationId,
        attempts: pending.attempts,
        unackedCount: pending.unackedSocketIds.size,
      })
      pendingAcks.delete(ackId)
      continue
    }

    // Ready for retry
    if (now >= pending.nextRetryAt && pending.attempts < pending.maxAttempts) {
      retryable.push({
        ...pending,
        retrySocketIds: pending.unackedSocketIds.size > 0
          ? Array.from(pending.unackedSocketIds)
          : [], // Empty = legacy room-level retry
      })
    }
  }

  return retryable
}

/**
 * Mark a retry attempt. Updates the next retry time with exponential backoff.
 */
export function markRetryAttempt(ackId: string): void {
  const pending = pendingAcks.get(ackId)
  if (!pending) return
  pending.attempts++
  pending.nextRetryAt = Date.now() + BASE_RETRY_MS * Math.pow(2, pending.attempts - 1)
}

/** Get queue size for monitoring */
export function getQueueSize(): number {
  return pendingAcks.size
}

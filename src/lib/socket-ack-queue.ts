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
 */

interface PendingAck {
  ackId: string
  locationId: string
  room: string
  event: string
  data: unknown
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
 */
export function enqueueAck(
  locationId: string,
  room: string,
  event: string,
  data: unknown,
): string {
  const ackId = `ack_${locationId}_${++ackCounter}_${Date.now()}`
  pendingAcks.set(ackId, {
    ackId,
    locationId,
    room,
    event,
    data,
    attempts: 1, // First attempt already sent
    maxAttempts: MAX_ATTEMPTS,
    nextRetryAt: Date.now() + BASE_RETRY_MS,
    createdAt: Date.now(),
  })
  return ackId
}

/**
 * Mark an event as acknowledged. Called when client sends `ack` event.
 */
export function acknowledgeEvent(ackId: string): boolean {
  return pendingAcks.delete(ackId)
}

/**
 * Get events that need retrying (past their retry deadline).
 * Called by the retry interval.
 */
export function getRetryableEvents(): PendingAck[] {
  const now = Date.now()
  const retryable: PendingAck[] = []

  for (const [ackId, pending] of pendingAcks) {
    // Expired — remove and warn
    if (now - pending.createdAt > ACK_TIMEOUT_MS) {
      log.warn('[socket-ack] Event expired without acknowledgment', {
        ackId,
        event: pending.event,
        locationId: pending.locationId,
        attempts: pending.attempts,
      })
      pendingAcks.delete(ackId)
      continue
    }

    // Ready for retry
    if (now >= pending.nextRetryAt && pending.attempts < pending.maxAttempts) {
      retryable.push(pending)
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

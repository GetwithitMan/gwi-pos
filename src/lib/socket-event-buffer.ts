/**
 * Socket Event Buffer — Server-Side Event Replay for Reconnection Catch-Up
 *
 * Stores recent socket events per locationId in a circular buffer so that
 * clients reconnecting after a brief disconnect can catch up on missed events.
 *
 * Design constraints:
 * - In-memory only (no DB persistence — events are ephemeral UI updates)
 * - Max 1000 events per location, max 5 minutes TTL
 * - Events are location-scoped (multi-tenant isolation)
 * - Cleanup runs every 60 seconds to prevent memory growth
 */

export interface BufferedEvent {
  eventId: number
  event: string
  data: unknown
  room: string
  timestamp: number
}

const MAX_BUFFER_SIZE = 1000
const MAX_BUFFER_AGE_MS = 5 * 60 * 1000 // 5 minutes

/** Per-location circular buffer */
const locationBuffers = new Map<string, {
  events: BufferedEvent[]
  nextId: number
}>()

/**
 * Record an emitted event in the buffer.
 * Called by socket-server.ts emit functions after successful emission.
 * Returns the assigned eventId.
 */
export function recordEvent(locationId: string, event: string, data: unknown, room: string): number {
  let buffer = locationBuffers.get(locationId)
  if (!buffer) {
    buffer = { events: [], nextId: 1 }
    locationBuffers.set(locationId, buffer)
  }

  const eventId = buffer.nextId++
  buffer.events.push({ eventId, event, data, room, timestamp: Date.now() })

  // Evict old events (size cap + TTL)
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS
  while (
    buffer.events.length > MAX_BUFFER_SIZE ||
    (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff)
  ) {
    buffer.events.shift()
  }

  return eventId
}

/**
 * Get events since a given eventId, filtered to the rooms the client is subscribed to.
 * Used on reconnection to replay missed events.
 */
export function getEventsSince(
  locationId: string,
  afterEventId: number,
  subscribedRooms: string[]
): BufferedEvent[] {
  const buffer = locationBuffers.get(locationId)
  if (!buffer) return []

  const roomSet = new Set(subscribedRooms)
  return buffer.events.filter(
    e => e.eventId > afterEventId && roomSet.has(e.room)
  )
}

/**
 * Get the current highest eventId for a location.
 * Clients use this on initial connect to establish their baseline.
 */
export function getLatestEventId(locationId: string): number {
  const buffer = locationBuffers.get(locationId)
  if (!buffer || buffer.events.length === 0) return 0
  return buffer.events[buffer.events.length - 1].eventId
}

/** Periodic cleanup of stale location buffers */
function cleanupBuffers(): void {
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS
  for (const [locationId, buffer] of locationBuffers) {
    // Remove expired events
    while (buffer.events.length > 0 && buffer.events[0].timestamp < cutoff) {
      buffer.events.shift()
    }
    // Remove empty buffers
    if (buffer.events.length === 0) {
      locationBuffers.delete(locationId)
    }
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(cleanupBuffers, 60_000) // Every 60 seconds
}

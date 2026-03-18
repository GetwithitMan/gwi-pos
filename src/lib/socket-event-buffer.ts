import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('socket-event-buffer')

/**
 * Socket Event Buffer — Server-Side Event Replay for Reconnection Catch-Up
 *
 * L1: In-memory circular buffer (fast, volatile)
 * L2: PG SocketEventLog table (persistent, survives restarts)
 *
 * Design constraints:
 * - Max 1000 events per location in-memory, max 5 minutes TTL
 * - Events are location-scoped (multi-tenant isolation)
 * - PG writes are fire-and-forget (never block the hot path)
 * - If PG is down, in-memory buffer still works exactly as before
 * - Cleanup runs every 5 minutes (in-memory + PG pruning)
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
const SOCKET_EVENT_TTL_MINUTES = 30
const SOCKET_EVENT_CLEANUP_INTERVAL_MS = 300_000 // 5 minutes

/** Lazy DB reference to avoid circular imports */
let dbRef: any = null
async function getDb() {
  if (!dbRef) {
    const { masterClient } = await import('./db')
    dbRef = masterClient
  }
  return dbRef
}

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

  // Evict old events (TTL + size cap) — single splice instead of repeated shift()
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS
  let removeCount = 0
  while (removeCount < buffer.events.length && buffer.events[removeCount].timestamp < cutoff) {
    removeCount++
  }
  if (buffer.events.length - removeCount > MAX_BUFFER_SIZE) {
    removeCount = buffer.events.length - MAX_BUFFER_SIZE
  }
  if (removeCount > 0) {
    buffer.events.splice(0, removeCount) // Single O(n) operation instead of removeCount * O(n)
  }

  // Fire-and-forget PG persistence (non-blocking)
  void (async () => {
    try {
      const db = await getDb()
      await db.$executeRawUnsafe(
        `INSERT INTO "SocketEventLog" ("locationId", event, data, room, status, "createdAt") VALUES ($1, $2, $3::jsonb, $4, 'sent', NOW())`,
        locationId, event, JSON.stringify(data), room
      )
    } catch (err) {
      // PG down or table doesn't exist — in-memory buffer still works
      log.warn('[SocketEventLog] PG write failed (in-memory only):', err instanceof Error ? err.message : err)
    }
  })().catch((err) => log.error({ err }, 'socket event buffer init failed'))

  return eventId
}

/**
 * Get events since a given eventId, filtered to the rooms the client is subscribed to.
 * Used on reconnection to replay missed events.
 * Falls back to PG if in-memory buffer doesn't cover the requested range (e.g. post-restart).
 */
export async function getEventsSince(
  locationId: string,
  afterEventId: number,
  subscribedRooms: string[]
): Promise<BufferedEvent[]> {
  const buffer = locationBuffers.get(locationId)
  const roomSet = new Set(subscribedRooms)

  // Try in-memory first
  if (buffer && buffer.events.length > 0) {
    const oldestInMemory = buffer.events[0].eventId
    if (afterEventId >= oldestInMemory) {
      // Fully covered by in-memory buffer
      return buffer.events.filter(
        e => e.eventId > afterEventId && roomSet.has(e.room)
      )
    }
  }

  // Fall back to PG (post-restart or events older than in-memory)
  try {
    const db = await getDb()
    const rows: Array<{
      id: bigint
      event: string
      data: unknown
      room: string
      createdAt: Date
    }> = await db.$queryRawUnsafe(
      `SELECT id, event, data, room, "createdAt" FROM "SocketEventLog" WHERE "locationId" = $1 AND id > $2 ORDER BY id ASC LIMIT 1000`,
      locationId, afterEventId
    )

    const pgEvents: BufferedEvent[] = rows
      .filter((r: { room: string }) => roomSet.has(r.room))
      .map((r: { id: bigint; event: string; data: unknown; room: string; createdAt: Date }) => ({
        eventId: Number(r.id),
        event: r.event,
        data: r.data,
        room: r.room,
        timestamp: r.createdAt instanceof Date ? r.createdAt.getTime() : Date.now(),
      }))

    // Merge with any in-memory events that are newer
    if (buffer && buffer.events.length > 0) {
      const maxPgId = pgEvents.length > 0 ? pgEvents[pgEvents.length - 1].eventId : afterEventId
      const inMemoryNewer = buffer.events.filter(
        e => e.eventId > maxPgId && roomSet.has(e.room)
      )
      return [...pgEvents, ...inMemoryNewer]
    }

    return pgEvents
  } catch (err) {
    log.warn('[SocketEventLog] PG read failed, using in-memory only:', err instanceof Error ? err.message : err)
    // Fall back to whatever is in memory
    if (!buffer) return []
    return buffer.events.filter(
      e => e.eventId > afterEventId && roomSet.has(e.room)
    )
  }
}

/**
 * Get the current highest eventId for a location.
 * Clients use this on initial connect to establish their baseline.
 * Post-restart: falls back to PG max(id) so clients don't reset to 0.
 */
export async function getLatestEventId(locationId: string): Promise<number> {
  const buffer = locationBuffers.get(locationId)
  if (buffer && buffer.events.length > 0) {
    return buffer.events[buffer.events.length - 1].eventId
  }

  // Post-restart: check PG
  try {
    const db = await getDb()
    const rows: Array<{ max_id: bigint | null }> = await db.$queryRawUnsafe(
      `SELECT MAX(id) as max_id FROM "SocketEventLog" WHERE "locationId" = $1`,
      locationId
    )
    const maxId = rows[0]?.max_id
    if (maxId !== null && maxId !== undefined) {
      const id = Number(maxId)
      // Initialize in-memory buffer nextId so new events get IDs after the PG max
      if (!locationBuffers.has(locationId)) {
        locationBuffers.set(locationId, { events: [], nextId: id + 1 })
      } else {
        const buf = locationBuffers.get(locationId)!
        if (buf.nextId <= id) buf.nextId = id + 1
      }
      return id
    }
  } catch {
    // PG unavailable — return 0
  }

  return 0
}

/** Periodic cleanup of stale location buffers */
function cleanupBuffers(): void {
  const cutoff = Date.now() - MAX_BUFFER_AGE_MS
  for (const [locationId, buffer] of locationBuffers) {
    // Remove expired events — single splice instead of repeated shift()
    let removeCount = 0
    while (removeCount < buffer.events.length && buffer.events[removeCount].timestamp < cutoff) {
      removeCount++
    }
    if (removeCount > 0) {
      buffer.events.splice(0, removeCount)
    }
    // Remove empty buffers
    if (buffer.events.length === 0) {
      locationBuffers.delete(locationId)
    }
  }
}

async function cleanupAll(): Promise<void> {
  // Clean in-memory buffers (existing logic)
  cleanupBuffers()

  // Clean PG (DELETE with LIMIT to avoid locking)
  try {
    const db = await getDb()
    await db.$executeRawUnsafe(
      `DELETE FROM "SocketEventLog" WHERE id IN (
        SELECT id FROM "SocketEventLog" WHERE "createdAt" < NOW() - ($1 || ' minutes')::INTERVAL LIMIT 5000
      )`,
      String(SOCKET_EVENT_TTL_MINUTES),
    )
  } catch {
    // PG cleanup failed — non-critical
  }
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => void cleanupAll().catch((err) => log.error({ err }, 'socket event cleanup failed')), SOCKET_EVENT_CLEANUP_INTERVAL_MS)
}

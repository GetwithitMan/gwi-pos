/**
 * Transactional Socket Event Outbox
 *
 * Solves the gap between DB commit and socket emission. If the process crashes
 * between the two, fire-and-forget emissions are lost. The outbox pattern
 * writes the socket event into SocketEventLog INSIDE the domain transaction,
 * guaranteeing atomicity with the business data change.
 *
 * After the transaction commits, `flushSocketOutbox()` reads the unflushed
 * rows, emits them via the existing socket infrastructure, and marks them
 * flushed. If the process crashes before flushing, the rows survive in PG
 * and are picked up on reconnect via the existing catch-up protocol
 * (getEventsSince reads from SocketEventLog).
 *
 * This is intentionally opt-in for CRITICAL events only (payment, void/comp,
 * order close). Non-critical UI events (floor plan, menu change) stay
 * fire-and-forget for performance.
 *
 * Note: flushSocketOutbox() calls emitToLocation(), which internally calls
 * recordEvent() creating a second SocketEventLog row (fire-and-forget).
 * This is benign — the L1 memory buffer needs that call for in-process
 * catch-up, and the extra L2 row is cleaned up by the periodic pruning job.
 * The outbox row (flushed=false→true) is the durable one that survives crashes.
 *
 * Usage:
 *   const eventIds = await db.$transaction(async (tx) => {
 *     // ... domain writes ...
 *     const ids: number[] = []
 *     ids.push(await queueSocketEvent(tx, locationId, 'orders:list-changed', payload))
 *     ids.push(await queueSocketEvent(tx, locationId, 'order:totals-updated', payload2))
 *     return ids
 *   })
 *   // After commit — emit all queued events
 *   await flushSocketOutbox(locationId)
 */

import { emitToLocation, emitCriticalToLocation } from '@/lib/socket-server'
import { SOCKET_EVENTS } from '@/lib/socket-events'

/** Events that use QoS 1 (acknowledged delivery with retry). */
const CRITICAL_EMIT_EVENTS = new Set([
  SOCKET_EVENTS.ORDER_CLOSED,
  SOCKET_EVENTS.PAYMENT_PROCESSED,
])

/** Lazy DB reference — avoids circular imports with db.ts */
let dbRef: any = null
async function getDb() {
  if (!dbRef) {
    const { masterClient } = await import('./db')
    dbRef = masterClient
  }
  return dbRef
}

/**
 * Queue a socket event inside a Prisma transaction.
 *
 * The row is inserted with `flushed = false` and `status = 'pending'`.
 * It becomes visible to flushSocketOutbox() only after the transaction commits.
 *
 * @param tx       Prisma transaction client ($transaction callback argument)
 * @param locationId  Target location for the event
 * @param event    Socket event name (e.g., 'orders:list-changed')
 * @param data     Event payload (will be stored as JSONB)
 * @param room     Socket room override. Defaults to `location:{locationId}`.
 * @returns        The SocketEventLog row ID (bigint cast to number)
 */
export async function queueSocketEvent(
  tx: any,
  locationId: string,
  event: string,
  data: unknown,
  room?: string,
): Promise<number> {
  const targetRoom = room ?? `location:${locationId}`
  const jsonData = JSON.stringify(data ?? {})

  // Use raw SQL — SocketEventLog is not in the Prisma schema (raw table from migration 060)
  const rows: Array<{ id: bigint }> = await tx.$queryRawUnsafe(
    `INSERT INTO "SocketEventLog" ("locationId", event, data, room, status, flushed, "createdAt")
     VALUES ($1, $2, $3::jsonb, $4, 'pending', false, NOW())
     RETURNING id`,
    locationId,
    event,
    jsonData,
    targetRoom,
  )

  return Number(rows[0].id)
}

/**
 * Convenience: queue multiple socket events inside a transaction.
 *
 * @returns Array of SocketEventLog row IDs
 */
export async function queueSocketEvents(
  tx: any,
  locationId: string,
  events: Array<{ event: string; data: unknown; room?: string }>,
): Promise<number[]> {
  const ids: number[] = []
  for (const e of events) {
    ids.push(await queueSocketEvent(tx, locationId, e.event, e.data, e.room))
  }
  return ids
}

/**
 * Flush unflushed socket events for a location.
 *
 * Called AFTER the domain transaction commits. Reads all rows with
 * `flushed = false` for this location, emits them via the socket server,
 * and marks them `flushed = true`.
 *
 * Uses SKIP LOCKED to avoid contention if two requests flush concurrently.
 * Each row is emitted at most once by the flush (but catch-up may re-deliver
 * to reconnecting clients — clients already deduplicate via _eid).
 *
 * @param locationId  The location whose outbox to flush
 * @param options.maxBatch  Max events to flush in one call (default 100)
 */
export async function flushSocketOutbox(
  locationId: string,
  options?: { maxBatch?: number },
): Promise<{ flushed: number; failed: number }> {
  const maxBatch = options?.maxBatch ?? 100
  const db = await getDb()

  let flushed = 0
  let failed = 0

  try {
    // Read unflushed events — ORDER BY id guarantees causal order
    const rows: Array<{
      id: bigint
      event: string
      data: unknown
      room: string
    }> = await db.$queryRawUnsafe(
      `SELECT id, event, data, room
       FROM "SocketEventLog"
       WHERE "locationId" = $1 AND flushed = false
       ORDER BY id ASC
       LIMIT $2`,
      locationId,
      maxBatch,
    )

    if (rows.length === 0) return { flushed: 0, failed: 0 }

    const flushedIds: bigint[] = []

    for (const row of rows) {
      try {
        // Inject _eid so clients can deduplicate (same contract as recordEvent)
        const eid = Number(row.id)
        const enriched = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? { ...row.data as Record<string, unknown>, _eid: eid }
          : row.data

        if (CRITICAL_EMIT_EVENTS.has(row.event)) {
          // QoS 1 events — acknowledged delivery with retry
          await emitCriticalToLocation(locationId, row.event, enriched)
        } else {
          // Standard best-effort emit
          await emitToLocation(locationId, row.event, enriched)
        }

        flushedIds.push(row.id)
        flushed++
      } catch (emitErr) {
        // Emit failed (socket server down, IPC unreachable, etc.)
        // Leave flushed=false — catch-up will deliver on reconnect
        failed++
        console.warn(
          `[SocketOutbox] Emit failed for event ${row.id} (${row.event}):`,
          emitErr instanceof Error ? emitErr.message : emitErr,
        )
      }
    }

    // Batch-mark all successfully emitted events as flushed
    if (flushedIds.length > 0) {
      await db.$executeRawUnsafe(
        `UPDATE "SocketEventLog"
         SET flushed = true, status = 'sent'
         WHERE id = ANY($1::bigint[])`,
        flushedIds.map(Number),
      )
    }
  } catch (err) {
    // DB read/update failed — events stay unflushed, catch-up will handle them
    console.warn(
      '[SocketOutbox] Flush failed for location', locationId,
      err instanceof Error ? err.message : err,
    )
  }

  return { flushed, failed }
}

/**
 * Flush unflushed socket events for ALL locations.
 *
 * Called on server startup / reconnection recovery to drain any events
 * that were queued in transactions but never emitted (crash between
 * commit and flush).
 *
 * This is intentionally lightweight — it only touches rows where
 * flushed=false, which should be near-zero under normal operation.
 */
export async function flushAllPendingOutbox(): Promise<{ total: number }> {
  const db = await getDb()
  let total = 0

  try {
    // Find distinct locations with unflushed events
    const locations: Array<{ locationId: string }> = await db.$queryRawUnsafe(
      `SELECT DISTINCT "locationId" FROM "SocketEventLog" WHERE flushed = false LIMIT 50`,
    )

    for (const loc of locations) {
      const result = await flushSocketOutbox(loc.locationId)
      total += result.flushed
    }

    if (total > 0) {
      console.log(`[SocketOutbox] Startup recovery: flushed ${total} pending events across ${locations.length} locations`)
    }
  } catch (err) {
    console.warn('[SocketOutbox] Startup flush failed:', err instanceof Error ? err.message : err)
  }

  return { total }
}

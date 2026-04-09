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

import { Prisma } from '@/generated/prisma/client'
import { emitToLocation, emitCriticalToLocation, emitToTags } from '@/lib/socket-server'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('socket-outbox')

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
  const rows: Array<{ id: bigint }> = await tx.$queryRaw(
    Prisma.sql`INSERT INTO "SocketEventLog" ("locationId", event, data, room, status, flushed, "createdAt")
     VALUES (${locationId}, ${event}, ${jsonData}::jsonb, ${targetRoom}, 'pending', false, NOW())
     RETURNING id`,
  )

  return Number(rows[0].id)
}

/**
 * Queue a tag-based socket event inside a Prisma transaction.
 *
 * Used primarily for KDS routing (e.g. 'kds:order-received') where events
 * are routed to specific prep stations based on item tags.
 *
 * @param tx       Prisma transaction client
 * @param locationId  Target location
 * @param event    Socket event name
 * @param data     Event payload
 * @param tags     Array of routing tags (e.g. ['kitchen', 'pizza'])
 * @returns        The SocketEventLog row ID
 */
export async function queueTagSocketEvent(
  tx: any,
  locationId: string,
  event: string,
  data: unknown,
  tags: string[],
): Promise<number> {
  const jsonData = JSON.stringify(data ?? {})
  const tagsJson = JSON.stringify(tags)
  const targetRoom = `location:${locationId}` // Base room for tag events

  const rows: Array<{ id: bigint }> = await tx.$queryRaw(
    Prisma.sql`INSERT INTO "SocketEventLog" ("locationId", event, data, room, tags, status, flushed, "createdAt")
     VALUES (${locationId}, ${event}, ${jsonData}::jsonb, ${targetRoom}, ${tagsJson}::jsonb, 'pending', false, NOW())
     RETURNING id`,
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
  events: Array<{ event: string; data: unknown; room?: string; tags?: string[] }>,
): Promise<number[]> {
  const ids: number[] = []
  for (const e of events) {
    if (e.tags && e.tags.length > 0) {
      ids.push(await queueTagSocketEvent(tx, locationId, e.event, e.data, e.tags))
    } else {
      ids.push(await queueSocketEvent(tx, locationId, e.event, e.data, e.room))
    }
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
    // Claim rows atomically: UPDATE ... RETURNING inside a single statement.
    const rows: Array<{
      id: bigint
      event: string
      data: unknown
      room: string
      tags: string[] | null
    }> = await db.$queryRaw(
      Prisma.sql`UPDATE "SocketEventLog"
       SET status = 'flushing'
       WHERE id IN (
         SELECT id FROM "SocketEventLog"
         WHERE "locationId" = ${locationId} AND flushed = false AND status != 'flushing'
         ORDER BY id ASC
         LIMIT ${maxBatch}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, event, data, room, tags`,
    )

    if (rows.length === 0) return { flushed: 0, failed: 0 }

    const flushedIds: bigint[] = []
    const failedIds: bigint[] = []

    for (const row of rows) {
      try {
        // Inject _eid so clients can deduplicate (same contract as recordEvent)
        const eid = Number(row.id)
        const enriched = row.data && typeof row.data === 'object' && !Array.isArray(row.data)
          ? { ...row.data as Record<string, unknown>, _eid: eid }
          : row.data

        if (row.tags && row.tags.length > 0) {
          // Tag-based routing (e.g. KDS)
          await emitToTags(row.tags, row.event, enriched, locationId)
        } else if ((CRITICAL_EMIT_EVENTS as Set<string>).has(row.event)) {
          // QoS 1 events — acknowledged delivery with retry
          await emitCriticalToLocation(locationId, row.event, enriched)
        } else {
          // Standard best-effort emit
          await emitToLocation(locationId, row.event, enriched)
        }

        flushedIds.push(row.id)
        flushed++
      } catch (emitErr) {
        // Emit failed — revert to pending so catch-up or next flush picks it up
        failedIds.push(row.id)
        failed++
        log.warn({ eventId: Number(row.id), event: row.event, error: emitErr instanceof Error ? emitErr.message : String(emitErr) }, 'Emit failed for outbox event')
      }
    }

    // Batch-mark successfully emitted events as flushed
    if (flushedIds.length > 0) {
      await db.$executeRaw(
        Prisma.sql`UPDATE "SocketEventLog"
         SET flushed = true, status = 'sent'
         WHERE id = ANY(${flushedIds.map(Number)}::bigint[])`,
      )
    }

    // Revert failed events back to pending for retry
    if (failedIds.length > 0) {
      await db.$executeRaw(
        Prisma.sql`UPDATE "SocketEventLog"
         SET status = 'pending'
         WHERE id = ANY(${failedIds.map(Number)}::bigint[])`,
      )
    }
  } catch (err) {
    // DB read/update failed — events stay unflushed, catch-up will handle them
    log.warn({ locationId, error: err instanceof Error ? err.message : String(err) }, 'Flush failed for location')
  }

  return { flushed, failed }
}

/**
 * Flush the socket outbox with a timeout guard.
 * Fire-and-forget — logs errors but never throws or blocks the caller.
 * Unflushed events are recovered by flushAllPendingOutbox() on server restart.
 */
export function flushOutboxSafe(locationId: string): void {
  void Promise.race([
    flushSocketOutbox(locationId),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Outbox flush timeout (5s)')), 5000)
    ),
  ]).catch((err) => {
    log.warn({ err, locationId }, 'Outbox flush failed or timed out — startup recovery will handle')
  })
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
    // Reset stale 'flushing' rows from prior crashes. If the process died while
    // rows were claimed (status='flushing'), they're orphaned — no one will retry
    // them because flushSocketOutbox excludes status='flushing'. Reset any that
    // are older than 5 minutes back to 'pending' so they get picked up below.
    await db.$executeRaw(
      Prisma.sql`UPDATE "SocketEventLog"
       SET status = 'pending'
       WHERE status = 'flushing' AND "createdAt" < NOW() - INTERVAL '5 minutes'`,
    )

    // Find distinct locations with unflushed events
    const locations: Array<{ locationId: string }> = await db.$queryRaw(
      Prisma.sql`SELECT DISTINCT "locationId" FROM "SocketEventLog" WHERE flushed = false LIMIT 50`,
    )

    for (const loc of locations) {
      const result = await flushSocketOutbox(loc.locationId)
      total += result.flushed
    }

    if (total > 0) {
      log.info({ total, locationCount: locations.length }, 'Startup recovery: flushed pending events')
    }
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, 'Startup flush failed')
  }

  return { total }
}

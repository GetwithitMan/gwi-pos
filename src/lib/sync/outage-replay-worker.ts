/**
 * Outage Replay Worker
 *
 * FIFO replay worker that processes OutageQueueEntry records when internet
 * connectivity to Neon is restored. Entries are created by upstream-sync-worker
 * during outage mode and replayed in localSeq order.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { randomUUID } from 'crypto'
import { neonClient, hasNeonConnection } from '../neon-client'
import { masterClient } from '../db'
import { createChildLogger } from '@/lib/logger'
import { notifyDataChanged } from '../cloud-notify'
import { emitToLocation } from '../socket-server'

const log = createChildLogger('outage-replay')

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplayMetrics {
  running: boolean
  replayedCount: number
  conflictCount: number
  failedCount: number
  lastReplayAt: Date | null
}

// ── State ─────────────────────────────────────────────────────────────────────

const metrics: ReplayMetrics = {
  running: false,
  replayedCount: 0,
  conflictCount: 0,
  failedCount: 0,
  lastReplayAt: null,
}

let replayTimer: ReturnType<typeof setInterval> | null = null
let isReplaying = false

/**
 * Idempotency guard: tracks entry IDs currently being processed in the active
 * drain cycle. Prevents duplicate replay if processOutageQueue is re-entered
 * (e.g., timer fires while a previous cycle is still draining).
 * Cleared at the end of each drain cycle.
 */
const processingEntryIds = new Set<string>()

/** Maximum retry attempts before an entry is dead-lettered */
const MAX_RETRY_ATTEMPTS = 10

/** Maximum conflict retry attempts before moving to DEAD_LETTER */
const MAX_CONFLICT_RETRIES = 3

/** Cached column names per table (loaded on first access, refreshed periodically) */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression */
const columnTypeMap = new Map<string, Map<string, string>>()

// P3-3: Periodic column metadata refresh (every 10 minutes)
const REPLAY_COLUMN_CACHE_TTL = 10 * 60 * 1000
let replayColumnCacheLastRefresh = 0

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Check if Neon is reachable with a lightweight query */
async function checkNeonConnectivity(): Promise<boolean> {
  if (!hasNeonConnection() || !neonClient) return false
  try {
    await neonClient.$queryRawUnsafe<unknown[]>(`SELECT 1`)
    return true
  } catch {
    return false
  }
}

/** Check if a PG error is a conflict (unique violation, serialization failure) */
function isConflictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message || ''
  // PG error code 23505 = unique_violation
  // PG error code 40001 = serialization_failure
  return msg.includes('23505') || msg.includes('unique constraint') ||
    msg.includes('40001') || msg.includes('duplicate key')
}

/** Check if an error indicates network/connectivity failure */
function isConnectivityError(err: unknown): boolean {
  const msg = String((err as Error)?.message || '').toLowerCase()
  return msg.includes('econnrefused') || msg.includes('enotfound') ||
    msg.includes('etimedout') || msg.includes('fetch failed') ||
    msg.includes('connection terminated') || msg.includes('socket hang up')
}

/** Build PG type cast from column metadata */
function buildCast(dataType: string, udtName: string): string {
  // CRITICAL: Use ::timestamp (not ::timestamptz) for "timestamp without time zone"
  // columns. Using ::timestamptz causes PostgreSQL to convert from UTC to the session
  // timezone, which silently shifts all timestamps by the timezone offset.
  if (dataType === 'timestamp with time zone') return '::timestamptz'
  if (dataType.includes('timestamp')) return '::timestamp'
  if (dataType === 'jsonb') return '::jsonb'
  if (dataType === 'json') return '::json'
  if (dataType === 'boolean') return '::boolean'
  if (dataType === 'numeric') return '::numeric'
  if (dataType === 'integer' || dataType === 'smallint') return '::integer'
  if (dataType === 'bigint') return '::bigint'
  if (dataType === 'double precision' || dataType === 'real') return '::double precision'
  if (dataType === 'USER-DEFINED') return `::"${udtName}"`
  if (dataType === 'ARRAY') return `::"${udtName.replace(/^_/, '')}"[]`
  return ''
}

/** Serialize a JS/Prisma value for parameterized SQL */
function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'object') {
    const v = val as Record<string, unknown>
    if (v.d !== undefined && v.s !== undefined && v.e !== undefined) {
      return String(val)
    }
    return JSON.stringify(val)
  }
  return val
}

/** P3-3: Refresh all cached column metadata (clears cache so next access reloads) */
function refreshColumnCacheIfStale(): void {
  if (Date.now() - replayColumnCacheLastRefresh > REPLAY_COLUMN_CACHE_TTL) {
    columnCache.clear()
    columnTypeMap.clear()
    replayColumnCacheLastRefresh = Date.now()
    log.info('Column metadata cache cleared for refresh (TTL expired)')
  }
}

/** Load column metadata for a table (lazy, cached) */
async function ensureColumnMetadata(tableName: string): Promise<void> {
  if (columnCache.has(tableName)) return

  try {
    const cols = await masterClient.$queryRawUnsafe<{ column_name: string; data_type: string; udt_name: string }[]>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
      tableName
    )
    if (cols.length > 0) {
      columnCache.set(tableName, cols.map((c) => c.column_name))
      const castMap = new Map<string, string>()
      cols.forEach((c) => castMap.set(c.column_name, buildCast(c.data_type, c.udt_name)))
      columnTypeMap.set(tableName, castMap)
    }
  } catch (err) {
    log.error({ err, tableName }, 'Failed to load column metadata')
  }
}

// ── Replay Logic ──────────────────────────────────────────────────────────────

/**
 * Replay a single outage queue entry against Neon.
 * Uses the stored payload to INSERT/UPDATE/DELETE against the Neon client.
 */
async function replayEntry(entry: {
  id: string
  tableName: string
  recordId: string
  operation: string
  payload: unknown
  createdAt?: Date | string
}): Promise<void> {
  if (!neonClient) throw new Error('Neon client not available')

  const { tableName, recordId, operation } = entry
  const payload = (typeof entry.payload === 'string' ? JSON.parse(entry.payload) : entry.payload) as Record<string, unknown>

  await ensureColumnMetadata(tableName)

  switch (operation) {
    case 'INSERT':
    case 'UPDATE': {
      const columns = columnCache.get(tableName)
      if (!columns || columns.length === 0) {
        throw new Error(`No column metadata for ${tableName}`)
      }

      // Build upsert from payload — use only columns that exist in the payload
      const upsertCols = columns.filter((c) => c !== 'syncedAt' && c in payload)
      if (upsertCols.length === 0) {
        throw new Error(`No matching columns in payload for ${tableName}`)
      }

      const quotedCols = upsertCols.map((c) => `"${c}"`).join(', ')
      const types = columnTypeMap.get(tableName)
      const placeholders = upsertCols.map((c, i) => `$${i + 1}${types?.get(c) ?? ''}`).join(', ')
      const updateSet = upsertCols
        .filter((c) => c !== 'id')
        .map((c) => `"${c}" = EXCLUDED."${c}"`)
        .join(', ')

      // M6: Guard against overwriting newer Neon data with stale outage data.
      // Only update if the existing row's updatedAt is older than or equal to the replayed row's.
      const hasUpdatedAt = upsertCols.includes('updatedAt')
      const versionGuard = hasUpdatedAt
        ? ` WHERE "${tableName}"."updatedAt" <= EXCLUDED."updatedAt"`
        : ''

      const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}${versionGuard}`
      const values = upsertCols.map((col) => serializeValue(payload[col]))

      await neonClient.$executeRawUnsafe(sql, ...values)
      break
    }

    case 'DELETE': {
      // P2-3: Check if the record was recreated/modified on Neon during the outage.
      // If a newer version exists on Neon, skip the delete to avoid data loss.
      // Only check updatedAt if the table actually has that column (use cached metadata).
      const deleteTableCols = columnCache.get(tableName) ?? []
      const tableHasUpdatedAt = deleteTableCols.includes('updatedAt')
      try {
        if (!tableHasUpdatedAt) throw new Error('skip') // no updatedAt → skip guard, proceed to delete
        const neonRow = await neonClient.$queryRawUnsafe<Array<{ updatedAt: Date }>>(
          `SELECT "updatedAt" FROM "${tableName}" WHERE id = $1`,
          recordId,
        )
        if (neonRow.length > 0) {
          const neonUpdatedAt = neonRow[0].updatedAt instanceof Date
            ? neonRow[0].updatedAt
            : new Date(neonRow[0].updatedAt as unknown as string)
          const entryCreatedAt = entry.createdAt
            ? (entry.createdAt instanceof Date ? entry.createdAt : new Date(entry.createdAt))
            : new Date(0)
          if (neonUpdatedAt > entryCreatedAt) {
            log.warn(
              { tableName, recordId, neonUpdatedAt: neonUpdatedAt.toISOString(), entryCreatedAt: entryCreatedAt.toISOString() },
              'Skipping DELETE — record was modified on Neon after outage delete was queued'
            )
            break
          }
        }
      } catch {
        // If the check fails (table doesn't have updatedAt, etc.), proceed with delete
      }

      await neonClient.$executeRawUnsafe(
        `DELETE FROM "${tableName}" WHERE id = $1`,
        recordId,
      )
      break
    }

    default:
      log.warn(`Unknown operation: ${operation} for ${tableName}:${recordId}`)
  }
}

/**
 * Process the outage queue: fetch pending entries in FIFO order and replay.
 */
async function processOutageQueue(): Promise<void> {
  if (isReplaying) return
  isReplaying = true
  // Per-cycle trace ID for log correlation
  const cycleId = randomUUID().slice(0, 8)

  try {
    // P3-3: Refresh column metadata cache if stale (picks up schema changes)
    refreshColumnCacheIfStale()

    const isOnline = await checkNeonConnectivity()
    if (!isOnline) return

    // Dead-letter entries that have exceeded max retry attempts
    const deadLettered = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry" SET status = 'DEAD_LETTER'
       WHERE status = 'FAILED'
         AND COALESCE(("metadata"->>'retryCount')::int, 0) >= $1`,
      MAX_RETRY_ATTEMPTS
    ) as number

    // M4: Also dead-letter failed entries older than 24h regardless of retry count
    // (prevents entries with retryCount < MAX from being stuck forever in 'FAILED')
    const agedOut = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry" SET status = 'DEAD_LETTER'
       WHERE status = 'FAILED'
         AND "createdAt" < NOW() - INTERVAL '24 hours'
         AND COALESCE(("metadata"->>'retryCount')::int, 0) < $1`,
      MAX_RETRY_ATTEMPTS
    ) as number

    const totalDeadLettered = (deadLettered || 0) + (agedOut || 0)
    if (totalDeadLettered > 0) {
      log.error({ cycleId, totalDeadLettered, maxRetry: deadLettered || 0, agedOut: agedOut || 0 }, 'CRITICAL: entries dead-lettered — orders may be lost. Check OutageQueueEntry table.')

      // Immediately notify MC via cloud-notify for real-time alerting
      const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''
      if (locId) {
        // Fetch dead-lettered entry IDs for per-entry notifications
        const recentDead = await masterClient.$queryRawUnsafe<Array<{
          id: string
          tableName: string
          recordId: string
          retryCount: number
        }>>(
          `SELECT id, "tableName", "recordId", COALESCE(("metadata"->>'retryCount')::int, 0) as "retryCount"
           FROM "OutageQueueEntry"
           WHERE status = 'DEAD_LETTER'
           ORDER BY "createdAt" DESC
           LIMIT 20`
        )
        for (const entry of recentDead) {
          void notifyDataChanged({
            locationId: locId,
            domain: 'sync',
            action: 'dead_letter',
            entityId: entry.id,
          })
          log.error({
            entryId: entry.id,
            tableName: entry.tableName,
            recordId: entry.recordId,
            attempts: entry.retryCount,
          }, 'Outage queue entry moved to dead letter — data may be lost')
        }

        // Emit local socket event so POS UI can show an on-screen alert
        void emitToLocation(locId, 'sync:dead-letter', {
          totalDeadLettered,
          timestamp: new Date().toISOString(),
        }).catch((err) => log.error({ err }, 'Failed to emit local dead-letter socket event'))
      }

      // Emit cloud event for MC alerting
      void (async () => {
        try {
          const { emitCloudEvent } = await import('../cloud-events')
          const locationId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID || ''

          // Fetch details of recently dead-lettered entries for the alert
          const deadLetterDetails = await masterClient.$queryRawUnsafe<Array<{
            id: string
            tableName: string
            recordId: string
            operation: string
            createdAt: Date
            metadata: unknown
          }>>(
            `SELECT id, "tableName", "recordId", operation, "createdAt", metadata
             FROM "OutageQueueEntry"
             WHERE status = 'DEAD_LETTER'
             ORDER BY "createdAt" DESC
             LIMIT 10`
          )

          await emitCloudEvent('OUTAGE_DEAD_LETTER', {
            locationId,
            totalDeadLettered,
            entries: deadLetterDetails.map(e => ({
              id: e.id,
              tableName: e.tableName,
              recordId: e.recordId,
              operation: e.operation,
              attempts: (e.metadata as any)?.retryCount ?? 0,
              createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
            })),
            timestamp: new Date().toISOString(),
          })
        } catch (err) {
          log.error({ err }, 'Failed to emit dead-letter cloud event')
        }
      })().catch((err) => log.error({ err }, 'dead-letter cloud event top-level error'))
    }

    // Retry CONFLICT entries: conflicts may have resolved (e.g., the conflicting row was
    // deleted or updated). Move CONFLICT entries older than 60s back to PENDING for retry.
    // Dead-letter entries that have been retried as CONFLICT too many times.
    const conflictDeadLettered = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry" SET status = 'DEAD_LETTER'
       WHERE status = 'CONFLICT'
         AND COALESCE(("metadata"->>'conflictRetryCount')::int, 0) >= $1`,
      MAX_CONFLICT_RETRIES
    ) as number

    if (conflictDeadLettered && conflictDeadLettered > 0) {
      log.error({ cycleId, conflictDeadLettered, maxConflictRetries: MAX_CONFLICT_RETRIES },
        'CONFLICT entries exceeded max retries — moved to DEAD_LETTER')
    }

    // Move retryable CONFLICT entries (older than 60s, under max retries) back to PENDING
    const conflictRetried = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry"
       SET status = 'PENDING',
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{conflictRetryCount}',
             to_jsonb(COALESCE(("metadata"->>'conflictRetryCount')::int, 0) + 1)
           )
       WHERE status = 'CONFLICT'
         AND "updatedAt" < NOW() - INTERVAL '60 seconds'
         AND COALESCE(("metadata"->>'conflictRetryCount')::int, 0) < $1`,
      MAX_CONFLICT_RETRIES
    ) as number

    if (conflictRetried && conflictRetried > 0) {
      log.info({ cycleId, conflictRetried, maxConflictRetries: MAX_CONFLICT_RETRIES },
        'CONFLICT entries moved back to PENDING for retry')
    }

    // Reset failed entries < 24h old back to pending for retry, incrementing retry count
    await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry"
       SET status = 'PENDING',
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{retryCount}',
             to_jsonb(COALESCE(("metadata"->>'retryCount')::int, 0) + 1)
           )
       WHERE status = 'FAILED'
         AND "createdAt" > NOW() - INTERVAL '24 hours'
         AND COALESCE(("metadata"->>'retryCount')::int, 0) < $1`,
      MAX_RETRY_ATTEMPTS
    )

    // Use FOR UPDATE SKIP LOCKED to prevent duplicate replay if multiple processes
    // or a timer re-entrance attempt to drain the same entries concurrently.
    const pending = await masterClient.$queryRawUnsafe<Array<{
      id: string
      tableName: string
      recordId: string
      operation: string
      payload: unknown
      localSeq: bigint
      createdAt: Date
    }>>(
      `SELECT id, "tableName", "recordId", operation, payload, "localSeq", "createdAt"
       FROM "OutageQueueEntry"
       WHERE status = 'PENDING'
       ORDER BY "localSeq" ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`
    )

    if (pending.length === 0) return

    log.info({ cycleId, count: pending.length }, `Processing ${pending.length} queued entries`)

    for (const entry of pending) {
      // Idempotency: skip entries already being processed in this cycle
      if (processingEntryIds.has(entry.id)) {
        continue
      }
      processingEntryIds.add(entry.id)

      try {
        await replayEntry(entry)
        await masterClient.$executeRawUnsafe(
          `UPDATE "OutageQueueEntry" SET status = 'REPLAYED', "replayedAt" = NOW() WHERE id = $1`,
          entry.id,
        )
        metrics.replayedCount++
      } catch (err: unknown) {
        if (isConnectivityError(err)) {
          // Leave as 'PENDING' — will retry next cycle when internet returns
          log.warn(`Connectivity lost during replay, will retry: ${entry.tableName}:${entry.recordId}`)
          break // Stop processing this batch — internet is down
        } else if (isConflictError(err)) {
          await masterClient.$executeRawUnsafe(
            `UPDATE "OutageQueueEntry" SET status = 'CONFLICT' WHERE id = $1`,
            entry.id,
          )
          metrics.conflictCount++
          log.warn({ cycleId, err, tableName: entry.tableName, recordId: entry.recordId }, 'Conflict during replay')
        } else {
          await masterClient.$executeRawUnsafe(
            `UPDATE "OutageQueueEntry" SET status = 'FAILED' WHERE id = $1`,
            entry.id,
          )
          metrics.failedCount++
          log.error({ cycleId, err, tableName: entry.tableName, recordId: entry.recordId }, 'Failed to replay entry')
        }
      }
    }

    metrics.lastReplayAt = new Date()
  } finally {
    processingEntryIds.clear()
    isReplaying = false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startOutageReplayWorker(): void {
  if (replayTimer) return
  if (!hasNeonConnection()) {
    log.info('No Neon connection — worker disabled')
    return
  }

  void (async () => {
    // Guard: don't start sync workers on standby NUC (INV-6)
    try {
      const [{ is_standby }] = await masterClient.$queryRawUnsafe<[{ is_standby: boolean }]>(
        'SELECT pg_is_in_recovery() as is_standby'
      )
      if (is_standby) {
        log.warn('Standby PostgreSQL detected — sync workers NOT started (INV-6)')
        return
      }
    } catch {
      // If we can't check, assume primary (safe default — PG will reject writes if standby)
    }

    replayTimer = setInterval(() => {
      void processOutageQueue().catch((err) => log.error({ err }, 'processOutageQueue cycle error'))
    }, 10_000) // every 10s
    replayTimer.unref()

    metrics.running = true
    log.info('Worker started (interval: 10s)')
  })()
}

export function stopOutageReplayWorker(): void {
  if (replayTimer) {
    clearInterval(replayTimer)
    replayTimer = null
    metrics.running = false
    log.info('Worker stopped')
  }
}

export function getOutageReplayMetrics(): ReplayMetrics {
  return { ...metrics }
}

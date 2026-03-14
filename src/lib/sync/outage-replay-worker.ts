/**
 * Outage Replay Worker
 *
 * FIFO replay worker that processes OutageQueueEntry records when internet
 * connectivity to Neon is restored. Entries are created by upstream-sync-worker
 * during outage mode and replayed in localSeq order.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { neonClient, hasNeonConnection } from '../neon-client'
import { masterClient } from '../db'

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

/** Cached column names per table (loaded on first access) */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression */
const columnTypeMap = new Map<string, Map<string, string>>()

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
  if (dataType.includes('timestamp')) return '::timestamptz'
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
    console.error(`[OutageReplay] Failed to load column metadata for ${tableName}:`, err instanceof Error ? err.message : err)
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
      await neonClient.$executeRawUnsafe(
        `DELETE FROM "${tableName}" WHERE id = $1`,
        recordId,
      )
      break
    }

    default:
      console.warn(`[OutageReplay] Unknown operation: ${operation} for ${tableName}:${recordId}`)
  }
}

/**
 * Process the outage queue: fetch pending entries in FIFO order and replay.
 */
async function processOutageQueue(): Promise<void> {
  if (isReplaying) return
  isReplaying = true

  try {
    const isOnline = await checkNeonConnectivity()
    if (!isOnline) return

    // Dead-letter entries that have exceeded max retry attempts
    const deadLettered = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry" SET status = 'dead_letter'
       WHERE status = 'failed'
         AND COALESCE(("metadata"->>'retryCount')::int, 0) >= $1`,
      MAX_RETRY_ATTEMPTS
    ) as number

    // M4: Also dead-letter failed entries older than 24h regardless of retry count
    // (prevents entries with retryCount < MAX from being stuck forever in 'failed')
    const agedOut = await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry" SET status = 'dead_letter'
       WHERE status = 'failed'
         AND "createdAt" < NOW() - INTERVAL '24 hours'
         AND COALESCE(("metadata"->>'retryCount')::int, 0) < $1`,
      MAX_RETRY_ATTEMPTS
    ) as number

    const totalDeadLettered = (deadLettered || 0) + (agedOut || 0)
    if (totalDeadLettered > 0) {
      console.error(`[OUTAGE-REPLAY] CRITICAL: ${totalDeadLettered} entries dead-lettered (${deadLettered || 0} max-retry, ${agedOut || 0} aged-out). Orders may be lost. Check OutageQueueEntry table.`)
      // If MC health endpoint exists, report it
    }

    // Reset failed entries < 24h old back to pending for retry, incrementing retry count
    await masterClient.$executeRawUnsafe(
      `UPDATE "OutageQueueEntry"
       SET status = 'pending',
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{retryCount}',
             to_jsonb(COALESCE(("metadata"->>'retryCount')::int, 0) + 1)
           )
       WHERE status = 'failed'
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
    }>>(
      `SELECT id, "tableName", "recordId", operation, payload, "localSeq"
       FROM "OutageQueueEntry"
       WHERE status = 'pending'
       ORDER BY "localSeq" ASC
       LIMIT 50
       FOR UPDATE SKIP LOCKED`
    )

    if (pending.length === 0) return

    console.log(`[OutageReplay] Processing ${pending.length} queued entries`)

    for (const entry of pending) {
      // Idempotency: skip entries already being processed in this cycle
      if (processingEntryIds.has(entry.id)) {
        continue
      }
      processingEntryIds.add(entry.id)

      try {
        await replayEntry(entry)
        await masterClient.$executeRawUnsafe(
          `UPDATE "OutageQueueEntry" SET status = 'replayed', "replayedAt" = NOW() WHERE id = $1`,
          entry.id,
        )
        metrics.replayedCount++
      } catch (err: unknown) {
        if (isConnectivityError(err)) {
          // Leave as 'pending' — will retry next cycle when internet returns
          console.warn(`[OutageReplay] Connectivity lost during replay, will retry: ${entry.tableName}:${entry.recordId}`)
          break // Stop processing this batch — internet is down
        } else if (isConflictError(err)) {
          await masterClient.$executeRawUnsafe(
            `UPDATE "OutageQueueEntry" SET status = 'conflict' WHERE id = $1`,
            entry.id,
          )
          metrics.conflictCount++
          console.warn(
            `[OutageReplay] Conflict on ${entry.tableName}:${entry.recordId}`,
            err instanceof Error ? err.message : err
          )
        } else {
          await masterClient.$executeRawUnsafe(
            `UPDATE "OutageQueueEntry" SET status = 'failed' WHERE id = $1`,
            entry.id,
          )
          metrics.failedCount++
          console.error(
            `[OutageReplay] Failed ${entry.tableName}:${entry.recordId}`,
            err
          )
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
    console.log('[OutageReplay] No Neon connection — worker disabled')
    return
  }

  replayTimer = setInterval(() => {
    void processOutageQueue().catch(console.error)
  }, 10_000) // every 10s
  replayTimer.unref()

  metrics.running = true
  console.log('[OutageReplay] Worker started (interval: 10s)')
}

export function stopOutageReplayWorker(): void {
  if (replayTimer) {
    clearInterval(replayTimer)
    replayTimer = null
    metrics.running = false
    console.log('[OutageReplay] Worker stopped')
  }
}

export function getOutageReplayMetrics(): ReplayMetrics {
  return { ...metrics }
}

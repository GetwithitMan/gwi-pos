/**
 * Upstream Sync Worker (NUC → Neon)
 *
 * Pushes NUC-authoritative data (orders, payments, shifts, tips, etc.)
 * to the Neon cloud database every 1 second. Each row is individually
 * upserted so a single failure doesn't block the batch.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { neonClient, hasNeonConnection } from '../neon-client'
import { masterClient } from '../db'
import { getUpstreamModels, getBidirectionalModelNames, UPSTREAM_INTERVAL_MS } from './sync-config'
import { QUARANTINE_PROTECTED_MODELS } from './sync-conflict-quarantine'
import { dispatchOutageStatus } from '../socket-dispatch'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncMetrics {
  running: boolean
  lastSyncAt: Date | null
  pendingCount: number
  rowsSyncedTotal: number
  errorCount: number
}

// ── State ─────────────────────────────────────────────────────────────────────

const metrics: SyncMetrics = {
  running: false,
  lastSyncAt: null,
  pendingCount: 0,
  rowsSyncedTotal: 0,
  errorCount: 0,
}

/** Monotonic counter for outage queue ordering (resets on server restart — fine per outage period) */
let outageSeqCounter = 0

// ── Outage Detection ──────────────────────────────────────────────────────────

/** Number of consecutive sync failures before declaring outage */
const OUTAGE_THRESHOLD = 3

let consecutiveFailures = 0
let isInOutage = false

/**
 * Check whether the upstream sync is currently in outage mode.
 * When true, Neon is unreachable and writes should be queued locally.
 */
export function isInOutageMode(): boolean {
  return isInOutage
}

/**
 * Queue a write to the OutageQueueEntry table for later replay.
 * Called by API routes when isInOutageMode() is true to avoid losing data.
 */
export async function queueOutageWrite(
  tableName: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  try {
    // Monotonic localSeq — simple counter, resets on restart (new outage = new sequence)
    const localSeq = ++outageSeqCounter
    // C1: idempotencyKey = locationId:tableName:recordId:localSeq
    const idempotencyKey = `${locationId}:${tableName}:${recordId}:${localSeq}`

    await masterClient.$executeRawUnsafe(
      `INSERT INTO "OutageQueueEntry" (id, "tableName", "recordId", operation, payload, "locationId", status, "localSeq", "idempotencyKey", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, 'pending', $6, $7, NOW())`,
      tableName,
      recordId,
      operation,
      JSON.stringify(payload),
      locationId,
      localSeq,
      idempotencyKey,
    )
  } catch (err) {
    console.error(`[UpstreamSync] Failed to queue outage write for ${tableName}:${recordId}:`, err)
  }
}

/** Cached column names per table (loaded once at startup) */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression (e.g., '::timestamptz') */
const columnTypeMap = new Map<string, Map<string, string>>()

let timer: ReturnType<typeof setInterval> | null = null
/** Guard against overlapping sync cycles */
let cycleRunning = false

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialize a JS/Prisma value for parameterized SQL */
function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'object') {
    // Decimal.js (Prisma Decimal) — has d (digits), s (sign), e (exponent)
    const v = val as Record<string, unknown>
    if (v.d !== undefined && v.s !== undefined && v.e !== undefined) {
      return String(val)
    }
    return JSON.stringify(val)
  }
  return val
}

/** Load column names for all upstream tables from information_schema */
async function loadColumnMetadata(): Promise<void> {
  const models = getUpstreamModels()
  for (const [tableName] of models) {
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
      console.error(
        `[UpstreamSync] Failed to load columns for ${tableName}:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  console.log(`[UpstreamSync] Column metadata loaded for ${columnCache.size} tables`)
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

// ── Core sync logic ───────────────────────────────────────────────────────────

/** Set of bidirectional model names — cached once */
const biDirModels = getBidirectionalModelNames()

async function syncTable(tableName: string, batchSize: number): Promise<number> {
  const columns = columnCache.get(tableName)
  if (!columns || columns.length === 0) return 0

  // Find rows where updatedAt > syncedAt (unsynced changes)
  const hasSyncedAt = columns.includes('syncedAt')
  const hasUpdatedAt = columns.includes('updatedAt')
  if (!hasUpdatedAt || !hasSyncedAt) return 0 // Need both columns to track sync state

  // Bidirectional models: only sync NUC-originated rows upstream (skip cloud-originated)
  const isBiDir = biDirModels.has(tableName) && columns.includes('lastMutatedBy')
  const biDirFilter = isBiDir ? ` AND ("lastMutatedBy" IS NULL OR "lastMutatedBy" != 'cloud')` : ''

  const whereClause = `"updatedAt" > COALESCE("syncedAt", '1970-01-01'::timestamptz)${biDirFilter}`

  const rows = await masterClient.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${tableName}" WHERE ${whereClause} ORDER BY "updatedAt" ASC LIMIT $1`,
    batchSize
  )

  if (rows.length === 0) return 0

  // Columns to upsert (exclude syncedAt — that's local tracking only)
  const upsertCols = columns.filter((c) => c !== 'syncedAt')
  const quotedCols = upsertCols.map((c) => `"${c}"`).join(', ')
  const types = columnTypeMap.get(tableName)
  const placeholders = upsertCols.map((c, i) => `$${i + 1}${types?.get(c) ?? ''}`).join(', ')
  const updateSet = upsertCols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`

  // Check if this is a protected model with syncVersion column
  const isProtected = QUARANTINE_PROTECTED_MODELS.has(tableName)
  const hasSyncVersion = columns.includes('syncVersion')

  const CHUNK_SIZE = 100
  let synced = 0

  for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CHUNK_SIZE)

    // Increment syncVersion on local rows before uploading to Neon.
    // This ensures the local version is always higher than what Neon has
    // when local mutations happen, enabling deterministic conflict detection.
    if (isProtected && hasSyncVersion) {
      const chunkIds = chunk.map(r => r.id as string)
      try {
        await masterClient.$executeRawUnsafe(
          `UPDATE "${tableName}" SET "syncVersion" = "syncVersion" + 1 WHERE id = ANY($1::text[])`,
          chunkIds
        )
        // Update in-memory row data so the incremented version is sent to Neon
        for (const row of chunk) {
          row.syncVersion = ((row.syncVersion as number) || 0) + 1
        }
      } catch (versionErr) {
        // Non-fatal — column may not exist yet (migration not run).
        // Fall through to upload with current version.
        console.warn(
          `[UpstreamSync] ${tableName} syncVersion increment failed (will sync without version):`,
          versionErr instanceof Error ? versionErr.message : versionErr
        )
      }
    }

    try {
      await neonClient!.$transaction(async (neonTx) => {
        for (const row of chunk) {
          const values = upsertCols.map((col) => serializeValue(row[col]))
          await neonTx.$executeRawUnsafe(sql, ...values)
        }
      })

      // Neon transaction committed — stamp syncedAt locally for the whole chunk.
      // Batch UPDATE using ANY() for efficiency (single query instead of N queries).
      // A missed stamp just means the row is re-sent next cycle (idempotent via ON CONFLICT).
      try {
        const ids = chunk.map(r => r.id as string)
        await masterClient.$executeRawUnsafe(
          `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = ANY($1::text[])`,
          ids
        )
        synced += chunk.length
      } catch (stampErr) {
        console.error(
          `[UpstreamSync] ${tableName} batch syncedAt stamp failed (${chunk.length} rows, will retry next cycle):`,
          stampErr instanceof Error ? stampErr.message : stampErr
        )
        metrics.errorCount++
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // Transaction failed — fall back to individual row sync for this chunk
      // so a single bad row doesn't block the rest
      for (const row of chunk) {
        try {
          const values = upsertCols.map((col) => serializeValue(row[col]))
          await neonClient!.$executeRawUnsafe(sql, ...values)

          await masterClient.$executeRawUnsafe(
            `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
            row.id as string
          )
          synced++
        } catch (rowErr) {
          const rowErrMsg = rowErr instanceof Error ? rowErr.message : String(rowErr)

          if (rowErrMsg.includes('unique constraint') || rowErrMsg.includes('duplicate key') || rowErrMsg.includes('Unique constraint')) {
            console.warn(
              `[UpstreamSync] ${tableName} row ${row.id}: unique constraint violation on Neon — marking synced to prevent retry loop`
            )
            try {
              await masterClient.$executeRawUnsafe(
                `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
                row.id as string
              )
            } catch {
              // Best effort
            }
          } else {
            console.error(
              `[UpstreamSync] ${tableName} row ${row.id}:`, rowErrMsg
            )
          }
          metrics.errorCount++
        }
      }
    }
  }

  return synced
}

async function runSyncCycle(): Promise<void> {
  if (!hasNeonConnection()) return
  if (cycleRunning) return // Prevent overlapping cycles
  cycleRunning = true

  try {
    // Quick connectivity check — if Neon is unreachable, bail early
    try {
      await neonClient!.$queryRawUnsafe<unknown[]>(`SELECT 1`)
    } catch (connErr) {
      consecutiveFailures++
      metrics.errorCount++
      if (consecutiveFailures >= OUTAGE_THRESHOLD && !isInOutage) {
        isInOutage = true
        console.warn(`[UpstreamSync] OUTAGE DETECTED — ${consecutiveFailures} consecutive failures, queuing writes`)
        const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
        if (locId) void dispatchOutageStatus(locId, true).catch(console.error)
      }
      return
    }

    // Connectivity restored — clear outage if active
    if (isInOutage) {
      console.log(`[UpstreamSync] Connectivity restored after ${consecutiveFailures} failures — exiting outage mode`)
      isInOutage = false
      const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
      if (locId) void dispatchOutageStatus(locId, false).catch(console.error)
    }
    consecutiveFailures = 0

    const models = getUpstreamModels()
    let totalSynced = 0
    let totalPending = 0

    for (const [tableName, config] of models) {
      if (!columnCache.has(tableName)) continue

      try {
        const columns = columnCache.get(tableName)!
        const hasSyncedAt = columns.includes('syncedAt')
        const hasUpdatedAt = columns.includes('updatedAt')
        if (!hasUpdatedAt || !hasSyncedAt) continue

        // Count pending rows (bidirectional models exclude cloud-originated rows)
        const isBiDir = biDirModels.has(tableName) && columns.includes('lastMutatedBy')
        const biDirFilter = isBiDir ? ` AND ("lastMutatedBy" IS NULL OR "lastMutatedBy" != 'cloud')` : ''
        const whereClause = `"updatedAt" > COALESCE("syncedAt", '1970-01-01'::timestamptz)${biDirFilter}`
        const [{ count }] = await masterClient.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*) as count FROM "${tableName}" WHERE ${whereClause}`
        )
        totalPending += Number(count)

        const synced = await syncTable(tableName, config.batchSize)
        totalSynced += synced

        if (synced > 0) {
          console.log(`[UpstreamSync] ${tableName}: ${synced} rows`)
        }
      } catch (err) {
        console.error(
          `[UpstreamSync] Table ${tableName}:`,
          err instanceof Error ? err.message : err
        )
        metrics.errorCount++
      }
    }

    metrics.lastSyncAt = new Date()
    metrics.rowsSyncedTotal += totalSynced
    metrics.pendingCount = Math.max(0, totalPending - totalSynced)

    // Emit sync summary via cloud relay (Phase 5)
    if (totalSynced > 0) {
      void (async () => {
        try {
          const { emitToRelay } = await import('../cloud-relay-client')
          emitToRelay('SYNC_SUMMARY', {
            locationId: process.env.POS_LOCATION_ID || process.env.LOCATION_ID || '',
            rowsSynced: totalSynced,
            pendingCount: metrics.pendingCount,
            isOutage: isInOutage,
            timestamp: new Date().toISOString(),
          })
        } catch { /* relay not available */ }
      })().catch(console.error)
    }

    if (totalSynced > 0) {
      console.log(
        `[UpstreamSync] Cycle: ${totalSynced} synced, ${metrics.pendingCount} pending`
      )
    }
  } catch (err) {
    console.error('[UpstreamSync] Cycle error:', err)
    metrics.errorCount++
    consecutiveFailures++

    // Write to venue diagnostic log (fire-and-forget, dynamic import to avoid circular deps)
    void import('../venue-logger').then(({ logVenueEvent }) =>
      logVenueEvent({
        level: consecutiveFailures >= 3 ? 'error' : 'warn',
        source: 'sync',
        category: 'sync',
        message: `Upstream sync cycle failed (attempt ${consecutiveFailures}): ${err instanceof Error ? err.message : String(err)}`,
        details: { consecutiveFailures, totalSynced: 0 },
        stackTrace: err instanceof Error ? err.stack : undefined,
      })
    ).catch(console.error)

    if (consecutiveFailures >= OUTAGE_THRESHOLD && !isInOutage) {
      isInOutage = true
      console.warn(`[UpstreamSync] OUTAGE DETECTED — ${consecutiveFailures} consecutive failures, queuing writes`)
      const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
      if (locId) void dispatchOutageStatus(locId, true).catch(console.error)
    }
  } finally {
    cycleRunning = false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startUpstreamSyncWorker(): void {
  if (timer) return
  if (!hasNeonConnection()) {
    console.log('[UpstreamSync] No Neon connection — worker disabled')
    return
  }

  console.log(`[UpstreamSync] Starting (interval: ${UPSTREAM_INTERVAL_MS}ms)`)
  metrics.running = true

  void loadColumnMetadata().then(() => {
    void runSyncCycle()
    timer = setInterval(() => void runSyncCycle(), UPSTREAM_INTERVAL_MS)
    timer.unref()
  })
}

export function stopUpstreamSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    metrics.running = false
    console.log('[UpstreamSync] Stopped')
  }
}

export function getUpstreamSyncMetrics(): SyncMetrics {
  return { ...metrics }
}

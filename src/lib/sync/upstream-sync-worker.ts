/**
 * Upstream Sync Worker (NUC → Neon)
 *
 * Pushes NUC-authoritative data (orders, payments, shifts, tips, etc.)
 * to the Neon cloud database every 1 second. Each row is individually
 * upserted so a single failure doesn't block the batch.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { randomUUID } from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { neonClient, hasNeonConnection } from '../neon-client'

const log = createChildLogger('upstream-sync')
import { masterClient } from '../db'
import { getUpstreamModels, getBidirectionalModelNames, UPSTREAM_INTERVAL_MS, type SyncModelConfig } from './sync-config'
import { QUARANTINE_PROTECTED_MODELS } from './sync-conflict-quarantine'
import { dispatchOutageStatus } from '../socket-dispatch'
import { notifyDataChanged } from '../cloud-notify'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SyncMetrics {
  running: boolean
  lastSyncAt: Date | null
  pendingCount: number
  rowsSyncedTotal: number
  errorCount: number
}

// ── Shared singleton state via globalThis ─────────────────────────────────────
// CRITICAL: server.js (esbuild) and Next.js API routes (Turbopack/Webpack) load
// separate module copies. Module-level variables create TWO independent singletons.
// Using globalThis ensures both module systems share the same state.

declare global {
   
  var __gwi_upstream_metrics: SyncMetrics | undefined
   
  var __gwi_upstream_outage: { isInOutage: boolean; consecutiveFailures: number } | undefined
}

if (globalThis.__gwi_upstream_metrics === undefined) {
  globalThis.__gwi_upstream_metrics = {
    running: false,
    lastSyncAt: null,
    pendingCount: 0,
    rowsSyncedTotal: 0,
    errorCount: 0,
  }
}

if (globalThis.__gwi_upstream_outage === undefined) {
  globalThis.__gwi_upstream_outage = {
    isInOutage: false,
    consecutiveFailures: 0,
  }
}

const metrics = globalThis.__gwi_upstream_metrics
const outageState = globalThis.__gwi_upstream_outage

/** Monotonic counter for outage queue ordering — initialized from DB on first use to survive restarts */
let outageSeqCounter: number | null = null
/** Mutex guard to prevent concurrent initialization racing on the same DB query */
let initPromise: Promise<void> | null = null

async function getNextOutageSeq(): Promise<number> {
  if (outageSeqCounter === null) {
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const result = await masterClient.$queryRawUnsafe<{ max: number }[]>(
            `SELECT COALESCE(MAX("localSeq"), 0) as max FROM "OutageQueueEntry" WHERE status = 'PENDING'`
          )
          outageSeqCounter = Number(result[0]?.max ?? 0)
        } catch {
          // If query fails (table doesn't exist yet, etc.), start from 0
          outageSeqCounter = 0
        }
      })()
    }
    await initPromise
  }
  return ++outageSeqCounter!
}

// ── Outage Detection ──────────────────────────────────────────────────────────

/** Number of consecutive sync failures before declaring outage */
const OUTAGE_THRESHOLD = 3

/**
 * Check whether the upstream sync is currently in outage mode.
 * When true, Neon is unreachable and writes should be queued locally.
 */
export function isInOutageMode(): boolean {
  return outageState.isInOutage
}

/**
 * Queue a write to the OutageQueueEntry table for later replay.
 * Called by API routes when isInOutageMode() is true to avoid losing data.
 */
// Cap outage queue to prevent disk exhaustion during extended outages
const MAX_OUTAGE_QUEUE_SIZE = parseInt(process.env.MAX_OUTAGE_QUEUE_SIZE || '', 10) || 100000

// P1-5: Soft threshold — drop low-priority tables when queue is getting large
const OUTAGE_QUEUE_SOFT_LIMIT = 10000
/** Tables that can be dropped under pressure (non-financial, reconstructable from source data) */
const LOW_PRIORITY_OUTAGE_TABLES = new Set(['VenueLog', 'AuditLog', 'SocketEventLog', 'SyncConflict'])

export async function queueOutageWrite(
  tableName: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>,
  locationId: string,
): Promise<{ queued: boolean; reason?: string }> {
  // Check queue size before inserting
  try {
    const [{ count }] = await masterClient.$queryRawUnsafe<{ count: number }[]>(
      `SELECT COUNT(*)::int as count FROM "OutageQueueEntry" WHERE status = 'PENDING'`
    )
    // P1-5: Soft limit — drop low-priority entries to preserve space for critical data
    if (count >= OUTAGE_QUEUE_SOFT_LIMIT && LOW_PRIORITY_OUTAGE_TABLES.has(tableName)) {
      log.warn({
        tableName, recordId, operation, locationId,
        queueSize: count,
        softLimit: OUTAGE_QUEUE_SOFT_LIMIT,
      }, 'Outage queue exceeded soft limit — dropping low-priority entry')
      return { queued: false, reason: 'soft_limit_low_priority' }
    }

    if (count >= MAX_OUTAGE_QUEUE_SIZE) {
      log.error({
        tableName, recordId, operation, locationId,
        queueSize: count,
        maxSize: MAX_OUTAGE_QUEUE_SIZE,
      }, 'CRITICAL: Outage queue full — write NOT queued. Manual reconciliation required.')
      void notifyDataChanged({
        locationId,
        domain: 'sync',
        action: 'queue_overflow',
        entityId: recordId,
      })
      return { queued: false, reason: 'queue_full' }
    }
  } catch {
    // If count check fails, still try to queue (better to have data than lose it)
  }

  try {
    // Monotonic localSeq — initialized from DB on first use to survive restarts
    const localSeq = await getNextOutageSeq()
    // Idempotency key: deterministic prefix (for debugging) + random suffix (for uniqueness across retries/restarts)
    const idempotencyKey = `${locationId}:${tableName}:${recordId}:${randomUUID().slice(0, 8)}`

    await masterClient.$executeRawUnsafe(
      `INSERT INTO "OutageQueueEntry" (id, "tableName", "recordId", operation, payload, "locationId", status, "localSeq", "idempotencyKey", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, 'PENDING', $6, $7, NOW())`,
      tableName,
      recordId,
      operation,
      JSON.stringify(payload),
      locationId,
      localSeq,
      idempotencyKey,
    )
    return { queued: true }
  } catch (err) {
    log.error({ err, table: tableName, recordId }, 'Failed to queue outage write')
    return { queued: false, reason: 'insert_failed' }
  }
}

/** Cached column names per table (loaded once at startup, refreshed periodically) */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression (e.g., '::timestamptz') */
const columnTypeMap = new Map<string, Map<string, string>>()

// P3-3: Periodic column metadata refresh (every 10 minutes)
const UPSTREAM_COLUMN_CACHE_TTL = 10 * 60 * 1000
let upstreamColumnCacheTimestamp = 0

let timer: ReturnType<typeof setInterval> | null = null
/** Guard against overlapping sync cycles */
let cycleRunning = false

// ── Connectivity check cache ─────────────────────────────────────────────────
let lastConnectivityCheck = 0
let lastConnectivityResult = false
const CONNECTIVITY_CACHE_TTL = 5_000 // 5 seconds

async function checkConnectivity(): Promise<boolean> {
  const now = Date.now()
  if (now - lastConnectivityCheck < CONNECTIVITY_CACHE_TTL) {
    return lastConnectivityResult
  }
  try {
    await neonClient!.$queryRawUnsafe<unknown[]>(`SELECT 1`)
    lastConnectivityResult = true
  } catch {
    lastConnectivityResult = false
  }
  lastConnectivityCheck = now
  return lastConnectivityResult
}

/**
 * FK violation retry tracker: "tableName:recordId" → { count, firstSeen }.
 * After FK_MAX_RETRIES failures, the row is stamped as synced to prevent infinite loops.
 * Entries older than 5 minutes are pruned at the end of each sync cycle.
 */
const fkRetryMap = new Map<string, { count: number; firstSeen: number }>()
const FK_MAX_RETRIES = 5
const FK_RETRY_PRUNE_AGE = 5 * 60 * 1000 // 5 minutes

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialize a JS/Prisma value for parameterized SQL */
function serializeValue(val: unknown, isPgArray = false): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'bigint') return val.toString()
  // PG ARRAY columns (e.g., TEXT[]) → PG array literal: {"a","b"}
  // JSON/JSONB columns with array values stay as JSON: ["a","b"]
  if (Array.isArray(val)) {
    if (isPgArray) {
      if (val.length === 0) return '{}'
      return `{${val.map((v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')}}`
    }
    return JSON.stringify(val)
  }
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
      log.error({ err, table: tableName }, 'Failed to load columns')
    }
  }
  log.info({ tables: columnCache.size }, 'Column metadata loaded')
}

/** Build PG type cast from column metadata */
function buildCast(dataType: string, udtName: string): string {
  // CRITICAL: Use ::timestamp (not ::timestamptz) for "timestamp without time zone"
  // columns. Using ::timestamptz causes PostgreSQL to convert from UTC to the session
  // timezone (e.g., America/Denver = -7h) before storing, which silently shifts all
  // timestamps by the timezone offset when Prisma reads them back as UTC.
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

  const quotedSelectCols = columns.map((c) => `"${c}"`).join(', ')
  // FOR UPDATE SKIP LOCKED: hold row-level locks until syncedAt is stamped.
  // Prevents race condition where a row modified between read and stamp becomes
  // permanently unsyncable (updatedAt < syncedAt). SKIP LOCKED ensures concurrent
  // sync cycles or API writes don't block — they simply skip locked rows.
  const rows = await masterClient.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${quotedSelectCols} FROM "${tableName}" WHERE ${whereClause} ORDER BY "updatedAt" ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
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
        log.warn({ err: versionErr, table: tableName }, 'syncVersion increment failed (will sync without version)')
      }
    }

    try {
      await neonClient!.$transaction(async (neonTx) => {
        for (const row of chunk) {
          const values = upsertCols.map((col) => serializeValue(row[col], types?.get(col)?.endsWith('[]') ?? false))
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
        log.error({ err: stampErr, table: tableName, rowCount: chunk.length }, 'Batch syncedAt stamp failed (will retry next cycle)')
        metrics.errorCount++
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // Transaction failed — fall back to individual row sync for this chunk
      // so a single bad row doesn't block the rest
      for (const row of chunk) {
        try {
          const values = upsertCols.map((col) => serializeValue(row[col], types?.get(col)?.endsWith('[]') ?? false))
          await neonClient!.$executeRawUnsafe(sql, ...values)

          await masterClient.$executeRawUnsafe(
            `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
            row.id as string
          )
          synced++
        } catch (rowErr) {
          const rowErrMsg = rowErr instanceof Error ? rowErr.message : String(rowErr)

          if (rowErrMsg.includes('unique constraint') || rowErrMsg.includes('duplicate key') || rowErrMsg.includes('Unique constraint')) {
            log.warn({ table: tableName, recordId: row.id }, 'Unique constraint violation on Neon — marking synced to prevent retry loop')
            try {
              await masterClient.$executeRawUnsafe(
                `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
                row.id as string
              )
            } catch {
              // Best effort
            }
          } else if (rowErrMsg.includes('foreign key') || rowErrMsg.includes('violates foreign key') || rowErrMsg.includes('23503')) {
            // FK violation: parent row may not have synced yet. Don't stamp syncedAt —
            // the row will retry next cycle when the parent may have been synced.
            // Track retries to prevent infinite loops if parent is genuinely missing.
            const fkKey = `${tableName}:${row.id as string}`
            const existing = fkRetryMap.get(fkKey)
            const fkCount = (existing?.count || 0) + 1
            fkRetryMap.set(fkKey, { count: fkCount, firstSeen: existing?.firstSeen || Date.now() })

            if (fkCount >= FK_MAX_RETRIES) {
              log.error({ table: tableName, recordId: row.id, fkRetries: fkCount, errMsg: rowErrMsg },
                'FK violation persisted after max retries — marking synced to prevent infinite loop')
              try {
                await masterClient.$executeRawUnsafe(
                  `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
                  row.id as string
                )
              } catch {
                // Best effort
              }
              fkRetryMap.delete(fkKey)
            } else {
              log.warn({ table: tableName, recordId: row.id, fkRetries: fkCount, maxRetries: FK_MAX_RETRIES, errMsg: rowErrMsg },
                'FK violation — will retry next cycle (parent may not have synced yet)')
            }
          } else {
            log.error({ table: tableName, recordId: row.id, errMsg: rowErrMsg }, 'Row sync failed')
          }
          metrics.errorCount++
        }
      }
    }
  }

  return synced
}

/**
 * Batch-check which upstream tables have pending (unsynced) rows.
 * Returns a Map of tableName → pendingCount for tables with count > 0.
 * Replaces 100+ individual COUNT(*) queries with a single UNION ALL query.
 */
async function batchCountPendingTables(
  entries: [number, [string, SyncModelConfig]][]
): Promise<Map<string, number>> {
  const parts: string[] = []
  for (const [, [tableName]] of entries) {
    const columns = columnCache.get(tableName)
    if (!columns) continue
    if (!columns.includes('syncedAt') || !columns.includes('updatedAt')) continue

    const isBiDir = biDirModels.has(tableName) && columns.includes('lastMutatedBy')
    const biDirFilter = isBiDir ? ` AND ("lastMutatedBy" IS NULL OR "lastMutatedBy" != 'cloud')` : ''
    const whereClause = `"updatedAt" > COALESCE("syncedAt", '1970-01-01'::timestamptz)${biDirFilter}`

    parts.push(`SELECT '${tableName}' as tablename, COUNT(*)::int as count FROM "${tableName}" WHERE ${whereClause}`)
  }

  if (parts.length === 0) return new Map()

  const sql = `SELECT tablename, count FROM (${parts.join(' UNION ALL ')}) counts WHERE count > 0`
  const rows = await masterClient.$queryRawUnsafe<{ tablename: string; count: number }[]>(sql)

  return new Map(rows.map(r => [r.tablename, r.count]))
}

async function runSyncCycle(): Promise<void> {
  if (!hasNeonConnection()) return
  if (cycleRunning) return // Prevent overlapping cycles
  cycleRunning = true
  // Per-cycle trace ID for log correlation (short UUID prefix for readability)
  const cycleId = randomUUID().slice(0, 8)

  try {
    // P3-3: Refresh column metadata if cache TTL has expired (picks up schema changes)
    if (Date.now() - upstreamColumnCacheTimestamp > UPSTREAM_COLUMN_CACHE_TTL) {
      await loadColumnMetadata()
      upstreamColumnCacheTimestamp = Date.now()
      log.info('Column metadata cache refreshed (TTL expired)')
    }

    // Quick connectivity check — if Neon is unreachable, bail early
    // Cached for 10s to avoid hammering Neon with SELECT 1 on every cycle
    const isConnected = await checkConnectivity()
    if (!isConnected) {
      outageState.consecutiveFailures++
      metrics.errorCount++
      if (outageState.consecutiveFailures >= OUTAGE_THRESHOLD && !outageState.isInOutage) {
        outageState.isInOutage = true
        log.warn({ consecutiveFailures: outageState.consecutiveFailures }, 'OUTAGE DETECTED — queuing writes')
        const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
        if (locId) void dispatchOutageStatus(locId, true).catch((err) => log.error({ err }, 'Failed to dispatch outage status'))
      }
      return
    }

    // Connectivity restored — clear outage if active
    if (outageState.isInOutage) {
      log.info({ consecutiveFailures: outageState.consecutiveFailures }, 'Connectivity restored — exiting outage mode')
      outageState.isInOutage = false
      // Reset connectivity cache so next cycle gets a fresh check
      lastConnectivityCheck = 0
      const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
      if (locId) void dispatchOutageStatus(locId, false).catch((err) => log.error({ err }, 'Failed to dispatch outage-cleared status'))

      // Outage recovery: detect Payment records created during outage that were
      // never queued to OutageQueueEntry (e.g., PAT, retry-capture routes create
      // Payment rows directly without outage queue awareness). These rows have
      // syncedAt IS NULL and will be picked up by the normal sync cycle below.
      // Also reset syncedAt on any Payment rows that may have been partially
      // synced (Neon tx committed but local stamp failed, then outage hit) —
      // the idempotent ON CONFLICT upsert makes re-sync safe.
      void (async () => {
        try {
          const [{ count }] = await masterClient.$queryRawUnsafe<{ count: number }[]>(
            `SELECT COUNT(*)::int as count FROM "Payment"
             WHERE "syncedAt" IS NULL
               AND "updatedAt" > NOW() - INTERVAL '24 hours'`
          )
          if (count > 0) {
            log.info({ count }, 'Unsynced Payment records detected after outage recovery — will sync in this cycle')
          }
          // Also check for Order records that may have been created during outage
          const [{ count: orderCount }] = await masterClient.$queryRawUnsafe<{ count: number }[]>(
            `SELECT COUNT(*)::int as count FROM "Order"
             WHERE "syncedAt" IS NULL
               AND "updatedAt" > NOW() - INTERVAL '24 hours'`
          )
          if (orderCount > 0) {
            log.info({ count: orderCount }, 'Unsynced Order records detected after outage recovery — will sync in this cycle')
          }
        } catch (err) {
          log.warn({ err }, 'Failed to check for unsynced records after outage recovery')
        }
      })().catch((err) => log.error({ err }, 'Outage recovery scan failed'))
    }
    outageState.consecutiveFailures = 0

    const models = getUpstreamModels()
    let totalSynced = 0
    let totalPending = 0

    // FK-respecting batch order: group models by priority tier so parents sync
    // before children. Within the same tier, parallelize in batches of 5.
    // Models are already sorted by priority (ascending) from getUpstreamModels().
    const modelEntries = Array.from(models.entries()).filter(([, [tableName]]) => columnCache.has(tableName))

    // Batch-check which tables have pending rows — single UNION ALL query
    // replaces 100+ individual COUNT(*) queries per cycle
    let pendingTables: Map<string, number>
    try {
      pendingTables = await batchCountPendingTables(modelEntries)
      totalPending = Array.from(pendingTables.values()).reduce((sum, c) => sum + c, 0)
    } catch (err) {
      log.warn({ err }, 'Batch pending count failed — falling back to full table scan')
      // Fallback: treat all tables as potentially dirty
      pendingTables = new Map(modelEntries.map(([, [tableName]]) => [tableName, 1]))
    }

    // Only process tables with pending rows — skip idle tables entirely
    const activeEntries = modelEntries.filter(([, [tableName]]) => pendingTables.has(tableName))

    if (activeEntries.length > 0) {
      log.debug({ cycleId, active: activeEntries.length, total: modelEntries.length }, 'Tables with pending rows')
    }

    // Group active models into FK tiers by priority value. Models at the same priority
    // level have no FK dependencies between them and can safely run in parallel.
    const tiers = new Map<number, typeof activeEntries>()
    for (const entry of activeEntries) {
      const priority = entry[1][1].priority
      if (!tiers.has(priority)) tiers.set(priority, [])
      tiers.get(priority)!.push(entry)
    }
    // Process tiers in priority order (lowest first = parents before children)
    const sortedTierKeys = Array.from(tiers.keys()).sort((a, b) => a - b)

    for (const tierKey of sortedTierKeys) {
      const tierEntries = tiers.get(tierKey)!
      // Within a tier, parallelize in batches of 5 for throughput
      for (let i = 0; i < tierEntries.length; i += 5) {
        const batch = tierEntries.slice(i, i + 5)
        const results = await Promise.allSettled(
          batch.map(async ([, [tableName, config]]) => {
            const synced = await syncTable(tableName, config.batchSize)
            if (synced > 0) {
              log.info({ cycleId, table: tableName, rows: synced }, 'Table synced')
            }
            return { synced, pending: pendingTables.get(tableName) ?? 0 }
          })
        )
        for (const result of results) {
          if (result.status === 'fulfilled') {
            totalSynced += result.value.synced
          } else {
            metrics.errorCount++
          }
        }
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
            isOutage: outageState.isInOutage,
            timestamp: new Date().toISOString(),
          })
        } catch { /* relay not available */ }
      })().catch((err) => log.error({ err }, 'Relay emit failed'))
    }

    if (totalSynced > 0) {
      log.info({ cycleId, synced: totalSynced, pending: metrics.pendingCount }, 'Cycle complete')
    }
  } catch (err) {
    log.error({ cycleId, err }, 'Cycle error')
    metrics.errorCount++
    outageState.consecutiveFailures++

    // Write to venue diagnostic log (fire-and-forget, dynamic import to avoid circular deps)
    void import('../venue-logger').then(({ logVenueEvent }) =>
      logVenueEvent({
        level: outageState.consecutiveFailures >= 3 ? 'error' : 'warn',
        source: 'sync',
        category: 'sync',
        message: `Upstream sync cycle failed (attempt ${outageState.consecutiveFailures}): ${err instanceof Error ? err.message : String(err)}`,
        details: { consecutiveFailures: outageState.consecutiveFailures, totalSynced: 0 },
        stackTrace: err instanceof Error ? err.stack : undefined,
      })
    ).catch((venueErr) => log.error({ err: venueErr }, 'Venue logger failed'))

    if (outageState.consecutiveFailures >= OUTAGE_THRESHOLD && !outageState.isInOutage) {
      outageState.isInOutage = true
      log.warn({ consecutiveFailures: outageState.consecutiveFailures }, 'OUTAGE DETECTED — queuing writes')
      const locId = process.env.POS_LOCATION_ID || process.env.LOCATION_ID
      if (locId) void dispatchOutageStatus(locId, true).catch((err2) => log.error({ err: err2 }, 'Failed to dispatch outage status'))
    }
  } finally {
    cycleRunning = false
    // Reset pending mutation counter so the next mutation fires immediately
    pendingMutationCount = 0

    // Prune FK retry entries older than 5 minutes to prevent unbounded map growth
    const now = Date.now()
    const fkKeys = Array.from(fkRetryMap.keys())
    for (const key of fkKeys) {
      const entry = fkRetryMap.get(key)
      if (entry && now - entry.firstSeen > FK_RETRY_PRUNE_AGE) {
        fkRetryMap.delete(key)
      }
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startUpstreamSyncWorker(): void {
  if (timer) return
  if (!hasNeonConnection()) {
    log.info('No Neon connection — worker disabled')
    return
  }

  log.info({ intervalMs: UPSTREAM_INTERVAL_MS }, 'Starting')
  metrics.running = true

  void (async () => {
    // Guard: don't start sync workers on standby NUC (INV-6)
    try {
      const [{ is_standby }] = await masterClient.$queryRawUnsafe<[{ is_standby: boolean }]>(
        'SELECT pg_is_in_recovery() as is_standby'
      )
      if (is_standby) {
        log.warn('Standby PostgreSQL detected — sync workers NOT started (INV-6)')
        metrics.running = false
        return
      }
    } catch {
      // If we can't check, assume primary (safe default — PG will reject writes if standby)
    }

    await loadColumnMetadata()
    upstreamColumnCacheTimestamp = Date.now()
    void runSyncCycle()
    timer = setInterval(() => void runSyncCycle(), UPSTREAM_INTERVAL_MS)
    timer.unref()
  })()
}

export function stopUpstreamSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    metrics.running = false
    log.info('Stopped')
  }
}

export function getUpstreamSyncMetrics(): SyncMetrics {
  return { ...metrics }
}

/**
 * Trigger an immediate upstream sync cycle (non-blocking).
 * Call after local mutations (orders, payments, tips) to push to Neon
 * instantly instead of waiting for the 5s timer.
 *
 * Smart batching: first mutation after a cycle fires near-instantly (5ms yield).
 * Subsequent mutations within the same window are batched by the existing timer.
 */
let pendingMutationCount = 0
let immediateUpstreamTimer: ReturnType<typeof setTimeout> | null = null

export function triggerImmediateUpstreamSync(): void {
  pendingMutationCount++
  if (pendingMutationCount === 1) {
    // First mutation since last cycle — sync near-instantly (yield event loop)
    if (immediateUpstreamTimer) clearTimeout(immediateUpstreamTimer)
    immediateUpstreamTimer = setTimeout(() => {
      immediateUpstreamTimer = null
      void runSyncCycle()
    }, 5)
  }
  // else: already have a pending timer from the first mutation, let it batch
}

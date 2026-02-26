/**
 * Downstream Sync Worker (Neon → NUC)
 *
 * Pulls cloud-authoritative data (menu items, employees, settings, etc.)
 * from Neon into the local PostgreSQL database every 15 seconds.
 *
 * Uses high-water marks per table to fetch only rows newer than the last
 * sync. Supports immediate triggering via DATA_CHANGED events from the
 * sync agent.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { neonClient, hasNeonConnection } from '../neon-client'
import { masterClient } from '../db'
import { getDownstreamModels, DOWNSTREAM_INTERVAL_MS } from './sync-config'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DownstreamMetrics {
  running: boolean
  lastSyncAt: Date | null
  rowsSyncedTotal: number
  conflictCount: number
}

// ── State ─────────────────────────────────────────────────────────────────────

const metrics: DownstreamMetrics = {
  running: false,
  lastSyncAt: null,
  rowsSyncedTotal: 0,
  conflictCount: 0,
}

/** High-water mark per table — only fetch rows newer than this */
const highWaterMarks = new Map<string, Date>()

/** Cached column names per table */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression (e.g., '::timestamptz') */
const columnTypeMap = new Map<string, Map<string, string>>()

let timer: ReturnType<typeof setInterval> | null = null
let immediateRunning = false

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Initialize high-water marks from MAX(updatedAt) in local PG */
async function initHighWaterMarks(): Promise<void> {
  const models = getDownstreamModels()
  for (const [tableName] of models) {
    try {
      const [row] = await masterClient.$queryRawUnsafe<{ max_updated: Date | null }[]>(
        `SELECT MAX("updatedAt") as max_updated FROM "${tableName}"`
      )
      if (row?.max_updated) {
        highWaterMarks.set(tableName, row.max_updated)
      } else {
        highWaterMarks.set(tableName, new Date('1970-01-01T00:00:00Z'))
      }
    } catch {
      // Table might not have updatedAt or might not exist — use epoch
      highWaterMarks.set(tableName, new Date('1970-01-01T00:00:00Z'))
    }
  }
  console.log(`[DownstreamSync] High-water marks initialized for ${highWaterMarks.size} tables`)
}

/** Load column names for all downstream tables */
async function loadColumnMetadata(): Promise<void> {
  const models = getDownstreamModels()
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
    } catch {
      // Skip tables that don't exist locally yet
    }
  }
  console.log(`[DownstreamSync] Column metadata loaded for ${columnCache.size} tables`)
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

async function syncTableDown(tableName: string, batchSize: number): Promise<number> {
  const columns = columnCache.get(tableName)
  if (!columns || columns.length === 0) return 0
  if (!columns.includes('updatedAt')) return 0

  const hwm = highWaterMarks.get(tableName) ?? new Date('1970-01-01T00:00:00Z')

  // Fetch rows from Neon newer than high-water mark
  // Use explicit column names instead of SELECT * to avoid "cached plan must not
  // change result type" errors from PgBouncer prepared statement caching after
  // schema changes on the Neon connection pooler.
  const quotedSelectCols = columns.map((c) => `"${c}"`).join(', ')
  const rows = await neonClient!.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${quotedSelectCols} FROM "${tableName}" WHERE "updatedAt" > $1::timestamptz ORDER BY "updatedAt" ASC LIMIT $2`,
    hwm.toISOString(),
    batchSize
  )

  if (rows.length === 0) return 0

  // Build upsert SQL for local PG
  const upsertCols = columns.filter((c) => c !== 'syncedAt')
  const quotedCols = upsertCols.map((c) => `"${c}"`).join(', ')
  const types = columnTypeMap.get(tableName)
  const placeholders = upsertCols.map((c, i) => `$${i + 1}${types?.get(c) ?? ''}`).join(', ')
  const updateSet = upsertCols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`

  let synced = 0
  let maxUpdatedAt = hwm

  for (const row of rows) {
    try {
      const values = upsertCols.map((col) => serializeValue(row[col]))
      await masterClient.$executeRawUnsafe(sql, ...values)

      // Stamp syncedAt locally if the column exists
      if (columns.includes('syncedAt')) {
        await masterClient.$executeRawUnsafe(
          `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
          row.id as string
        )
      }

      // Track max updatedAt for high-water mark
      const rowUpdatedAt = row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(row.updatedAt as string)
      if (rowUpdatedAt > maxUpdatedAt) {
        maxUpdatedAt = rowUpdatedAt
      }

      synced++
    } catch (err) {
      console.error(
        `[DownstreamSync] ${tableName} row ${row.id}:`,
        err instanceof Error ? err.message : err
      )
      metrics.conflictCount++
    }
  }

  // Advance high-water mark
  if (synced > 0) {
    highWaterMarks.set(tableName, maxUpdatedAt)
  }

  return synced
}

async function runDownstreamCycle(): Promise<void> {
  if (!hasNeonConnection()) return

  try {
    const models = getDownstreamModels()
    let totalSynced = 0

    for (const [tableName, config] of models) {
      if (!columnCache.has(tableName)) continue

      try {
        const synced = await syncTableDown(tableName, config.batchSize)
        totalSynced += synced

        if (synced > 0) {
          console.log(`[DownstreamSync] ${tableName}: ${synced} rows`)
        }
      } catch (err) {
        console.error(
          `[DownstreamSync] Table ${tableName}:`,
          err instanceof Error ? err.message : err
        )
      }
    }

    metrics.lastSyncAt = new Date()
    metrics.rowsSyncedTotal += totalSynced

    if (totalSynced > 0) {
      console.log(`[DownstreamSync] Cycle: ${totalSynced} rows synced`)
    }
  } catch (err) {
    console.error('[DownstreamSync] Cycle error:', err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startDownstreamSyncWorker(): void {
  if (timer) return
  if (!hasNeonConnection()) {
    console.log('[DownstreamSync] No Neon connection — worker disabled')
    return
  }

  console.log(`[DownstreamSync] Starting (interval: ${DOWNSTREAM_INTERVAL_MS}ms)`)
  metrics.running = true

  void Promise.all([initHighWaterMarks(), loadColumnMetadata()]).then(() => {
    void runDownstreamCycle()
    timer = setInterval(() => void runDownstreamCycle(), DOWNSTREAM_INTERVAL_MS)
    timer.unref()
  })
}

export function stopDownstreamSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    metrics.running = false
    console.log('[DownstreamSync] Stopped')
  }
}

export function getDownstreamSyncMetrics(): DownstreamMetrics {
  return { ...metrics }
}

/**
 * Trigger an immediate downstream sync cycle (non-blocking).
 * Called when DATA_CHANGED arrives from the sync agent.
 */
export async function triggerImmediateDownstreamSync(_domain?: string): Promise<void> {
  if (immediateRunning) return
  immediateRunning = true
  try {
    await runDownstreamCycle()
  } finally {
    immediateRunning = false
  }
}

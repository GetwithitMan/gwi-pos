/**
 * Upstream Sync Worker (NUC → Neon)
 *
 * Pushes NUC-authoritative data (orders, payments, shifts, tips, etc.)
 * to the Neon cloud database every 5 seconds. Each row is individually
 * upserted so a single failure doesn't block the batch.
 *
 * Only runs when SYNC_ENABLED=true and NEON_DATABASE_URL is configured.
 */

import { neonClient, hasNeonConnection } from '../neon-client'
import { masterClient } from '../db'
import { getUpstreamModels, UPSTREAM_INTERVAL_MS } from './sync-config'

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

/** Cached column names per table (loaded once at startup) */
const columnCache = new Map<string, string[]>()

let timer: ReturnType<typeof setInterval> | null = null

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Serialize a JS/Prisma value for parameterized SQL */
function serializeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null
  if (val instanceof Date) return val.toISOString()
  if (typeof val === 'bigint') return val.toString()
  if (typeof val === 'object') {
    if ((val as { constructor?: { name?: string } }).constructor?.name === 'Decimal') {
      return (val as { toString(): string }).toString()
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
      const cols = await masterClient.$queryRawUnsafe<{ column_name: string }[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`,
        tableName
      )
      if (cols.length > 0) {
        columnCache.set(tableName, cols.map((c) => c.column_name))
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

// ── Core sync logic ───────────────────────────────────────────────────────────

async function syncTable(tableName: string, batchSize: number): Promise<number> {
  const columns = columnCache.get(tableName)
  if (!columns || columns.length === 0) return 0

  // Find rows where updatedAt > syncedAt (unsynced changes)
  const hasSyncedAt = columns.includes('syncedAt')
  const hasUpdatedAt = columns.includes('updatedAt')
  if (!hasUpdatedAt) return 0 // Can't track changes without updatedAt

  const whereClause = hasSyncedAt
    ? `"updatedAt" > COALESCE("syncedAt", '1970-01-01'::timestamptz)`
    : `"syncedAt" IS NULL` // Tables without updatedAt: sync anything unsynced

  const rows = await masterClient.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${tableName}" WHERE ${whereClause} ORDER BY "updatedAt" ASC LIMIT $1`,
    batchSize
  )

  if (rows.length === 0) return 0

  // Columns to upsert (exclude syncedAt — that's local tracking only)
  const upsertCols = columns.filter((c) => c !== 'syncedAt')
  const quotedCols = upsertCols.map((c) => `"${c}"`).join(', ')
  const placeholders = upsertCols.map((_, i) => `$${i + 1}`).join(', ')
  const updateSet = upsertCols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}`

  let synced = 0
  for (const row of rows) {
    try {
      const values = upsertCols.map((col) => serializeValue(row[col]))
      await neonClient!.$executeRawUnsafe(sql, ...values)

      // Stamp syncedAt locally
      await masterClient.$executeRawUnsafe(
        `UPDATE "${tableName}" SET "syncedAt" = NOW() WHERE id = $1`,
        row.id as string
      )

      synced++
    } catch (err) {
      console.error(
        `[UpstreamSync] ${tableName} row ${row.id}:`,
        err instanceof Error ? err.message : err
      )
      metrics.errorCount++
    }
  }

  return synced
}

async function runSyncCycle(): Promise<void> {
  if (!hasNeonConnection()) return

  try {
    const models = getUpstreamModels()
    let totalSynced = 0
    let totalPending = 0

    for (const [tableName, config] of models) {
      if (!columnCache.has(tableName)) continue

      try {
        const columns = columnCache.get(tableName)!
        const hasSyncedAt = columns.includes('syncedAt')
        const hasUpdatedAt = columns.includes('updatedAt')
        if (!hasUpdatedAt) continue

        // Count pending rows
        const whereClause = hasSyncedAt
          ? `"updatedAt" > COALESCE("syncedAt", '1970-01-01'::timestamptz)`
          : `"syncedAt" IS NULL`
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

    if (totalSynced > 0) {
      console.log(
        `[UpstreamSync] Cycle: ${totalSynced} synced, ${metrics.pendingCount} pending`
      )
    }
  } catch (err) {
    console.error('[UpstreamSync] Cycle error:', err)
    metrics.errorCount++
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

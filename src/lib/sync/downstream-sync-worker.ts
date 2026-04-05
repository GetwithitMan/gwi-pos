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

// NOTE: Inline async imports (await import(...)) are used for socket modules
// to avoid circular dependencies. These should be converted to top-level imports
// once the socket module dependency graph is cleaned up.

import { randomUUID } from 'crypto'
import { createChildLogger } from '@/lib/logger'
import { neonClient, hasNeonConnection } from '../neon-client'

const log = createChildLogger('downstream-sync')
import { masterClient } from '../db'
import { getDownstreamModels, getBidirectionalModelNames, getConflictStrategy, getBusinessKey, getSkipFields, DOWNSTREAM_INTERVAL_MS, type ConflictStrategy } from './sync-config'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig } from '../fulfillment-router'
import { syncDenyList } from '../cellular-auth'
import { checkQuarantine, QUARANTINE_PROTECTED_MODELS, loadWatermarks, updateDownstreamWatermark } from './sync-conflict-quarantine'
import { registerDownstreamHandler, dispatchDownstreamNotifications } from './downstream-notification-pipeline'
import { runReconciliationCheck } from './reconciliation-check'

// ── Initial sync completion tracking ──────────────────────────────────────────

let initialSyncResolve: (() => void) | null = null
let initialSyncDone = false
export const initialSyncComplete = new Promise<void>((resolve) => {
  initialSyncResolve = resolve
})

// ── Column metadata cache TTL ────────────────────────────────────────────────

const COLUMN_CACHE_TTL = 60 * 60 * 1000 // 1 hour
let columnCacheTimestamp = 0

// ── Types ─────────────────────────────────────────────────────────────────────

interface DownstreamMetrics {
  running: boolean
  lastSyncAt: Date | null
  rowsSyncedTotal: number
  conflictCount: number
}

// ── Shared singleton state via globalThis ─────────────────────────────────────
// CRITICAL: server.js (esbuild) and Next.js API routes (Turbopack/Webpack) load
// separate module copies. A module-level `const metrics` creates TWO independent
// singletons — server.ts sets one, API routes read the other (always default).
// Using globalThis ensures both module systems share the same metrics state.

declare global {
   
  var __gwi_downstream_metrics: DownstreamMetrics | undefined
}

if (globalThis.__gwi_downstream_metrics === undefined) {
  globalThis.__gwi_downstream_metrics = {
    running: false,
    lastSyncAt: null,
    rowsSyncedTotal: 0,
    conflictCount: 0,
  }
}

const metrics = globalThis.__gwi_downstream_metrics

/** High-water mark per table — only fetch rows newer than this */
const highWaterMarks = new Map<string, Date>()

/** Cached column names per table */
const columnCache = new Map<string, string[]>()
/** Cached column PG casts: tableName → columnName → cast expression (e.g., '::timestamptz') */
const columnTypeMap = new Map<string, Map<string, string>>()

let timer: ReturnType<typeof setInterval> | null = null
let immediateRunning = false
/** Buffered DATA_CHANGED request — replayed after current immediate cycle completes */
let pendingImmediateModels: string[] | null = null
/** Guard against overlapping sync cycles */
let cycleRunning = false
/** Consecutive cycles with zero rows synced — drives idle backoff */
let consecutiveIdleCycles = 0
/** Idle backoff: after 3 consecutive no-op cycles, switch to 15s polling */
const IDLE_BACKOFF_THRESHOLD = 3
const IDLE_INTERVAL_MS = 15_000

/** Batched menu-update locations — collected per sync cycle, emitted once after all tables complete. */
const menuUpdateLocations = new Set<string>()
/** Batched floor-plan-update locations — collected per sync cycle, emitted once after all tables complete. */
const floorPlanUpdateLocations = new Set<string>()
/**
 * Layout signature cache — suppresses floor-plan:updated for Table rows where only
 * status changed (not layout). Keyed by "locationId:tableId" for global uniqueness.
 * Cleared naturally on worker restart. First sighting of a table always emits once.
 */
const tableLayoutSigCache = new Map<string, string>()
/** Menu-related models whose socket events are batched per sync cycle instead of per-row. */
const BATCHED_MENU_MODELS = new Set(['MenuItem', 'Category', 'ModifierGroup', 'Modifier', 'ComboTemplate', 'ComboComponent', 'ComboComponentOption', 'ModifierGroupTemplate', 'ModifierTemplate', 'PricingOptionGroup', 'PricingOption', 'ItemBarcode', 'PizzaConfig', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese', 'PizzaTopping', 'PizzaSpecialty', 'BottleProduct', 'SpiritCategory', 'SpiritModifierGroup', 'BottleServiceTier', 'MenuItemRecipe', 'RecipeIngredient'])
/** Per-table-batch deduplication for open-orders socket dispatch (cleared in syncTableDown) */
const notificationDispatchedLocations = new Set<string>()

/** Reconciliation check interval — 5 minutes */
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000
/** Timestamp of last reconciliation check */
let lastReconciliationAt = 0

/**
 * Catalog tables use ID-swap instead of delete for business-key conflicts.
 * When a Neon row has a different ID but matching business key to a local row,
 * we UPDATE the local row's ID to match Neon's ID. PostgreSQL FK constraints
 * (ON UPDATE CASCADE) cascade the change to all child rows, preserving the
 * entire catalog graph (e.g., MenuItem→Category, Modifier→ModifierGroup).
 *
 * If the ID-swap fails (target ID exists, FK issues), falls back to soft-delete
 * + SyncConflict record for operator review.
 *
 * Hard-deleting or soft-deleting a Category/MenuItem/ModifierGroup/Modifier
 * can leave orphaned child rows and partial catalog graphs during convergence.
 */
const CATALOG_QUARANTINE_TABLES = new Set(['Category', 'MenuItem', 'ModifierGroup', 'Modifier'])

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Ensure the _gwi_sync_state table exists for persisted high-water marks */
async function ensureSyncStateTable(): Promise<void> {
  try {
    await masterClient.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "_gwi_sync_state" (
        table_name TEXT PRIMARY KEY,
        high_water_mark TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    )
  } catch (err) {
    log.error({ err }, 'Failed to create _gwi_sync_state table')
  }
}

/** Initialize high-water marks — prefer persisted DB state, fall back to epoch.
 *
 * IMPORTANT: We use epoch (not MAX(updatedAt)) as the fallback for tables without
 * a persisted HWM. Using MAX(updatedAt) from local PG skips any Neon rows that
 * were never synced but have updatedAt < the local max — this is the root cause
 * of the "HWM gap" bug where items exist on Neon but never appear on the NUC.
 * Starting from epoch triggers a full re-sync which is safe: the ON CONFLICT
 * upsert handles duplicates, and the batch size limits per-cycle load.
 */
async function initHighWaterMarks(): Promise<void> {
  await ensureSyncStateTable()

  // Check if venue was recently reprovisioned — if so, reset HWMs to epoch
  // to ensure full re-sync after clone/reset/reprovision
  try {
    const schemaState = await masterClient.$queryRawUnsafe(`
      SELECT "provisionedAt" FROM "_venue_schema_state" WHERE id = 1
    `) as Array<{ provisionedAt: Date | null }>

    if (schemaState.length > 0 && schemaState[0].provisionedAt) {
      const provisionedAt = new Date(schemaState[0].provisionedAt)
      // Check if provisionedAt is very recent (last 5 min) — if so, reset HWMs
      // to force a full re-sync. This is a simple heuristic: if we were just
      // reprovisioned, stale HWMs could prevent re-syncing data that changed
      // during the reset.
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
      if (provisionedAt > fiveMinAgo) {
        // Reset HWMs to 1 hour before provisioning — catches recent changes without full re-sync
        // Full epoch reset would pull 100K+ rows and spike load for 30+ seconds
        const resetTo = new Date(provisionedAt.getTime() - 60 * 60 * 1000).toISOString()
        log.info({ provisionedAt, resetTo }, 'Recent reprovision detected — resetting downstream HWMs to 1 hour before provision')
        await masterClient.$executeRawUnsafe(
          `UPDATE "_gwi_sync_state" SET high_water_mark = $1`,
          resetTo
        )
      }
    }
  } catch {
    // _venue_schema_state may not exist yet — safe to ignore
  }

  // Load persisted HWMs from _gwi_sync_state
  const persistedHwms = new Map<string, Date>()
  try {
    const rows = await masterClient.$queryRawUnsafe<{ table_name: string; high_water_mark: string }[]>(
      `SELECT table_name, high_water_mark FROM "_gwi_sync_state"`
    )
    for (const row of rows) {
      persistedHwms.set(row.table_name, new Date(row.high_water_mark))
    }
  } catch {
    // Table may not exist yet or be empty — all tables start from epoch
  }

  const models = getDownstreamModels()
  for (const [tableName] of models) {
    if (persistedHwms.has(tableName)) {
      highWaterMarks.set(tableName, persistedHwms.get(tableName)!)
    } else {
      // No persisted HWM — start from epoch so we do a full initial sync
      highWaterMarks.set(tableName, new Date('1970-01-01T00:00:00Z'))
    }
  }
  log.info({ total: highWaterMarks.size, fromDb: persistedHwms.size, fromEpoch: highWaterMarks.size - persistedHwms.size }, 'High-water marks initialized')
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

async function syncTableDown(tableName: string, batchSize: number): Promise<number> {
  const columns = columnCache.get(tableName)
  if (!columns || columns.length === 0) return 0
  if (!columns.includes('updatedAt')) return 0

  // Reset per-batch deduplication for notification pipeline socket dispatch
  notificationDispatchedLocations.clear()

  const hwm = highWaterMarks.get(tableName) ?? new Date('1970-01-01T00:00:00Z')

  // Bidirectional models: only pull cloud-originated rows downstream
  const isBiDir = biDirModels.has(tableName)
  const biDirFilter = isBiDir ? ` AND "lastMutatedBy" = 'cloud'` : ''

  // Fetch rows from Neon newer than high-water mark
  // Use explicit column names instead of SELECT * to avoid "cached plan must not
  // change result type" errors from PgBouncer prepared statement caching after
  // schema changes on the Neon connection pooler.
  const quotedSelectCols = columns.map((c) => `"${c}"`).join(', ')
  const rows = await neonClient!.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT ${quotedSelectCols} FROM "${tableName}" WHERE "updatedAt" >= $1::timestamptz${biDirFilter} ORDER BY "updatedAt" ASC LIMIT $2`,
    hwm.toISOString(),
    batchSize
  )

  if (rows.length === 0) return 0

  // Build upsert SQL for local PG
  // For bidirectional models: only update if local row hasn't been mutated locally
  // (lastMutatedBy is still 'cloud' or NULL). If local device mutated it → skip update.
  const upsertCols = columns.filter((c) => c !== 'syncedAt')
  const quotedCols = upsertCols.map((c) => `"${c}"`).join(', ')
  const types = columnTypeMap.get(tableName)
  const placeholders = upsertCols.map((c, i) => `$${i + 1}${types?.get(c) ?? ''}`).join(', ')
  // skipFields: columns that are included in INSERT (for new rows) but excluded
  // from ON CONFLICT UPDATE (to preserve locally-set values like pairing state)
  const skip = getSkipFields(tableName)
  const updateSet = upsertCols
    .filter((c) => c !== 'id' && (!skip || !skip.has(c)))
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  // Bidirectional conflict guard: only overwrite if local row is still cloud-owned
  const biDirConflictGuard = isBiDir
    ? ` WHERE "${tableName}"."lastMutatedBy" = 'cloud' OR "${tableName}"."lastMutatedBy" IS NULL`
    : ''

  const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}${biDirConflictGuard}`

  let synced = 0
  let maxSyncedAt = hwm   // Only tracks successfully synced rows — failed rows must NOT advance HWM
  /** Minimum timestamp of any failed row — HWM must not advance past this so the failed row is retried */
  let minFailedAt: Date | null = null
  const strategy = getConflictStrategy(tableName)
  /** Collect IDs of successfully synced rows for batch syncedAt stamping */
  const syncedIds: string[] = []
  /** Per-location max synced timestamp for downstream watermark updates */
  const locationWatermarks = new Map<string, Date>()

  // ── Batch pre-fetch local rows for conflict detection (avoids N per-row queries) ──
  let localRowMap = new Map<string, Record<string, unknown>>()
  if (isBiDir) {
    try {
      const incomingIds = rows.map(r => r.id as string).filter(Boolean)
      if (incomingIds.length > 0) {
        const quotedLocalCols = columns.map((c) => `"${c}"`).join(', ')
        const localRows = await masterClient.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT ${quotedLocalCols} FROM "${tableName}" WHERE id = ANY($1::text[])`,
          incomingIds,
        )
        for (const lr of localRows) {
          if (lr.id) localRowMap.set(lr.id as string, lr)
        }
      }
    } catch (batchErr) {
      // Batch pre-fetch failed — per-row fallback will be used
      log.warn({ err: batchErr, table: tableName }, 'Batch local row pre-fetch failed, falling back to per-row')
      localRowMap = new Map()
    }
  }

  // ── Batch pre-fetch business-key conflicts ──
  const bk = getBusinessKey(tableName)
  let bkConflictMap = new Map<string, { id: string; lastMutatedBy?: string | null; updatedAt?: Date | null }>()
  if (bk) {
    try {
      const hasLastMutatedBy = columns.includes('lastMutatedBy')
      const lmbCol = hasLastMutatedBy ? ', "lastMutatedBy"' : ''
      const hasUpdatedAtCol = columns.includes('updatedAt')
      const updCol = hasUpdatedAtCol ? ', "updatedAt"' : ''
      // Build composite key tuples for batch lookup
      const bkTuples = rows
        .filter(r => r.id)
        .map(r => bk!.map(col => serializeValue(r[col], false)))
      if (bkTuples.length > 0 && bk.length === 1) {
        // Single-column business key — use ANY()
        const vals = bkTuples.map(t => t[0])
        const bkRows = await masterClient.$queryRawUnsafe<{ id: string; lastMutatedBy?: string | null; updatedAt?: Date | null }[]>(
          `SELECT id${lmbCol}${updCol}, "${bk[0]}" FROM "${tableName}" WHERE "${bk[0]}" = ANY($1)`,
          vals,
        )
        for (const br of bkRows) {
          const key = String((br as any)[bk[0]])
          bkConflictMap.set(key, br)
        }
      }
      // Multi-column business keys use per-row fallback (too complex for batch)
    } catch (bkBatchErr) {
      log.warn({ err: bkBatchErr, table: tableName }, 'Batch business-key pre-fetch failed, falling back to per-row')
      bkConflictMap = new Map()
    }
  }

  for (const row of rows) {
    try {
      // Bidirectional conflict detection: check if local row was modified locally
      if (isBiDir && row.id) {
        const isProtected = QUARANTINE_PROTECTED_MODELS.has(tableName)

        if (isProtected) {
          // ── Quarantine path for money-impact models ──────────────────────
          // Use batch pre-fetched local row (falls back to per-row query if not found)
          const hasUpdatedAt = columns.includes('updatedAt')
          if (hasUpdatedAt) {
            try {
              let localRow = localRowMap.get(row.id as string) ?? null
              if (!localRow && localRowMap.size === 0) {
                // Batch pre-fetch failed — fall back to per-row query
                const quotedLocalCols = columns.map((c) => `"${c}"`).join(', ')
                const localRows = await masterClient.$queryRawUnsafe<Record<string, unknown>[]>(
                  `SELECT ${quotedLocalCols} FROM "${tableName}" WHERE id = $1 LIMIT 1`,
                  row.id as string,
                )
                localRow = localRows.length > 0 ? localRows[0] : null
              }
              const localUpdatedAt = localRow?.updatedAt
                ? (localRow.updatedAt instanceof Date ? localRow.updatedAt : new Date(localRow.updatedAt as string))
                : null
              const incomingUpdatedAt = row.updatedAt instanceof Date
                ? row.updatedAt
                : new Date(row.updatedAt as string)
              const rowLocationId = (row.locationId as string) || ''

              // Read syncVersion from both local and incoming rows (if column exists)
              const hasSyncVersion = columns.includes('syncVersion')
              const localSyncVersion = hasSyncVersion && localRow?.syncVersion != null
                ? Number(localRow.syncVersion)
                : null
              const incomingSyncVersion = hasSyncVersion && row.syncVersion != null
                ? Number(row.syncVersion)
                : null

              const decision = await checkQuarantine(
                tableName,
                row.id as string,
                incomingUpdatedAt,
                localUpdatedAt,
                rowLocationId,
                (localRow ?? {}) as Record<string, unknown>,
                row as Record<string, unknown>,
                incomingSyncVersion,
                localSyncVersion,
              )

              if (decision === 'quarantine') {
                // Future blocking mode — skip the upsert
                if (incomingUpdatedAt > maxSyncedAt) {
                  maxSyncedAt = incomingUpdatedAt
                }
                continue
              }

              // checkQuarantine returned 'apply' — still run the existing
              // detectBidirectionalConflict for lastMutatedBy / NTP guard logic
              // so local-wins rows are not overwritten.
              // Pass the pre-fetched localRow to avoid a redundant SELECT query.
              const conflictResult = await detectBidirectionalConflict(tableName, row, strategy, columns, localRow)
              if (conflictResult === 'skip') {
                if (incomingUpdatedAt > maxSyncedAt) {
                  maxSyncedAt = incomingUpdatedAt
                }
                continue
              }
            } catch (quarantineErr) {
              // Quarantine check failed — fall through to normal upsert (safe default)
              log.error({ err: quarantineErr, table: tableName, recordId: row.id }, 'Quarantine check failed')
            }
          }
        } else {
          // ── Standard bidirectional conflict detection for non-protected models ──
          const prefetchedLocal = localRowMap.get(row.id as string) ?? undefined
          const conflictResult = await detectBidirectionalConflict(tableName, row, strategy, columns, prefetchedLocal)
          if (conflictResult === 'skip') {
            // Local version is strictly newer and locally-mutated — skip Neon version
            const rowUpdatedAt = row.updatedAt instanceof Date
              ? row.updatedAt
              : new Date(row.updatedAt as string)
            if (rowUpdatedAt > maxSyncedAt) {
              maxSyncedAt = rowUpdatedAt
            }
            continue
          }
        }
      }

      // Business-key conflict resolution: if a cloud-owned downstream model has a
      // businessKey declared, check if a local row exists with the same business key
      // but a different id. This happens when items were created locally (pre-transition)
      // and then re-created in Neon with a different CUID. Since Neon is authoritative
      // for cloud-owned models, delete the local row so the Neon version can be inserted.
      const rowBk = getBusinessKey(tableName)
      if (rowBk && row.id) {
        // Try batch pre-fetched map first (single-column keys only)
        let conflicting: { id: string; lastMutatedBy?: string | null; updatedAt?: Date | null }[] = []
        const bkKey = rowBk.length === 1 ? String(serializeValue(row[rowBk[0]], false)) : null
        const bkCached = bkKey ? bkConflictMap.get(bkKey) : null
        if (bkCached && bkCached.id !== row.id) {
          conflicting = [bkCached]
        } else if (!bkKey || bkConflictMap.size === 0) {
          // Multi-column key or batch failed — per-row fallback
          const bkWhere = rowBk.map((col, i) => `"${col}" = $${i + 2}`).join(' AND ')
          const bkValues = rowBk.map((col) => serializeValue(row[col], false))
          const hasLastMutatedBy = columns.includes('lastMutatedBy')
          conflicting = await masterClient.$queryRawUnsafe<{ id: string; lastMutatedBy?: string | null; updatedAt?: Date | null }[]>(
            `SELECT id${hasLastMutatedBy ? ', "lastMutatedBy"' : ''}${columns.includes('updatedAt') ? ', "updatedAt"' : ''} FROM "${tableName}" WHERE ${bkWhere} AND "id" != $1 AND "deletedAt" IS NULL LIMIT 1`,
            row.id as string, ...bkValues
          )
        }
        if (conflicting.length > 0) {
          const local = conflicting[0]
          // Guard: if the local row was recently mutated locally (not by cloud),
          // skip the conflict resolution to avoid silently destroying local data.
          // Only resolve if local row is cloud-origin, null-origin, or older than Neon.
          const hasLastMutatedByCol = columns.includes('lastMutatedBy')
          const localIsLocallyMutated = hasLastMutatedByCol && local.lastMutatedBy === 'local'
          const neonUpdatedAt = row.updatedAt ? new Date(row.updatedAt as unknown as string) : null
          const localUpdatedAt = local.updatedAt ? new Date(local.updatedAt as unknown as string) : null
          const localIsNewer = neonUpdatedAt && localUpdatedAt && localUpdatedAt > neonUpdatedAt

          if (localIsLocallyMutated && localIsNewer) {
            // Local row was mutated locally AND is newer — skip, local wins
            log.warn(
              { table: tableName, localId: local.id, neonId: row.id },
              'Business-key conflict: local row is locally-mutated and newer — skipping (local wins)'
            )
          } else if (CATALOG_QUARANTINE_TABLES.has(tableName)) {
            // Catalog tables: ID-swap instead of delete/soft-delete.
            // UPDATE the local row's ID to match the Neon row's ID. PostgreSQL FK
            // constraints (ON UPDATE CASCADE) will cascade the change to all child
            // rows (e.g., MenuItem.categoryId, Modifier.modifierGroupId), preserving
            // the entire catalog graph. The subsequent ON CONFLICT upsert will then
            // find the row by the new ID and update all non-ID columns to match Neon.
            let idSwapSucceeded = false
            try {
              // Check if the target Neon ID already exists locally (would cause unique violation)
              const targetExists = await masterClient.$queryRawUnsafe<{ id: string }[]>(
                `SELECT id FROM "${tableName}" WHERE "id" = $1 LIMIT 1`,
                row.id as string
              )
              if (targetExists.length > 0) {
                // Target ID already exists — can't swap. This means the Neon row
                // will land via normal upsert. Soft-delete the conflicting local row
                // to clear the business-key constraint, but log to SyncConflict for audit.
                log.warn(
                  { table: tableName, localId: local.id, neonId: row.id },
                  'ID-swap skipped: target Neon ID already exists locally — falling back to soft-delete'
                )
              } else {
                await masterClient.$executeRawUnsafe(
                  `UPDATE "${tableName}" SET "id" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
                  row.id as string, local.id
                )
                idSwapSucceeded = true
                log.info(
                  { table: tableName, localId: local.id, neonId: row.id },
                  'Catalog ID-swap: local row ID updated to match Neon (FK cascaded to children)'
                )
              }
            } catch (swapErr) {
              // ID-swap failed (FK constraint without CASCADE, unique violation, etc.)
              // Fall back to soft-delete + SyncConflict record
              log.warn(
                { table: tableName, localId: local.id, neonId: row.id, err: swapErr instanceof Error ? swapErr.message : String(swapErr) },
                'Catalog ID-swap failed — falling back to soft-delete with SyncConflict record'
              )
            }

            if (!idSwapSucceeded) {
              // Fallback: soft-delete the conflicting row and log to SyncConflict for operator review
              await masterClient.$executeRawUnsafe(
                `UPDATE "${tableName}" SET "deletedAt" = NOW(), "updatedAt" = NOW() WHERE "id" = $1`,
                local.id
              )
              // Record in SyncConflict for audit trail
              try {
                await masterClient.$executeRawUnsafe(
                  `INSERT INTO "SyncConflict" (id, model, "recordId", "localVersion", "cloudVersion", "localData", "cloudData", "detectedAt")
                   VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6::jsonb, NOW())`,
                  tableName,
                  local.id,
                  localUpdatedAt?.toISOString() ?? new Date().toISOString(),
                  neonUpdatedAt?.toISOString() ?? new Date().toISOString(),
                  JSON.stringify({ id: local.id, conflictType: 'business-key-id-mismatch', fallback: 'soft-delete' }),
                  JSON.stringify({ id: row.id }),
                )
              } catch {
                // SyncConflict table may not exist — non-fatal
              }
              log.warn(
                { table: tableName, localId: local.id, neonId: row.id },
                'Catalog business-key conflict: soft-deleted local row (ID-swap failed) — logged to SyncConflict for review'
              )
            }
          } else {
            // Non-catalog tables: hard-delete the conflicting local row
            log.info({ table: tableName, localId: local.id, neonId: row.id }, 'Resolving business-key conflict — local replaced by Neon')
            await masterClient.$executeRawUnsafe(
              `DELETE FROM "${tableName}" WHERE "id" = $1`,
              local.id
            )
          }
        }
      }

      const values = upsertCols.map((col) => serializeValue(row[col], types?.get(col)?.endsWith('[]') ?? false))
      await masterClient.$executeRawUnsafe(sql, ...values)

      // Collect ID for batch syncedAt stamping (done after the loop)
      if (columns.includes('syncedAt') && row.id) {
        syncedIds.push(row.id as string)
      }

      // Downstream notification pipeline — fires registered handlers for this row.
      // Skip for menu-related models — they are batched per sync cycle (see below).
      const rowLocationId = (row.locationId as string) || ''
      if (!BATCHED_MENU_MODELS.has(tableName)) {
        void dispatchDownstreamNotifications(tableName, row, rowLocationId).catch((err) => {
          log.error({ err, table: tableName, recordId: row.id }, 'Notification pipeline error')
        })
      } else {
        // Track that this location needs a batched menu update (emitted once after all rows)
        if (rowLocationId) menuUpdateLocations.add(rowLocationId)
      }

      synced++
      // Only advance HWM for successfully synced rows
      const rowUpdatedAt = row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(row.updatedAt as string)
      if (rowUpdatedAt > maxSyncedAt) {
        maxSyncedAt = rowUpdatedAt
      }

      // Track per-location max timestamp for downstream watermark
      const wmLocationId = row.locationId as string | undefined
      if (wmLocationId) {
        const existing = locationWatermarks.get(wmLocationId)
        if (!existing || rowUpdatedAt > existing) {
          locationWatermarks.set(wmLocationId, rowUpdatedAt)
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)

      // Handle unique constraint violations gracefully — this is expected when
      // Neon has a record with a different id but same business key (e.g.,
      // [locationId, name]). Log as warning rather than error. The row will be
      // retried next cycle since HWM is not advanced past failed rows.
      if (errMsg.includes('unique constraint') || errMsg.includes('duplicate key') || errMsg.includes('Unique constraint')) {
        log.warn({ table: tableName, recordId: row.id }, 'Unique constraint violation (duplicate business key) — skipping')
      } else {
        log.error({ table: tableName, recordId: row.id, errMsg }, 'Row sync failed')
      }
      metrics.conflictCount++
      // Track the minimum failed row timestamp so HWM never advances past it.
      // Since rows are ordered by updatedAt ASC, any subsequent successful row
      // would otherwise push HWM beyond this failed row, permanently skipping it.
      const failedRowUpdatedAt = row.updatedAt instanceof Date
        ? row.updatedAt
        : new Date(row.updatedAt as string)
      if (!minFailedAt || failedRowUpdatedAt < minFailedAt) {
        minFailedAt = failedRowUpdatedAt
      }
    }
  }

  // Batch stamp syncedAt for all successfully synced rows (single query instead of N queries)
  if (syncedIds.length > 0) {
    try {
      await masterClient.$executeRawUnsafe(
        `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = ANY($1::text[])`,
        syncedIds
      )
    } catch (err) {
      log.error({ err, table: tableName, rowCount: syncedIds.length }, 'Batch syncedAt stamp failed (will retry next cycle)')
    }
  }

  // Cap HWM at the earliest failed row's timestamp so it is retried next cycle.
  // Without this, successful rows after a failed row would push HWM past the failure,
  // permanently skipping the failed row (rows are ordered by updatedAt ASC).
  if (minFailedAt && maxSyncedAt >= minFailedAt) {
    // Roll back HWM to just before the first failure — use 1ms before to ensure
    // the >= comparison in the next fetch includes the failed row
    const cappedAt = new Date(minFailedAt.getTime() - 1)
    log.warn({ table: tableName, maxSyncedAt: maxSyncedAt.toISOString(), cappedAt: cappedAt.toISOString(), minFailedAt: minFailedAt.toISOString() },
      'HWM capped below failed row timestamp to ensure retry')
    maxSyncedAt = cappedAt
  }

  // Advance high-water mark (in-memory + persisted to DB) — only based on successful rows
  if (maxSyncedAt > (highWaterMarks.get(tableName) ?? new Date('1970-01-01T00:00:00Z'))) {
    highWaterMarks.set(tableName, maxSyncedAt)

    // Persist HWM to DB so it survives process restarts
    try {
      await masterClient.$executeRawUnsafe(
        `INSERT INTO "_gwi_sync_state" (table_name, high_water_mark, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (table_name) DO UPDATE SET high_water_mark = $2, updated_at = NOW()`,
        tableName, maxSyncedAt.toISOString()
      )
    } catch (err) {
      log.error({ err, table: tableName }, 'Failed to persist HWM')
    }
  }

  // Update downstream watermarks per-location (for quarantine conflict detection)
  for (const [locId, maxTs] of locationWatermarks) {
    void updateDownstreamWatermark(locId, maxTs).catch((err) => {
      log.error({ err, locationId: locId }, 'Failed to update watermark')
    })
  }

  return synced
}

// ── P2-5: Pending Fulfillment Re-check ──────────────────────────────────────
// When a cloud-originated Order arrives via downstream sync but its OrderItems
// haven't synced yet, we defer fulfillment and re-check on subsequent cycles.

/** Map of orderId → { retries, row, locationId } for orders awaiting their items */
const pendingFulfillmentOrders = new Map<string, {
  retries: number
  row: Record<string, unknown>
  locationId: string
  scheduledAt: number
}>()

/** Max re-check attempts before giving up (5 cycles * 15s = ~75s window) */
const MAX_FULFILLMENT_RETRIES = 5

function schedulePendingFulfillment(orderId: string, locationId: string, row: Record<string, unknown>): void {
  if (pendingFulfillmentOrders.has(orderId)) return // Already scheduled
  pendingFulfillmentOrders.set(orderId, {
    retries: 0,
    row,
    locationId,
    scheduledAt: Date.now(),
  })
  log.info({ orderId }, 'OrderItems not yet available — scheduled for pending fulfillment re-check')
}

/**
 * Re-check pending fulfillment orders. Called at the end of each downstream cycle.
 * If items have arrived, fires fulfillment and removes from the pending map.
 */
async function processPendingFulfillments(): Promise<void> {
  if (pendingFulfillmentOrders.size === 0) return

  for (const [orderId, pending] of pendingFulfillmentOrders) {
    pending.retries++

    if (pending.retries > MAX_FULFILLMENT_RETRIES) {
      log.warn({ orderId, retries: pending.retries }, 'Pending fulfillment exceeded max retries — giving up')
      pendingFulfillmentOrders.delete(orderId)
      try {
        const { emitToLocation } = await import('../socket-server')
        await emitToLocation(pending.locationId, 'sync:fulfillment-timeout', {
          orderId,
          retries: MAX_FULFILLMENT_RETRIES,
        })
      } catch (emitErr) {
        log.error({ err: emitErr, orderId }, 'Failed to emit sync:fulfillment-timeout')
      }
      continue
    }

    try {
      const items = await masterClient.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "OrderItem" WHERE "orderId" = $1 AND "deletedAt" IS NULL AND "kitchenStatus" = 'sent' LIMIT 1`,
        orderId
      )

      if (items.length > 0) {
        log.info({ orderId, retries: pending.retries }, 'OrderItems arrived — firing deferred fulfillment')
        pendingFulfillmentOrders.delete(orderId)
        await handleCloudFulfillment(pending.row)
      }
    } catch (err) {
      log.error({ err, orderId }, 'Pending fulfillment re-check failed')
    }
  }
}

/**
 * Handle fulfillment routing for a cloud-originated order that arrived via downstream sync.
 * Fetches order items + station config from local PG, then calls routeOrderFulfillment.
 */
async function handleCloudFulfillment(row: Record<string, unknown>): Promise<void> {
  const orderId = row.id as string
  const locationId = row.locationId as string

  // Check if fulfillment events already exist for this order (e.g., created by send/route.ts)
  try {
    const existingEvents = await masterClient.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "FulfillmentEvent" WHERE "orderId" = $1 LIMIT 1`,
      orderId
    )
    if (existingEvents.length > 0) {
      log.info({ orderId }, 'FulfillmentEvents already exist — skipping')
      return
    }
  } catch {
    // FulfillmentEvent table may not exist yet — continue with fulfillment
  }

  // Fetch order items with fulfillment metadata from local PG
  const items = await masterClient.$queryRawUnsafe<Array<{
    id: string
    menuItemId: string
    name: string
    quantity: number
    fulfillmentType: string | null
    fulfillmentStationId: string | null
  }>>(
    `SELECT oi.id, oi."menuItemId", oi.name, oi.quantity, mi."fulfillmentType", mi."fulfillmentStationId"
     FROM "OrderItem" oi
     LEFT JOIN "MenuItem" mi ON mi.id = oi."menuItemId"
     WHERE oi."orderId" = $1 AND oi."deletedAt" IS NULL AND oi."kitchenStatus" = 'sent'`,
    orderId
  )

  if (items.length === 0) {
    // P2-5: OrderItems may not have arrived yet via downstream sync.
    // Schedule a deferred re-check so fulfillment fires once items appear.
    schedulePendingFulfillment(orderId, locationId, row)
    return
  }

  // Fetch modifiers for all order items
  const modifiers = await masterClient.$queryRawUnsafe<Array<{ orderItemId: string; name: string; quantity: number }>>(
    `SELECT "orderItemId", name, quantity FROM "OrderItemModifier" WHERE "orderItemId" = ANY($1::text[])`,
    items.map((i: any) => i.id)
  )

  const modsByItem = new Map<string, Array<{ name: string; quantity: number }>>()
  for (const mod of modifiers) {
    if (!modsByItem.has(mod.orderItemId)) modsByItem.set(mod.orderItemId, [])
    modsByItem.get(mod.orderItemId)!.push({ name: mod.name, quantity: mod.quantity })
  }

  // Build FulfillmentItem[]
  const fulfillmentItems: FulfillmentItem[] = items.map(item => ({
    id: item.id,
    menuItemId: item.menuItemId,
    name: item.name,
    quantity: item.quantity,
    modifiers: modsByItem.get(item.id) || [],
    fulfillmentType: (item.fulfillmentType as FulfillmentItem['fulfillmentType']) ?? 'KITCHEN_STATION',
    fulfillmentStationId: item.fulfillmentStationId ?? null,
  }))

  // Fetch station config from local PG
  const stations = await masterClient.$queryRawUnsafe<Array<{
    id: string
    name: string
    type: string
    tags: unknown
    isDefault: boolean
    isActive: boolean
  }>>(
    `SELECT id, name, type, tags, "isDefault", "isActive" FROM "Station" WHERE "locationId" = $1 AND "isActive" = true AND "deletedAt" IS NULL`,
    locationId
  )

  const stationConfigs: FulfillmentStationConfig[] = stations.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type as 'PRINTER' | 'KDS',
    tags: Array.isArray(s.tags) ? (s.tags as string[]) : [],
    isDefault: s.isDefault,
    isActive: s.isActive,
  }))

  // Route with cellular origin device type
  const actions = await routeOrderFulfillment(
    { id: orderId, locationId },
    fulfillmentItems,
    stationConfigs,
    new Date().toISOString(),
    { terminalId: (row.originTerminalId as string) || undefined, type: 'cellular' },
  )

  // Persist FulfillmentEvents so the bridge worker dispatches to hardware
  for (const action of actions) {
    try {
      await masterClient.$executeRawUnsafe(
        `INSERT INTO "FulfillmentEvent" (id, "locationId", "orderId", "stationId", type, status, payload, "retryCount", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'pending', $5::jsonb, 0, NOW(), NOW())`,
        locationId, orderId, action.stationId || null, action.type,
        JSON.stringify({ items: action.items, stationName: action.stationName, idempotencyKey: action.idempotencyKey })
      )
    } catch (err) {
      log.error({ err, actionType: action.type, orderId }, 'Failed to persist FulfillmentEvent')
    }
  }

  // Emit socket events immediately for instant KDS display.
  // The bridge worker will also process the persisted FulfillmentEvents for
  // durable retry, but emitting here eliminates the 2s bridge poll latency
  // for cellular orders — cutting KDS appearance from ~17.5s to near-instant.
  void (async () => {
    try {
      const { emitToLocation, emitToTags } = await import('../socket-server')

      // Build a KDS-compatible order event payload for each station
      for (const action of actions) {
        if (action.type === 'kds_update' || action.type === 'print_kitchen' || action.type === 'print_bar' || action.type === 'print_prep') {
          // Find station tags from the station configs
          const station = stationConfigs.find(s => s.id === action.stationId)
          const tags = station?.tags ?? []

          const kdsPayload = {
            orderId,
            orderNumber: row.orderNumber as number,
            orderType: row.orderType as string,
            tableName: null, // Join field not available in raw sync row
            tabName: row.tabName as string | null,
            employeeName: null, // Join field not available in raw sync row
            createdAt: row.createdAt instanceof Date
              ? (row.createdAt as Date).toISOString()
              : String(row.createdAt),
            primaryItems: action.items.map(item => ({
              id: item.orderItemId,
              name: item.name,
              quantity: item.quantity,
              seatNumber: null,
              specialNotes: null,
              sourceTableName: null,
              modifiers: (item.modifiers || []).map(m => ({
                name: m.name,
                preModifier: null,
              })),
              isPizza: false,
              isBar: action.type === 'print_bar',
              pizzaData: null,
              pricingOptionLabel: null,
              weight: null,
              weightUnit: null,
              unitPrice: null,
              soldByWeight: false,
              tareWeight: null,
            })),
            referenceItems: [],
            matchedTags: tags,
            stationId: action.stationId,
            stationName: action.stationName,
          }

          // Emit to station tags for tag-based KDS routing
          if (tags.length > 0) {
            await emitToTags(tags, 'kds:order-received', kdsPayload, locationId)
          }

          // Also emit to location for KDS screens not using tag-based routing
          if (action.type === 'kds_update') {
            await emitToLocation(locationId, 'kds:order-received', kdsPayload)
          }
        }
      }

      // Emit order:created to location for general terminal awareness
      await emitToLocation(locationId, 'order:created', {
        orderId,
        orderNumber: row.orderNumber,
        orderType: row.orderType,
        tableName: null,
        tabName: row.tabName,
        employeeName: null,
        createdAt: row.createdAt instanceof Date
          ? (row.createdAt as Date).toISOString()
          : String(row.createdAt),
        stations: actions.map(a => a.stationName).filter(Boolean),
      })

      // NOTE: dispatchOpenOrdersChanged is NOT called here — the notification
      // pipeline's open-orders-dispatch handler already dispatches it per-location
      // with deduplication. Calling it here would cause a double-dispatch.
    } catch (err) {
      log.error({ err, orderId }, 'Socket dispatch for cloud order failed')
    }
  })().catch((err) => log.error({ err }, 'Unhandled error in cloud order socket dispatch'))

  log.info({ orderId, itemCount: items.length, eventCount: actions.length }, 'Fulfillment routed for cloud order')
}

/**
 * Create a PendingDeduction for a cloud-originated order that was paid/closed
 * on the cloud (e.g., cellular order). Without this, inventory deduction only
 * runs for locally-paid orders (via pay/route.ts).
 */
async function handleCloudDeduction(row: Record<string, unknown>): Promise<void> {
  const orderId = row.id as string
  const locationId = row.locationId as string

  try {
    // Rely solely on ON CONFLICT for idempotency (no TOCTOU race)
    await masterClient.$executeRawUnsafe(
      `INSERT INTO "PendingDeduction" (id, "locationId", "orderId", "deductionType", status, attempts, "maxAttempts", "availableAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, 'STANDARD', 'pending', 0, 5, NOW(), NOW(), NOW())
       ON CONFLICT ("orderId") DO NOTHING`,
      locationId, orderId
    )

    log.info({ orderId }, 'Created PendingDeduction for cloud order')
  } catch (err) {
    // PendingDeduction table may not exist yet — non-fatal
    log.error({ err, orderId }, 'Failed to create PendingDeduction')
  }
}

/**
 * Update Table status to 'occupied' when a cloud-originated order with a tableId
 * syncs downstream. Without this, the floor plan shows the table as 'available'
 * even though it has an active order from a cellular device.
 */
async function handleCloudTableStatus(row: Record<string, unknown>): Promise<void> {
  const tableId = row.tableId as string
  const locationId = row.locationId as string

  try {
    await masterClient.$executeRawUnsafe(
      `UPDATE "Table" SET status = 'occupied' WHERE id = $1 AND status != 'occupied'`,
      tableId
    )

    // Emit table status change — Android handles this as a Room delta patch (no full refetch)
    const { dispatchTableStatusChanged } = await import('../socket-dispatch')
    await dispatchTableStatusChanged(locationId, { tableId, status: 'occupied' })
  } catch (err) {
    log.error({ err, tableId, locationId }, 'Failed to update table status')
  }
}

// ── Bidirectional Conflict Detection ──────────────────────────────────────────

/**
 * @deprecated Legacy conflict detection for non-protected bidirectional models.
 * Protected money/order models now use checkQuarantine() from sync-conflict-quarantine.ts.
 * This function will be removed once all bidirectional models use versioned conflict handling.
 * DO NOT add new models to this code path — use the quarantine system instead.
 *
 * Detect conflicts for bidirectional models during downstream sync.
 *
 * When a Neon row arrives that also exists locally, compare timestamps
 * and lastMutatedBy to decide whether to apply the Neon version.
 *
 * Returns 'apply' to write the Neon version, 'skip' to keep local.
 * Default behavior: Neon-wins on ties (cloud is canonical).
 */
async function detectBidirectionalConflict(
  tableName: string,
  neonRow: Record<string, unknown>,
  strategy: ConflictStrategy,
  columns: string[],
  prefetchedLocalRow?: Record<string, unknown> | null,
): Promise<'apply' | 'skip'> {
  const hasLastMutatedBy = columns.includes('lastMutatedBy')
  const hasUpdatedAt = columns.includes('updatedAt')
  if (!hasUpdatedAt || !hasLastMutatedBy) return 'apply'

  try {
    // Reuse pre-fetched local row if available (avoids double query in quarantine path)
    let local: { updatedAt: Date; lastMutatedBy: string | null }
    if (prefetchedLocalRow !== undefined) {
      if (prefetchedLocalRow === null) return 'apply' // Row doesn't exist locally
      local = {
        updatedAt: prefetchedLocalRow.updatedAt instanceof Date
          ? prefetchedLocalRow.updatedAt
          : new Date(prefetchedLocalRow.updatedAt as string),
        lastMutatedBy: (prefetchedLocalRow.lastMutatedBy as string | null) ?? null,
      }
    } else {
      const localRows = await masterClient.$queryRawUnsafe<Array<{
        updatedAt: Date
        lastMutatedBy: string | null
      }>>(
        `SELECT "updatedAt", "lastMutatedBy" FROM "${tableName}" WHERE id = $1 LIMIT 1`,
        neonRow.id as string,
      )
      if (localRows.length === 0) return 'apply'
      local = localRows[0]
    }
    const neonUpdatedAt = neonRow.updatedAt instanceof Date
      ? neonRow.updatedAt
      : new Date(neonRow.updatedAt as string)
    const localUpdatedAt = local.updatedAt instanceof Date
      ? local.updatedAt
      : new Date(local.updatedAt as string)

    // If local row was NOT locally mutated, always accept Neon version
    if (!local.lastMutatedBy || local.lastMutatedBy === 'cloud') {
      return 'apply'
    }

    // NTP drift tolerance: if timestamps are within 2 seconds and local row was
    // locally mutated, prefer local version — too close to call with NTP uncertainty.
    const timeDiffMs = Math.abs(localUpdatedAt.getTime() - neonUpdatedAt.getTime())
    if (timeDiffMs < 2000 && local.lastMutatedBy && local.lastMutatedBy !== 'cloud') {
      // Too close to call with NTP uncertainty — prefer local version
      return 'skip'
    }

    // Local row was mutated locally (lastMutatedBy = 'local' or a terminalId)
    // Apply conflict strategy
    switch (strategy) {
      case 'neon-wins':
        // Neon always wins — cloud is canonical
        if (localUpdatedAt > neonUpdatedAt) {
          log.warn({ table: tableName, recordId: neonRow.id, localUpdatedAt: localUpdatedAt.toISOString(), neonUpdatedAt: neonUpdatedAt.toISOString(), lastMutatedBy: local.lastMutatedBy }, 'Conflict — local is newer but neon-wins strategy applied')
          metrics.conflictCount++
        }
        return 'apply'

      case 'local-wins':
        // Local always wins — skip Neon version
        log.warn({ table: tableName, recordId: neonRow.id, lastMutatedBy: local.lastMutatedBy }, 'Conflict — local-wins strategy, skipping Neon version')
        metrics.conflictCount++
        return 'skip'

      case 'latest-wins':
        // Only skip Neon version if local is strictly newer AND locally mutated
        if (localUpdatedAt > neonUpdatedAt && local.lastMutatedBy !== 'cloud') {
          log.warn({ table: tableName, recordId: neonRow.id, localUpdatedAt: localUpdatedAt.toISOString(), neonUpdatedAt: neonUpdatedAt.toISOString(), lastMutatedBy: local.lastMutatedBy }, 'Conflict — local is strictly newer, keeping local version')
          metrics.conflictCount++
          return 'skip'
        }
        return 'apply'

      default:
        return 'apply'
    }
  } catch {
    // If we can't read local state, safest to apply Neon version
    return 'apply'
  }
}

// ── Cellular Deny List Sync ──────────────────────────────────────────────────

/** Whether the CellularDevice table exists on this NUC (cached after first check) */
let cellularDeviceTableExists: boolean | null = null

/**
 * Sync the cellular terminal deny list from the local CellularDevice table.
 * Devices with status 'revoked' or 'quarantined' get added to the in-memory deny list.
 */
async function syncCellularDenyList(): Promise<void> {
  // Check table existence once — avoids prisma:error log spam on NUCs without CellularDevice
  if (cellularDeviceTableExists === null) {
    try {
      const result = await masterClient.$queryRawUnsafe<Array<{ exists: boolean }>>(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CellularDevice') as exists`
      )
      cellularDeviceTableExists = result[0]?.exists ?? false
    } catch {
      cellularDeviceTableExists = false
    }
  }
  if (!cellularDeviceTableExists) return

  try {
    const revoked = await masterClient.$queryRawUnsafe<Array<{
      terminalId: string
      updatedAt: Date
    }>>(
      `SELECT "terminalId", "updatedAt" FROM "CellularDevice" WHERE status IN ('REVOKED', 'QUARANTINED') AND "terminalId" IS NOT NULL`
    )

    if (revoked.length > 0) {
      syncDenyList(
        revoked.map((r) => ({
          terminalId: r.terminalId,
          revokedAt: r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt as unknown as string).getTime(),
        }))
      )
    }
  } catch {
    // Query failed — safe to skip
  }
}

// ── Core downstream cycle ────────────────────────────────────────────────────

async function runDownstreamCycle(): Promise<void> {
  if (!hasNeonConnection()) return
  if (cycleRunning) return // Prevent overlapping cycles
  cycleRunning = true
  // Per-cycle trace ID for log correlation
  const cycleId = randomUUID().slice(0, 8)

  try {
    // Refresh column metadata if cache TTL has expired (picks up schema changes)
    if (Date.now() - columnCacheTimestamp > COLUMN_CACHE_TTL) {
      await loadColumnMetadata()
      columnCacheTimestamp = Date.now()
      log.info('Column metadata cache refreshed (TTL expired)')
    }

    const models = getDownstreamModels()
    let totalSynced = 0

    // Parallelize table sync in batches of 5 for 2-3x throughput
    const modelEntries = models.filter(([tableName]) => columnCache.has(tableName))
    for (let i = 0; i < modelEntries.length; i += 5) {
      const batch = modelEntries.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async ([tableName, config]) => {
          const synced = await syncTableDown(tableName, config.batchSize)
          if (synced > 0) {
            log.info({ cycleId, table: tableName, rows: synced }, 'Table synced')
          }
          return synced
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled') totalSynced += result.value
      }
    }

    metrics.lastSyncAt = new Date()
    metrics.rowsSyncedTotal += totalSynced

    // Signal that the first downstream sync cycle has completed
    if (!initialSyncDone && initialSyncResolve) {
      initialSyncDone = true
      initialSyncResolve()
      // Verify critical tables are populated before advancing to ORDERS
      try {
        const { advanceToOrders } = await import('../readiness')
        const criticalCounts: Record<string, number> = {}
        const criticalTables = ['Location', 'Organization', 'Role', 'Employee', 'Category', 'OrderType', 'MenuItem']
        for (const table of criticalTables) {
          try {
            const rows = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
              `SELECT COUNT(*) as count FROM "${table}" WHERE "deletedAt" IS NULL`
            )
            criticalCounts[table] = Number(rows[0]?.count ?? 0)
          } catch {
            criticalCounts[table] = 0
          }
        }
        // Guard: require at least 1 MenuItem before advancing to ORDERS state.
        // Without menu items, orders cannot be placed — the gate would be premature.
        if ((criticalCounts['MenuItem'] ?? 0) < 1) {
          log.warn({ criticalCounts }, 'ORDERS gate deferred — MenuItem table empty, waiting for menu sync')
          // Reset initialSyncDone so the gate re-checks on next cycle
          initialSyncDone = false
        } else {
          advanceToOrders(criticalCounts)
        }
      } catch {
        // readiness module may not be loaded yet — server.ts will handle it
      }
      log.info({ cycleId, rows: totalSynced }, 'Initial sync cycle complete — server ready')
    }

    if (totalSynced > 0) {
      log.info({ cycleId, rows: totalSynced }, 'Cycle complete')
      // Activity detected — reset idle backoff to fast polling
      if (consecutiveIdleCycles >= IDLE_BACKOFF_THRESHOLD && timer) {
        clearInterval(timer)
        timer = setInterval(() => void runDownstreamCycle(), DOWNSTREAM_INTERVAL_MS)
        timer.unref()
        log.info({ intervalMs: DOWNSTREAM_INTERVAL_MS }, 'Idle backoff reset — activity detected')
      }
      consecutiveIdleCycles = 0
    } else {
      consecutiveIdleCycles++
      // Switch to slow polling after N consecutive no-op cycles
      if (consecutiveIdleCycles === IDLE_BACKOFF_THRESHOLD && timer) {
        clearInterval(timer)
        timer = setInterval(() => void runDownstreamCycle(), IDLE_INTERVAL_MS)
        timer.unref()
        log.info({ intervalMs: IDLE_INTERVAL_MS, afterIdleCycles: IDLE_BACKOFF_THRESHOLD }, 'Idle backoff engaged')
      }
    }

    // Emit batched menu:updated — one event per location per cycle instead of per-row
    if (menuUpdateLocations.size > 0) {
      const locations = [...menuUpdateLocations]
      menuUpdateLocations.clear()
      try {
        const { dispatchMenuUpdate } = await import('../socket-dispatch')
        for (const locId of locations) {
          try {
            await dispatchMenuUpdate(locId, { action: 'updated' })
          } catch (err) {
            log.error({ err, locationId: locId }, 'Batched menu:updated dispatch failed')
          }
        }
        log.info({ cycleId, locations: locations.length }, 'Batched menu:updated dispatched')
      } catch (err) {
        log.error({ err }, 'Failed to import socket-dispatch for batched menu update')
      }
    }

    // Emit batched floor-plan:updated — one event per location per cycle instead of per-row.
    // This prevents the socket storm that caused Android floor plan canvas flashing
    // (Table/Section/SectionAssignment/FloorPlanElement rows were emitting per-row).
    if (floorPlanUpdateLocations.size > 0) {
      const locations = [...floorPlanUpdateLocations]
      floorPlanUpdateLocations.clear()
      try {
        const { dispatchFloorPlanUpdate } = await import('../socket-dispatch')
        for (const locId of locations) {
          try {
            await dispatchFloorPlanUpdate(locId)
          } catch (err) {
            log.error({ err, locationId: locId }, 'Batched floor-plan:updated dispatch failed')
          }
        }
      } catch (err) {
        log.error({ err }, 'Failed to import socket-dispatch for batched floor plan update')
      }
    }

    // P2-5: Re-check orders that are pending fulfillment (items not yet synced)
    void processPendingFulfillments().catch((err) => {
      log.error({ err }, 'Pending fulfillment re-check failed')
    })

    // Sync cellular deny list at the end of each cycle
    void syncCellularDenyList().catch((err) => {
      log.error({ err }, 'Cellular deny list sync failed')
    })

    // Periodic reconciliation check — runs every 5 minutes (fire-and-forget)
    const now = Date.now()
    if (now - lastReconciliationAt > RECONCILIATION_INTERVAL_MS) {
      lastReconciliationAt = now
      void runReconciliationCheck().catch((err) => {
        log.error({ err }, 'Reconciliation check failed')
      })
    }
  } catch (err) {
    log.error({ cycleId, err }, 'Cycle error')
  } finally {
    cycleRunning = false
  }
}

// ── Downstream Notification Pipeline Registration ─────────────────────────────

/**
 * Register the 4 downstream notification handlers with the pipeline.
 * Called once at worker startup. Each handler wraps an existing function
 * with model/condition filters so the pipeline dispatches correctly.
 */
function initDownstreamNotifications(): void {
  // 1. Cloud fulfillment routing — Order with status='sent' && lastMutatedBy='cloud'
  registerDownstreamHandler({
    name: 'cloud-fulfillment',
    models: ['Order'],
    condition: (_t, row) => row.lastMutatedBy === 'cloud' && row.status === 'sent',
    handler: async (_t, row) => {
      await handleCloudFulfillment(row)
    },
    errorPolicy: 'log',
  })

  // 2. Cloud inventory deduction — Order with status='paid'|'closed' && lastMutatedBy='cloud'
  registerDownstreamHandler({
    name: 'cloud-deduction',
    models: ['Order'],
    condition: (_t, row) => row.lastMutatedBy === 'cloud' && (row.status === 'paid' || row.status === 'closed'),
    handler: async (_t, row) => {
      await handleCloudDeduction(row)
    },
    errorPolicy: 'log',
  })

  // 3. Cloud table status — Order with tableId, non-final status, lastMutatedBy='cloud'
  registerDownstreamHandler({
    name: 'cloud-table-status',
    models: ['Order'],
    condition: (_t, row) =>
      row.lastMutatedBy === 'cloud' &&
      !!row.tableId &&
      row.status !== 'paid' &&
      row.status !== 'closed' &&
      row.status !== 'cancelled',
    handler: async (_t, row) => {
      await handleCloudTableStatus(row)
    },
    errorPolicy: 'log',
  })

  // 4. Open orders socket dispatch — Order or OrderItem, deduplicated per locationId per batch
  //    notificationDispatchedLocations is cleared at the start of each syncTableDown() call
  registerDownstreamHandler({
    name: 'open-orders-dispatch',
    models: ['Order', 'OrderItem'],
    handler: async (tableName, row, locationId) => {
      if (!locationId || notificationDispatchedLocations.has(locationId)) return
      notificationDispatchedLocations.add(locationId)
      const { dispatchOpenOrdersChanged } = await import('../socket-dispatch')
      await dispatchOpenOrdersChanged(locationId, {
        trigger: tableName === 'Order' ? 'created' : 'item_updated',
      })
    },
    errorPolicy: 'skip',
  })

  // 5. Menu/catalog change dispatch — emit socket events so POS terminals refresh menu caches
  registerDownstreamHandler({
    name: 'menu-change-dispatch',
    models: ['MenuItem', 'Category', 'ModifierGroup', 'Modifier', 'ComboTemplate', 'ComboComponent', 'ComboComponentOption', 'ModifierGroupTemplate', 'ModifierTemplate', 'PricingOptionGroup', 'PricingOption', 'ItemBarcode'],
    handler: async (tableName, row, locationId) => {
      if (!locationId) return
      const { dispatchMenuUpdate } = await import('../socket-dispatch')
      await dispatchMenuUpdate(locationId, {
        action: 'updated',
        menuItemId: (row.id as string) || undefined,
        name: (row.name as string) || undefined,
      })
    },
    errorPolicy: 'skip',
  })

  // 6. Employee/role change dispatch — terminals refresh employee lists and permissions
  registerDownstreamHandler({
    name: 'employee-change-dispatch',
    models: ['Employee', 'Role', 'EmployeeRole'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'employees:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 7. Hardware change dispatch — terminals refresh printer/terminal/KDS config
  registerDownstreamHandler({
    name: 'hardware-change-dispatch',
    models: ['Terminal', 'Printer', 'PrintRoute', 'PrintRule', 'KDSScreen', 'KDSScreenStation', 'KDSScreenLink', 'PaymentReader', 'Scale', 'Station'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'hardware:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 8. Settings/pricing/tax change dispatch — terminals refresh settings caches
  registerDownstreamHandler({
    name: 'settings-change-dispatch',
    models: ['TaxRule', 'DiscountRule', 'CourseConfig', 'OrderType', 'CfdSettings', 'InventorySettings', 'VoidReason', 'CompReason', 'ReasonAccess', 'QuickBarPreference', 'QuickBarDefault'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'settings:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 9. Floor plan change dispatch — batched per cycle (not per-row)
  // For Table rows: only emit when layout fields changed (status-only handled by table:status-changed).
  // For Section/SectionAssignment/FloorPlanElement: always emit (these are layout-affecting).
  // All collected into floorPlanUpdateLocations and emitted once at end of cycle.
  registerDownstreamHandler({
    name: 'floorplan-change-dispatch',
    models: ['Table', 'Section', 'SectionAssignment', 'FloorPlanElement'],
    handler: async (tableName, row, locationId) => {
      if (!locationId) return

      if (tableName === 'Table') {
        // Build layout signature from layout-affecting fields only (excludes status)
        const sig = `${row.posX}|${row.posY}|${row.width}|${row.height}|${row.shape}|${row.rotation}|${row.sectionId}|${row.name}|${row.capacity}|${row.isActive}|${row.seatPattern}|${row.abbreviation}`
        const cacheKey = `${locationId}:${row.id}`
        const prev = tableLayoutSigCache.get(cacheKey)
        tableLayoutSigCache.set(cacheKey, sig)
        if (sig === prev) return // layout unchanged (status-only churn), skip
      }

      floorPlanUpdateLocations.add(locationId)
    },
    errorPolicy: 'skip',
  })

  // 10. Customer/loyalty change dispatch
  registerDownstreamHandler({
    name: 'customer-change-dispatch',
    models: ['Customer', 'Coupon', 'GiftCard', 'HouseAccount'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'customers:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 11. Schedule change dispatch
  registerDownstreamHandler({
    name: 'schedule-change-dispatch',
    models: ['Schedule', 'ScheduledShift'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'schedules:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 12. Inventory change dispatch — terminals refresh inventory/stock caches
  registerDownstreamHandler({
    name: 'inventory-change-dispatch',
    models: ['InventoryItem', 'InventoryItemStorage', 'Ingredient', 'IngredientCategory', 'Vendor', 'ModifierInventoryLink', 'PrepStation', 'PrepTrayConfig', 'StorageLocation', 'PrepItem', 'PrepItemIngredient', 'PricingOptionInventoryLink'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'inventory:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 13. Pizza config change dispatch — pizza is part of menu, terminals refresh menu caches
  registerDownstreamHandler({
    name: 'pizza-change-dispatch',
    models: ['PizzaConfig', 'PizzaSize', 'PizzaCrust', 'PizzaSauce', 'PizzaCheese', 'PizzaTopping', 'PizzaSpecialty'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { dispatchMenuUpdate } = await import('../socket-dispatch')
      await dispatchMenuUpdate(locationId, {
        action: 'updated',
        menuItemId: undefined,
        name: undefined,
      })
    },
    errorPolicy: 'skip',
  })

  // 14. Reservation change dispatch — terminals refresh reservation views
  registerDownstreamHandler({
    name: 'reservation-change-dispatch',
    models: ['Reservation', 'Seat', 'ReservationBlock', 'ReservationDeposit', 'ReservationEvent'],
    handler: async (_tableName, row, locationId) => {
      if (!locationId) return
      const { dispatchReservationChanged } = await import('../socket-dispatch')
      await dispatchReservationChanged(locationId, {
        reservationId: (row.id as string) || '',
        action: 'updated',
      })
    },
    errorPolicy: 'skip',
  })

  // 15. Payments/financial change dispatch — terminals refresh order lists
  registerDownstreamHandler({
    name: 'payment-financial-dispatch',
    models: ['OrderDiscount', 'OrderCard', 'OrderItemModifier', 'Payment'],
    handler: async (tableName, row, locationId) => {
      if (!locationId) return
      const { dispatchOpenOrdersChanged } = await import('../socket-dispatch')
      await dispatchOpenOrdersChanged(locationId, {
        trigger: tableName === 'Payment' ? 'payment_updated' : 'item_updated',
      })
    },
    errorPolicy: 'skip',
  })

  // 16. Tips/payroll change dispatch — terminals refresh tip pools and payroll data
  registerDownstreamHandler({
    name: 'tips-change-dispatch',
    models: ['TipOutRule', 'TipPool', 'TipGroupTemplate', 'PayrollPeriod', 'PayStub'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'tips:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 17. Events/ticketing change dispatch — terminals refresh event views
  registerDownstreamHandler({
    name: 'events-change-dispatch',
    models: ['Event', 'EventPricingTier', 'EventTableConfig'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'events:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 18. Liquor/bottle service change dispatch — part of menu, terminals refresh menu caches
  registerDownstreamHandler({
    name: 'liquor-change-dispatch',
    models: ['BottleProduct', 'SpiritCategory', 'SpiritModifierGroup', 'BottleServiceTier'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { dispatchMenuUpdate } = await import('../socket-dispatch')
      await dispatchMenuUpdate(locationId, {
        action: 'updated',
        menuItemId: undefined,
        name: undefined,
      })
    },
    errorPolicy: 'skip',
  })

  // 19. Entertainment/waitlist/prep change dispatch — terminals refresh entertainment status
  registerDownstreamHandler({
    name: 'entertainment-change-dispatch',
    models: ['EntertainmentWaitlist', 'DailyPrepCount', 'DailyPrepCountItem'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'entertainment:status-changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  // 20. Recipe change dispatch — part of menu, terminals refresh menu caches
  registerDownstreamHandler({
    name: 'recipe-change-dispatch',
    models: ['MenuItemRecipe', 'RecipeIngredient'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { dispatchMenuUpdate } = await import('../socket-dispatch')
      await dispatchMenuUpdate(locationId, {
        action: 'updated',
        menuItemId: undefined,
        name: undefined,
      })
    },
    errorPolicy: 'skip',
  })

  // 21. Chargeback/misc change dispatch — terminals refresh order lists
  registerDownstreamHandler({
    name: 'chargeback-misc-dispatch',
    models: ['ChargebackCase', 'ShiftSwapRequest'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { dispatchOpenOrdersChanged } = await import('../socket-dispatch')
      await dispatchOpenOrdersChanged(locationId, {
        trigger: 'item_updated',
      })
    },
    errorPolicy: 'skip',
  })

  // 22. Loyalty program change dispatch — terminals refresh customer/loyalty caches
  registerDownstreamHandler({
    name: 'loyalty-change-dispatch',
    models: ['LoyaltyProgram', 'LoyaltyTier'],
    handler: async (_tableName, _row, locationId) => {
      if (!locationId) return
      const { emitToLocation } = await import('../socket-server')
      await emitToLocation(locationId, 'customers:changed', { action: 'updated' })
    },
    errorPolicy: 'skip',
  })

  log.info('Notification pipeline initialized (22 handlers)')
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startDownstreamSyncWorker(): void {
  if (timer) return
  if (!hasNeonConnection()) {
    log.info('No Neon connection — worker disabled')
    return
  }

  log.info({ intervalMs: DOWNSTREAM_INTERVAL_MS }, 'Starting')
  metrics.running = true
  initDownstreamNotifications()

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

    await Promise.all([initHighWaterMarks(), loadColumnMetadata(), loadWatermarks()])
    columnCacheTimestamp = Date.now()
    void runDownstreamCycle()
    timer = setInterval(() => void runDownstreamCycle(), DOWNSTREAM_INTERVAL_MS)
    timer.unref()
  })()
}

export function stopDownstreamSyncWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
    metrics.running = false
    log.info('Stopped')
  }
}

export function getDownstreamSyncMetrics(): DownstreamMetrics {
  return { ...metrics }
}

/** Clear the column metadata cache. Called when schema changes are detected. */
export function clearColumnCache(): void {
  columnCache.clear()
  columnTypeMap.clear()
  columnCacheTimestamp = 0
  log.info('Column metadata cache cleared — will reload on next cycle')
}

/**
 * Trigger an immediate downstream sync cycle (non-blocking).
 * Called when DATA_CHANGED arrives from the sync agent.
 * @param _domain - Optional domain name (legacy)
 * @param modelNames - Optional specific model names to sync (e.g., ['Order', 'Payment'])
 */
export async function triggerImmediateDownstreamSync(_domain?: string, modelNames?: string[]): Promise<void> {
  // Reset idle backoff — something changed upstream
  if (consecutiveIdleCycles >= IDLE_BACKOFF_THRESHOLD && timer) {
    clearInterval(timer)
    timer = setInterval(() => void runDownstreamCycle(), DOWNSTREAM_INTERVAL_MS)
    timer.unref()
  }
  consecutiveIdleCycles = 0

  if (immediateRunning) {
    // Buffer the request — will replay after current cycle completes
    if (modelNames && modelNames.length > 0) {
      pendingImmediateModels = [...new Set([...(pendingImmediateModels || []), ...modelNames])]
    } else {
      pendingImmediateModels = [] // empty = full sync
    }
    return
  }
  immediateRunning = true
  try {
    if (modelNames && modelNames.length > 0) {
      await runDownstreamCycleForModels(modelNames)
    } else {
      await runDownstreamCycle()
    }
  } finally {
    immediateRunning = false
    // Replay any buffered DATA_CHANGED events
    if (pendingImmediateModels !== null) {
      const buffered = pendingImmediateModels
      pendingImmediateModels = null
      // Fire-and-forget: don't await (prevents recursion depth issues)
      void triggerImmediateDownstreamSync(undefined, buffered.length > 0 ? buffered : undefined).catch(err => log.warn({ err }, 'Sync task failed'))
    }
  }
}

/**
 * Run downstream sync for specific models only.
 * Used by SSE wake-up to immediately sync newly changed bidirectional models.
 */
async function runDownstreamCycleForModels(modelNames: string[]): Promise<void> {
  if (!hasNeonConnection()) return
  const cycleId = randomUUID().slice(0, 8)

  try {
    const allModels = getDownstreamModels()
    const targetSet = new Set(modelNames)
    const models = allModels.filter(([name]) => targetSet.has(name) && columnCache.has(name))
    let totalSynced = 0

    // Parallelize table sync in batches of 5 for 2-3x throughput
    for (let i = 0; i < models.length; i += 5) {
      const batch = models.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async ([tableName, config]) => {
          const synced = await syncTableDown(tableName, config.batchSize)
          if (synced > 0) {
            log.info({ cycleId, table: tableName, rows: synced }, 'Table synced (immediate)')
          }
          return synced
        })
      )
      for (const result of results) {
        if (result.status === 'fulfilled') totalSynced += result.value
      }
    }

    metrics.lastSyncAt = new Date()
    metrics.rowsSyncedTotal += totalSynced

    if (totalSynced > 0) {
      log.info({ cycleId, rows: totalSynced, models: modelNames }, 'Immediate cycle complete')
    }
  } catch (err) {
    log.error({ cycleId, err }, 'Immediate cycle error')
  }
}

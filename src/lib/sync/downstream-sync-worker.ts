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
import { getDownstreamModels, getBidirectionalModelNames, getConflictStrategy, DOWNSTREAM_INTERVAL_MS, type ConflictStrategy } from './sync-config'
import { routeOrderFulfillment, type FulfillmentItem, type FulfillmentStationConfig } from '../fulfillment-router'
import { syncDenyList } from '../cellular-auth'

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
    console.error('[DownstreamSync] Failed to create _gwi_sync_state table:', err instanceof Error ? err.message : err)
  }
}

/** Initialize high-water marks — prefer persisted DB state, fall back to MAX(updatedAt) */
async function initHighWaterMarks(): Promise<void> {
  await ensureSyncStateTable()

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
    // Table may not exist yet or be empty — fall through to MAX(updatedAt)
  }

  const models = getDownstreamModels()
  for (const [tableName] of models) {
    // Use persisted HWM if available
    if (persistedHwms.has(tableName)) {
      highWaterMarks.set(tableName, persistedHwms.get(tableName)!)
      continue
    }

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
    `SELECT ${quotedSelectCols} FROM "${tableName}" WHERE "updatedAt" > $1::timestamptz${biDirFilter} ORDER BY "updatedAt" ASC LIMIT $2`,
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
  const updateSet = upsertCols
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ')

  // Bidirectional conflict guard: only overwrite if local row is still cloud-owned
  const biDirConflictGuard = isBiDir
    ? ` WHERE "${tableName}"."lastMutatedBy" = 'cloud' OR "${tableName}"."lastMutatedBy" IS NULL`
    : ''

  const sql = `INSERT INTO "${tableName}" (${quotedCols}) VALUES (${placeholders}) ON CONFLICT (id) DO UPDATE SET ${updateSet}${biDirConflictGuard}`

  let synced = 0
  let maxUpdatedAt = hwm
  const strategy = getConflictStrategy(tableName)

  for (const row of rows) {
    try {
      // Bidirectional conflict detection: check if local row was modified locally
      if (isBiDir && row.id) {
        const conflictResult = await detectBidirectionalConflict(tableName, row, strategy, columns)
        if (conflictResult === 'skip') {
          // Local version is strictly newer and locally-mutated — skip Neon version
          const rowUpdatedAt = row.updatedAt instanceof Date
            ? row.updatedAt
            : new Date(row.updatedAt as string)
          if (rowUpdatedAt > maxUpdatedAt) {
            maxUpdatedAt = rowUpdatedAt
          }
          continue
        }
      }

      const values = upsertCols.map((col) => serializeValue(row[col]))
      await masterClient.$executeRawUnsafe(sql, ...values)

      // Stamp syncedAt locally if the column exists
      if (columns.includes('syncedAt')) {
        await masterClient.$executeRawUnsafe(
          `UPDATE "${tableName}" SET "syncedAt" = (NOW() AT TIME ZONE 'UTC') WHERE id = $1`,
          row.id as string
        )
      }

      // Fulfillment routing hook — when a cloud-originated Order arrives
      // with status 'sent', trigger fulfillment router on the NUC (fire-and-forget)
      if (tableName === 'Order' && row.lastMutatedBy === 'cloud' && row.status === 'sent') {
        void handleCloudFulfillment(row).catch((err) => {
          console.error('[DownstreamSync] Cloud fulfillment routing failed:', err)
        })
      }

      // Emit socket events when Order or OrderItem rows sync to local PG
      // so terminals know new data arrived without waiting for the next poll
      if (tableName === 'Order' || tableName === 'OrderItem') {
        void (async () => {
          try {
            const { dispatchOpenOrdersChanged } = await import('../socket-dispatch')
            const rowLocationId = row.locationId as string
            if (rowLocationId) {
              await dispatchOpenOrdersChanged(rowLocationId, {
                trigger: tableName === 'Order' ? 'created' : 'item_updated',
                orderId: tableName === 'Order' ? (row.id as string) : (row.orderId as string),
              })
            }
          } catch {
            // Socket dispatch is best-effort — don't fail sync
          }
        })().catch(console.error)
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

  // Advance high-water mark (in-memory + persisted to DB)
  if (synced > 0) {
    highWaterMarks.set(tableName, maxUpdatedAt)

    // Persist HWM to DB so it survives process restarts
    try {
      await masterClient.$executeRawUnsafe(
        `INSERT INTO "_gwi_sync_state" (table_name, high_water_mark, updated_at) VALUES ($1, $2, NOW())
         ON CONFLICT (table_name) DO UPDATE SET high_water_mark = $2, updated_at = NOW()`,
        tableName, maxUpdatedAt.toISOString()
      )
    } catch (err) {
      console.error(`[DownstreamSync] Failed to persist HWM for ${tableName}:`, err instanceof Error ? err.message : err)
    }
  }

  return synced
}

/**
 * Handle fulfillment routing for a cloud-originated order that arrived via downstream sync.
 * Fetches order items + station config from local PG, then calls routeOrderFulfillment.
 */
async function handleCloudFulfillment(row: Record<string, unknown>): Promise<void> {
  const orderId = row.id as string
  const locationId = row.locationId as string

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

  if (items.length === 0) return

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
      console.error(`[DownstreamSync] Failed to persist FulfillmentEvent ${action.type}:`, err)
    }
  }

  // ── Emit socket events immediately for instant KDS display ──────────────
  // The bridge worker will also process the persisted FulfillmentEvents for
  // durable retry, but emitting here eliminates the 2s bridge poll latency
  // for cellular orders — cutting KDS appearance from ~17.5s to near-instant.
  void (async () => {
    try {
      const { emitToLocation, emitToTags } = await import('../socket-server')
      const { dispatchOpenOrdersChanged } = await import('../socket-dispatch')

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

      // Emit open orders changed so terminals refresh their order lists
      await dispatchOpenOrdersChanged(locationId, {
        trigger: 'sent',
        orderId,
        orderNumber: row.orderNumber as number,
        status: 'sent',
      })
    } catch (err) {
      console.error('[DownstreamSync] Socket dispatch for cloud order failed:', err)
    }
  })().catch(console.error)

  console.log(`[DownstreamSync] Fulfillment routed for cloud order ${orderId} (${items.length} items, ${actions.length} events persisted)`)
}

// ── Bidirectional Conflict Detection ──────────────────────────────────────────

/**
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
): Promise<'apply' | 'skip'> {
  const hasLastMutatedBy = columns.includes('lastMutatedBy')
  const hasUpdatedAt = columns.includes('updatedAt')
  if (!hasUpdatedAt || !hasLastMutatedBy) return 'apply'

  try {
    const localRows = await masterClient.$queryRawUnsafe<Array<{
      updatedAt: Date
      lastMutatedBy: string | null
    }>>(
      `SELECT "updatedAt", "lastMutatedBy" FROM "${tableName}" WHERE id = $1 LIMIT 1`,
      neonRow.id as string,
    )

    // Row doesn't exist locally yet — always apply
    if (localRows.length === 0) return 'apply'

    const local = localRows[0]
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
          console.warn(
            `[DownstreamSync] Conflict on ${tableName}:${neonRow.id} — ` +
            `local is newer (${localUpdatedAt.toISOString()} > ${neonUpdatedAt.toISOString()}) ` +
            `but neon-wins strategy applied (local lastMutatedBy=${local.lastMutatedBy})`
          )
          metrics.conflictCount++
        }
        return 'apply'

      case 'local-wins':
        // Local always wins — skip Neon version
        console.warn(
          `[DownstreamSync] Conflict on ${tableName}:${neonRow.id} — ` +
          `local-wins strategy, skipping Neon version (local lastMutatedBy=${local.lastMutatedBy})`
        )
        metrics.conflictCount++
        return 'skip'

      case 'latest-wins':
        // Only skip Neon version if local is strictly newer AND locally mutated
        if (localUpdatedAt > neonUpdatedAt && local.lastMutatedBy !== 'cloud') {
          console.warn(
            `[DownstreamSync] Conflict on ${tableName}:${neonRow.id} — ` +
            `local is strictly newer (${localUpdatedAt.toISOString()} > ${neonUpdatedAt.toISOString()}) ` +
            `and lastMutatedBy=${local.lastMutatedBy}, keeping local version`
          )
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

/**
 * Sync the cellular terminal deny list from the local CellularDevice table.
 * Devices with status 'revoked' or 'quarantined' get added to the in-memory deny list.
 */
async function syncCellularDenyList(): Promise<void> {
  try {
    const revoked = await masterClient.$queryRawUnsafe<Array<{
      terminalId: string
      updatedAt: Date
    }>>(
      `SELECT "terminalId", "updatedAt" FROM "CellularDevice" WHERE status IN ('revoked', 'quarantined') AND "terminalId" IS NOT NULL`
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
    // CellularDevice table may not exist yet — safe to skip
  }
}

// ── Core downstream cycle ────────────────────────────────────────────────────

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

    // Sync cellular deny list at the end of each cycle
    void syncCellularDenyList().catch((err) => {
      console.error('[DownstreamSync] Cellular deny list sync failed:', err)
    })
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
 * @param _domain - Optional domain name (legacy)
 * @param modelNames - Optional specific model names to sync (e.g., ['Order', 'Payment'])
 */
export async function triggerImmediateDownstreamSync(_domain?: string, modelNames?: string[]): Promise<void> {
  if (immediateRunning) return
  immediateRunning = true
  try {
    if (modelNames && modelNames.length > 0) {
      await runDownstreamCycleForModels(modelNames)
    } else {
      await runDownstreamCycle()
    }
  } finally {
    immediateRunning = false
  }
}

/**
 * Run downstream sync for specific models only.
 * Used by SSE wake-up to immediately sync newly changed bidirectional models.
 */
async function runDownstreamCycleForModels(modelNames: string[]): Promise<void> {
  if (!hasNeonConnection()) return

  try {
    const allModels = getDownstreamModels()
    const targetSet = new Set(modelNames)
    const models = allModels.filter(([name]) => targetSet.has(name))
    let totalSynced = 0

    for (const [tableName, config] of models) {
      if (!columnCache.has(tableName)) continue

      try {
        const synced = await syncTableDown(tableName, config.batchSize)
        totalSynced += synced

        if (synced > 0) {
          console.log(`[DownstreamSync] ${tableName}: ${synced} rows (immediate)`)
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
      console.log(`[DownstreamSync] Immediate: ${totalSynced} rows synced for [${modelNames.join(', ')}]`)
    }
  } catch (err) {
    console.error('[DownstreamSync] Immediate cycle error:', err)
  }
}

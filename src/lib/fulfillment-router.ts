/**
 * Fulfillment Router — Item-level fulfillment routing engine
 *
 * Routes each order item to its target station based on MenuItem.fulfillmentType
 * and fulfillmentStationId. Complements the tag-based OrderRouter with explicit
 * fulfillment-type routing for the HA cellular architecture.
 *
 * Design principles:
 * - Pure routing decisions — no hardware side effects
 * - Idempotent — two-tier idempotency cache prevents duplicate routing:
 *     L1: In-memory Map (60s TTL, fast path — avoids DB hit on every call)
 *     L2: DB-backed FulfillmentEvent query (5min TTL — survives server restarts)
 * - Groups items by target station for efficient ticket printing
 * - Never blocks order writes — runs AFTER write succeeds
 *
 * Resolution order per item:
 *   1. fulfillmentStationId (explicit override) → use that station
 *   2. fulfillmentType-based default → find station by tag match
 *   3. Fallback → venue's primary kitchen (isDefault or 'kitchen' tag)
 */

import { Prisma } from '@/generated/prisma/client'
import { masterClient } from './db'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Fulfillment types matching the Prisma FulfillmentType enum */
export type FulfillmentType =
  | 'SELF_FULFILL'
  | 'KITCHEN_STATION'
  | 'BAR_STATION'
  | 'PREP_STATION'
  | 'NO_ACTION'

/** Item with fulfillment metadata — caller provides from pre-fetched order data */
export interface FulfillmentItem {
  id: string
  menuItemId: string
  name: string
  quantity: number
  modifiers?: Array<{ name: string; quantity?: number }>
  fulfillmentType: FulfillmentType
  fulfillmentStationId: string | null
}

/** Minimal station config — caller provides from pre-fetched station data */
export interface FulfillmentStationConfig {
  id: string
  name: string
  type: 'PRINTER' | 'KDS'
  tags: string[]
  isDefault: boolean
  isActive: boolean
}

/** Action type produced by the router */
export type FulfillmentActionType =
  | 'print_kitchen'
  | 'print_bar'
  | 'print_prep'
  | 'kds_update'
  | 'self'
  | 'no_action'

/** Single fulfillment action — one per target station, items grouped */
export interface FulfillmentAction {
  type: FulfillmentActionType
  stationId: string | null
  stationName: string | null
  items: FulfillmentActionItem[]
  idempotencyKey: string
  orderId: string
  locationId: string
}

export interface FulfillmentActionItem {
  orderItemId: string
  menuItemId: string
  name: string
  quantity: number
  modifiers?: Array<{ name: string; quantity?: number }>
}

/** Optional origin device info (for future cellular-specific routing) */
export interface OriginDevice {
  terminalId?: string
  type?: 'lan' | 'cellular'
}

// ---------------------------------------------------------------------------
// Two-tier idempotency cache
//
// L1: In-memory Map — 60s TTL, fast path (no DB roundtrip on every call)
// L2: DB-backed query on FulfillmentEvent — 5min TTL, survives server restarts
//
// On restart, L1 is empty but L2 still has records, preventing duplicate tickets.
// ---------------------------------------------------------------------------

const recentKeys = new Map<string, number>()
const L1_TTL_MS = 60_000       // 60s in-memory cache
const L2_TTL_MS = 5 * 60_000   // 5min DB-backed window
const MAX_ENTRIES = 10_000

/**
 * Check if an idempotency key was already routed.
 * L1 (memory) is checked first. On miss, falls back to L2 (DB).
 */
async function isAlreadyRouted(key: string, locationId: string): Promise<boolean> {
  pruneIfNeeded()

  // L1: in-memory fast path
  if (recentKeys.has(key)) return true

  // L2: DB-backed check — only fires on L1 miss (cold start / cache expired)
  try {
    const cutoff = new Date(Date.now() - L2_TTL_MS)
    const rows = await masterClient.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "FulfillmentEvent"
       WHERE "locationId" = ${locationId}
         AND payload->>'idempotencyKey' = ${key}
         AND "createdAt" > ${cutoff}::timestamptz
       LIMIT 1`,
    )
    if (rows.length > 0) {
      // Warm the L1 cache so subsequent checks are fast
      recentKeys.set(key, Date.now())
      return true
    }
  } catch (err) {
    // DB check is best-effort — if it fails, allow routing to proceed.
    // The L1 cache still prevents duplicates within the same process lifetime.
    console.error('[fulfillment-router] L2 idempotency check failed:', err)
  }

  return false
}

/**
 * Record an idempotency key in both L1 (memory) and L2 (DB).
 * L2 write is a single FulfillmentEvent row with type 'idempotency_marker'.
 */
async function markRouted(key: string, orderId: string, locationId: string): Promise<void> {
  // L1: immediate
  recentKeys.set(key, Date.now())

  // L2: persist to DB so the key survives restarts
  try {
    await masterClient.$executeRaw(
      Prisma.sql`INSERT INTO "FulfillmentEvent" (id, "locationId", "orderId", type, status, payload, "completedAt", "createdAt", "updatedAt")
       VALUES (
         ${`idem_${key.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 200)}_${Date.now()}`},
         ${locationId},
         ${orderId},
         'idempotency_marker',
         'completed',
         ${JSON.stringify({ idempotencyKey: key })}::jsonb,
         NOW(),
         NOW(),
         NOW()
       )
       ON CONFLICT DO NOTHING`,
    )
  } catch (err) {
    // Best-effort — L1 still protects within this process lifetime
    console.error('[fulfillment-router] L2 idempotency write failed:', err)
  }
}

function pruneIfNeeded(): void {
  if (recentKeys.size < MAX_ENTRIES) return
  const now = Date.now()
  Array.from(recentKeys.entries()).forEach(([k, ts]) => {
    if (now - ts > L1_TTL_MS) {
      recentKeys.delete(k)
    }
  })
}

// ---------------------------------------------------------------------------
// Periodic DB cleanup — remove stale idempotency markers older than L2_TTL_MS
// Runs every 60s, lightweight single DELETE query.
// ---------------------------------------------------------------------------

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startIdempotencyCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - L2_TTL_MS)
      await masterClient.$executeRaw(
        Prisma.sql`DELETE FROM "FulfillmentEvent"
         WHERE type = 'idempotency_marker'
           AND "createdAt" < ${cutoff}::timestamptz`,
      )
    } catch {
      // Best-effort cleanup — silent failure is fine
    }
  }, 60_000)
  cleanupTimer.unref?.() // Don't prevent process exit
}

// Start cleanup on module load (NUC server process)
startIdempotencyCleanup()

// ---------------------------------------------------------------------------
// Core router
// ---------------------------------------------------------------------------

/**
 * Route order items to fulfillment stations.
 *
 * Returns FulfillmentAction[] grouped by station. The caller is responsible
 * for persisting events and dispatching hardware side effects.
 *
 * @param order       - Order identity (id + locationId)
 * @param items       - Items with fulfillment metadata (from pre-fetched data)
 * @param stations    - Active stations for this location (from pre-fetched data)
 * @param sendTimestamp - Unique send timestamp for idempotency key
 * @param originDevice - Optional origin device info
 */
export async function routeOrderFulfillment(
  order: { id: string; locationId: string },
  items: FulfillmentItem[],
  stations: FulfillmentStationConfig[],
  sendTimestamp: string,
  originDevice?: OriginDevice,
): Promise<FulfillmentAction[]> {
  const idempotencyKey = `${order.id}:${sendTimestamp}`

  // Idempotency: skip if this exact send was already routed (L1 memory → L2 DB)
  if (await isAlreadyRouted(idempotencyKey, order.locationId)) {
    return []
  }

  // Group items by resolved station
  const stationGroups = new Map<string, {
    type: FulfillmentActionType
    stationId: string | null
    stationName: string | null
    items: FulfillmentActionItem[]
  }>()
  const selfItems: FulfillmentActionItem[] = []

  for (const item of items) {
    const resolution = resolveStation(item, stations)

    // NO_ACTION items are dropped entirely
    if (resolution.type === 'no_action') continue

    const actionItem: FulfillmentActionItem = {
      orderItemId: item.id,
      menuItemId: item.menuItemId,
      name: item.name,
      quantity: item.quantity,
      modifiers: item.modifiers,
    }

    // SELF_FULFILL items go into a single self action
    if (resolution.type === 'self') {
      selfItems.push(actionItem)
      continue
    }

    // Group by station for efficient ticket printing
    const groupKey = resolution.stationId || `__unresolved_${resolution.type}`
    const existing = stationGroups.get(groupKey)

    if (existing) {
      existing.items.push(actionItem)
    } else {
      stationGroups.set(groupKey, {
        type: resolution.type,
        stationId: resolution.stationId,
        stationName: resolution.stationName,
        items: [actionItem],
      })
    }
  }

  // Build action array
  const actions: FulfillmentAction[] = []

  Array.from(stationGroups.values()).forEach(group => {
    actions.push({
      type: group.type,
      stationId: group.stationId,
      stationName: group.stationName,
      items: group.items,
      idempotencyKey,
      orderId: order.id,
      locationId: order.locationId,
    })
  })

  if (selfItems.length > 0) {
    actions.push({
      type: 'self',
      stationId: null,
      stationName: null,
      items: selfItems,
      idempotencyKey,
      orderId: order.id,
      locationId: order.locationId,
    })
  }

  // Record idempotency in L1 (memory) + L2 (DB) after successful routing
  await markRouted(idempotencyKey, order.id, order.locationId)

  return actions
}

// ---------------------------------------------------------------------------
// Station resolution (pure — no DB)
// ---------------------------------------------------------------------------

interface StationResolution {
  type: FulfillmentActionType
  stationId: string | null
  stationName: string | null
}

/**
 * Resolve the target station for a single item.
 *
 * Resolution order:
 *   1. NO_ACTION / SELF_FULFILL → short-circuit (no station needed)
 *   2. Explicit fulfillmentStationId → use that station if active
 *   3. Type-based default → station matching the fulfillment type's tag
 *   4. Fallback → venue's primary kitchen (isDefault, then 'kitchen' tag, then any active)
 */
function resolveStation(
  item: FulfillmentItem,
  stations: FulfillmentStationConfig[],
): StationResolution {
  const { fulfillmentType, fulfillmentStationId } = item

  // Short-circuit: no hardware dispatch needed
  if (fulfillmentType === 'NO_ACTION') {
    return { type: 'no_action', stationId: null, stationName: null }
  }
  if (fulfillmentType === 'SELF_FULFILL') {
    return { type: 'self', stationId: null, stationName: null }
  }

  const actionType = toActionType(fulfillmentType)

  // 1. Explicit station override
  if (fulfillmentStationId) {
    const station = stations.find(s => s.id === fulfillmentStationId && s.isActive)
    if (station) {
      return { type: actionType, stationId: station.id, stationName: station.name }
    }
    // Explicit station not found or inactive — fall through to type-based default
  }

  // 2. Type-based default: find station by matching tag
  const defaultStation = findDefaultForType(fulfillmentType, stations)
  if (defaultStation) {
    return { type: actionType, stationId: defaultStation.id, stationName: defaultStation.name }
  }

  // 3. Fallback: primary kitchen — never silently drop a ticket
  const fallback =
    stations.find(s => s.isDefault && s.isActive) ||
    stations.find(s => s.tags.includes('kitchen') && s.isActive) ||
    stations.find(s => s.isActive)

  if (fallback) {
    return { type: actionType, stationId: fallback.id, stationName: fallback.name }
  }

  // No stations configured — return action with null station (caller decides)
  return { type: actionType, stationId: null, stationName: null }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map FulfillmentType → FulfillmentActionType */
function toActionType(ft: FulfillmentType): FulfillmentActionType {
  switch (ft) {
    case 'KITCHEN_STATION': return 'print_kitchen'
    case 'BAR_STATION':     return 'print_bar'
    case 'PREP_STATION':    return 'print_prep'
    default:                return 'print_kitchen'
  }
}

/** Tag associated with each fulfillment type for default station lookup */
const FULFILLMENT_TYPE_TAGS: Record<string, string> = {
  KITCHEN_STATION: 'kitchen',
  BAR_STATION: 'bar',
  PREP_STATION: 'prep',
}

/**
 * Find the default station for a fulfillment type.
 * Prefers a default station with the matching tag, then any station with the tag.
 */
function findDefaultForType(
  fulfillmentType: FulfillmentType,
  stations: FulfillmentStationConfig[],
): FulfillmentStationConfig | undefined {
  const tag = FULFILLMENT_TYPE_TAGS[fulfillmentType]
  if (!tag) return undefined

  return (
    stations.find(s => s.tags.includes(tag) && s.isDefault && s.isActive) ||
    stations.find(s => s.tags.includes(tag) && s.isActive)
  )
}

/**
 * Clear the in-memory idempotency cache and stop the cleanup timer.
 * Exposed for testing only.
 * @internal
 */
export function _clearIdempotencyCache(): void {
  recentKeys.clear()
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

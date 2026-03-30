/**
 * Canonical Venue Readiness Contract
 *
 * ONE source of truth for "is this venue ready?" used by:
 * - server.ts (sync worker gating)
 * - venue-bootstrap.ts (bootstrap readiness)
 * - health endpoints (fleet health reporting)
 * - /api/internal/readiness (MC fleet UI)
 * - /api/internal/nuc-readiness (heartbeat)
 *
 * Readiness levels:
 * - FAILED:   Local DB unreachable or critical error — server cannot function
 * - BOOT:     Local DB exists, basic schema present — server can start, no sync
 * - SYNC:     Neon reachable, schema compatible, seed present — sync workers can start
 * - ORDERS:   First downstream sync complete, critical tables populated — safe for customer traffic
 * - DEGRADED: Was at SYNC or ORDERS but something regressed (Neon dropped, etc.)
 */

import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('readiness')

// ── Types ────────────────────────────────────────────────────────────────────

export type ReadinessLevel = 'FAILED' | 'BOOT' | 'SYNC' | 'ORDERS' | 'DEGRADED'

/** Numeric ordering for comparison: FAILED < BOOT < SYNC < ORDERS.
 *  DEGRADED is a condition overlay, not a stage — ranks same as BOOT (minimum readiness). */
const LEVEL_RANK: Record<ReadinessLevel, number> = {
  FAILED: 0,
  BOOT: 1,
  SYNC: 2,
  ORDERS: 3,
  DEGRADED: 1,
}

export interface ReadinessInputs {
  localDbUp: boolean
  localSchemaVerified: boolean
  neonConfigured: boolean
  neonReachable: boolean
  neonSchemaVersionOk: boolean     // match OR ahead (not behind)
  neonCoreTablesExist: boolean
  neonRequiredEnumsExist: boolean
  baseSeedPresent: boolean
  syncEnabled: boolean
  stationRole: string | undefined   // 'primary' | 'backup' | 'fenced' | undefined
  initialSyncComplete: boolean
  /** True when seed-from-neon.sh completed successfully (or no seed status file exists — pre-hardening). */
  seedComplete: boolean
}

/**
 * Critical operational tables that must be populated before accepting customer traffic.
 * Used by advanceToOrders() and server.ts startup to gate ORDERS level.
 */
export const CRITICAL_OPERATIONAL_TABLES = [
  'Location', 'Organization', 'Role', 'Employee', 'Category', 'OrderType',
] as const

export interface ReadinessState {
  level: ReadinessLevel
  /** Individual check results */
  localDbUp: boolean
  localSchemaVerified: boolean
  neonReachable: boolean
  neonSchemaVersionOk: boolean
  neonCoreTablesExist: boolean
  neonRequiredEnumsExist: boolean
  baseSeedPresent: boolean
  syncEnabled: boolean
  initialSyncComplete: boolean
  seedComplete: boolean
  /**
   * True when ALL Neon checks pass (reachable + schema + tables + enums + seed).
   * Can be false while level=SYNC when operating in offline-first mode (local DB
   * is ready but Neon is temporarily unreachable). Sync workers handle retries.
   */
  syncContractReady: boolean
  /** Human-readable reasons for degradation or failure */
  degradedReasons: string[]
  timestamp: string
}

// ── Pure computation ─────────────────────────────────────────────────────────

/**
 * Compute readiness from inputs. Pure function: no side effects, no DB queries.
 * All inputs are gathered elsewhere (bootstrap, schema-verify, sync worker)
 * and fed into this function.
 */
export function computeReadiness(inputs: ReadinessInputs): ReadinessState {
  const degradedReasons: string[] = []
  const timestamp = new Date().toISOString()

  // Base state from inputs
  const state: ReadinessState = {
    level: 'FAILED',
    localDbUp: inputs.localDbUp,
    localSchemaVerified: inputs.localSchemaVerified,
    neonReachable: inputs.neonReachable,
    neonSchemaVersionOk: inputs.neonSchemaVersionOk,
    neonCoreTablesExist: inputs.neonCoreTablesExist,
    neonRequiredEnumsExist: inputs.neonRequiredEnumsExist,
    baseSeedPresent: inputs.baseSeedPresent,
    syncEnabled: inputs.syncEnabled,
    initialSyncComplete: inputs.initialSyncComplete,
    seedComplete: inputs.seedComplete,
    syncContractReady: false,
    degradedReasons,
    timestamp,
  }

  // Level 0: FAILED — local DB not up
  if (!inputs.localDbUp) {
    degradedReasons.push('local-db-down')
    state.level = 'FAILED'
    return state
  }

  // Level 1: BOOT — local DB is up (server can start)
  state.level = 'BOOT'

  if (!inputs.localSchemaVerified) {
    degradedReasons.push('local-schema-verification-failed')
  }

  // If Neon is not configured, BOOT is the max level (local-only mode)
  if (!inputs.neonConfigured) {
    return state
  }

  // If sync is disabled or backup role, BOOT is the max level
  if (!inputs.syncEnabled) {
    degradedReasons.push('sync-disabled')
    return state
  }
  if (inputs.stationRole === 'backup') {
    degradedReasons.push('backup-readonly-mode')
    return state
  }

  // Evaluate sync contract: track Neon check results
  if (!inputs.neonReachable) degradedReasons.push('neon-unreachable')
  if (!inputs.neonSchemaVersionOk) degradedReasons.push('neon-schema-version-incompatible')
  if (!inputs.neonCoreTablesExist) degradedReasons.push('neon-core-tables-missing')
  if (!inputs.neonRequiredEnumsExist) degradedReasons.push('neon-required-enums-missing')
  if (!inputs.baseSeedPresent) degradedReasons.push('base-seed-missing')
  if (!inputs.seedComplete) degradedReasons.push('seed-incomplete')

  const neonSchemaOk = inputs.neonReachable &&
    inputs.neonSchemaVersionOk &&
    inputs.neonCoreTablesExist &&
    inputs.neonRequiredEnumsExist &&
    inputs.baseSeedPresent

  // Sync contract is fully ready when all Neon checks pass
  state.syncContractReady = inputs.localDbUp &&
    inputs.localSchemaVerified &&
    inputs.seedComplete &&
    neonSchemaOk

  // Offline-first: if local DB is verified and seed was completed previously,
  // allow SYNC level even when Neon is temporarily unreachable. Sync workers
  // will retry Neon connections internally. The POS must not stay stuck in
  // BOOT just because Neon is down — orders, payments, KDS all work locally.
  const localReady = inputs.localDbUp && inputs.localSchemaVerified && inputs.seedComplete

  if (!state.syncContractReady && !localReady) {
    // Local DB not ready — stay at BOOT
    return state
  }

  // Level 2: SYNC — sync workers can start (they handle Neon retries internally)
  state.level = 'SYNC'

  // Level 3: ORDERS — ONLY reachable through advanceToOrders() which verifies
  // critical tables are populated. computeReadiness() never promotes to ORDERS
  // directly, even if initialSyncComplete is true. This eliminates the semantic
  // split where two code paths could disagree about order-readiness.

  return state
}

// ── Shared singleton state via globalThis ────────────────────────────────────
// CRITICAL: server.js (esbuild) and Next.js API routes (Turbopack/Webpack) load
// separate module copies. A module-level `let _state` creates TWO independent
// singletons — server.ts sets one, API routes read the other (always null).
// Using globalThis ensures both module systems share the same readiness state.

const READINESS_KEY = '__gwi_readiness_state' as const

// Declare on globalThis for cross-module sharing
declare global {
   
  var __gwi_readiness_state: ReadinessState | null | undefined
}

if (globalThis.__gwi_readiness_state === undefined) {
  globalThis.__gwi_readiness_state = null
}

/**
 * Get the current cached readiness state.
 * Returns null if readiness has never been computed (pre-boot).
 */
export function getReadinessState(): ReadinessState | null {
  return globalThis.__gwi_readiness_state ?? null
}

/**
 * Set the readiness state. Called by server.ts after bootstrap and schema verification.
 * Also called when readiness advances (e.g., initial sync completes).
 */
export function setReadinessState(state: ReadinessState): void {
  const prev = globalThis.__gwi_readiness_state?.level
  globalThis.__gwi_readiness_state = state
  if (prev !== state.level) {
    log.info({ from: prev ?? 'INIT', to: state.level, degraded: state.degradedReasons }, 'Readiness level changed')
  }
}

/**
 * Advance readiness to ORDERS level after initial downstream sync completes.
 * Only advances if current level is SYNC (won't override FAILED/BOOT/DEGRADED).
 *
 * If criticalTableCounts are provided, verifies that essential operational tables
 * are populated locally. If any are empty, transitions to DEGRADED instead of ORDERS
 * so the venue doesn't accept customer traffic with an incomplete catalog.
 */
export function advanceToOrders(criticalTableCounts?: Record<string, number>): void {
  const _state = globalThis.__gwi_readiness_state
  if (!_state || _state.level !== 'SYNC') return

  // If counts provided, verify critical tables have data
  if (criticalTableCounts) {
    const required: readonly string[] = CRITICAL_OPERATIONAL_TABLES
    const missing = required.filter(t => !criticalTableCounts[t] || criticalTableCounts[t] === 0)
    if (missing.length > 0) {
      // Don't advance — critical tables empty after first sync
      globalThis.__gwi_readiness_state = {
        ..._state,
        level: 'DEGRADED',
        degradedReasons: [..._state.degradedReasons, `critical-tables-empty: ${missing.join(', ')}`],
        initialSyncComplete: true,
        timestamp: new Date().toISOString(),
      }
      log.warn({ missing }, 'ORDERS gate FAILED — critical tables empty after initial sync, entering DEGRADED')
      return
    }
  }

  globalThis.__gwi_readiness_state = {
    ..._state,
    level: 'ORDERS',
    initialSyncComplete: true,
    timestamp: new Date().toISOString(),
  }
  log.info('Readiness advanced to ORDERS — safe for customer traffic')
}

/**
 * Convenience: true only when level is ORDERS.
 * Use this to gate order-taking endpoints if you want to ensure
 * initial sync has completed.
 */
export function isReadyForOrders(): boolean {
  return globalThis.__gwi_readiness_state?.level === 'ORDERS'
}

/**
 * Convenience: true when level is SYNC or ORDERS.
 * Use this to gate sync worker startup.
 */
export function isReadyForSync(): boolean {
  const s = globalThis.__gwi_readiness_state
  if (!s) return false
  return LEVEL_RANK[s.level] >= LEVEL_RANK['SYNC']
}

/**
 * Compare two readiness levels.
 * Returns true if `level` is >= `threshold`.
 */
export function meetsLevel(level: ReadinessLevel, threshold: ReadinessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold]
}

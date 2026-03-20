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

/** Numeric ordering for comparison: FAILED < BOOT < SYNC < ORDERS. DEGRADED is separate. */
const LEVEL_RANK: Record<ReadinessLevel, number> = {
  FAILED: 0,
  BOOT: 1,
  DEGRADED: 2,
  SYNC: 3,
  ORDERS: 4,
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
}

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
  /** True when all Neon checks pass and sync can start */
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

  // Evaluate sync contract: all Neon checks must pass + local schema verified
  if (!inputs.neonReachable) degradedReasons.push('neon-unreachable')
  if (!inputs.neonSchemaVersionOk) degradedReasons.push('neon-schema-version-incompatible')
  if (!inputs.neonCoreTablesExist) degradedReasons.push('neon-core-tables-missing')
  if (!inputs.neonRequiredEnumsExist) degradedReasons.push('neon-required-enums-missing')
  if (!inputs.baseSeedPresent) degradedReasons.push('base-seed-missing')

  const neonSchemaOk = inputs.neonReachable &&
    inputs.neonSchemaVersionOk &&
    inputs.neonCoreTablesExist &&
    inputs.neonRequiredEnumsExist &&
    inputs.baseSeedPresent

  state.syncContractReady = inputs.localDbUp &&
    inputs.localSchemaVerified &&
    neonSchemaOk

  if (!state.syncContractReady) {
    // Some Neon check failed — stay at BOOT with degraded reasons
    return state
  }

  // Level 2: SYNC — sync workers can safely start
  state.level = 'SYNC'

  // Level 3: ORDERS — first downstream sync complete, safe for traffic
  if (inputs.initialSyncComplete) {
    state.level = 'ORDERS'
  }

  return state
}

// ── Module-level singleton state ─────────────────────────────────────────────

let _state: ReadinessState | null = null

/**
 * Get the current cached readiness state.
 * Returns null if readiness has never been computed (pre-boot).
 */
export function getReadinessState(): ReadinessState | null {
  return _state
}

/**
 * Set the readiness state. Called by server.ts after bootstrap and schema verification.
 * Also called when readiness advances (e.g., initial sync completes).
 */
export function setReadinessState(state: ReadinessState): void {
  const prev = _state?.level
  _state = state
  if (prev !== state.level) {
    log.info({ from: prev ?? 'INIT', to: state.level, degraded: state.degradedReasons }, 'Readiness level changed')
  }
}

/**
 * Advance readiness to ORDERS level after initial downstream sync completes.
 * Only advances if current level is SYNC (won't override FAILED/BOOT/DEGRADED).
 */
export function advanceToOrders(): void {
  if (!_state || _state.level !== 'SYNC') return
  _state = {
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
  return _state?.level === 'ORDERS'
}

/**
 * Convenience: true when level is SYNC or ORDERS.
 * Use this to gate sync worker startup.
 */
export function isReadyForSync(): boolean {
  if (!_state) return false
  return LEVEL_RANK[_state.level] >= LEVEL_RANK['SYNC']
}

/**
 * Compare two readiness levels.
 * Returns true if `level` is >= `threshold`.
 */
export function meetsLevel(level: ReadinessLevel, threshold: ReadinessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold]
}

/**
 * venue-state.ts — Venue lifecycle state machine for the GWI POS self-healing appliance model.
 *
 * Every venue has a machine-readable current state. Every failure path lands in an explicit state.
 * Operators can see why a venue is degraded or blocked.
 *
 * State file: /opt/gwi-pos/shared/state/venue-state.json
 * Bash integration: gwi-node.sh venue-state subcommand
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type VenueLifecycleState =
  | 'BOOTSTRAPPING'     // First install, not yet converged
  | 'CONVERGING'        // Update in progress, reconciling components
  | 'CONVERGED'         // All components at target version, healthy
  | 'DEGRADED'          // Some components behind or unhealthy, but operational
  | 'BLOCKED'           // Cannot converge, requires intervention
  | 'ROLLING_BACK'      // Actively rolling back to last-known-good
  | 'RECOVERY_REQUIRED'; // Failed rollback or critical structural failure

export type ComponentName = 'server' | 'dashboard' | 'schema' | 'baseline';

export type ComponentStatus = 'converged' | 'behind' | 'ahead' | 'failed' | 'unknown';

export interface ComponentState {
  name: string;
  targetVersion: string;
  currentVersion: string;
  lastKnownGoodVersion: string | null;
  status: ComponentStatus;
  lastConvergedAt: string | null;   // ISO timestamp
  lastAttemptAt: string | null;     // ISO timestamp
  attemptCount: number;
  error: string | null;
}

export interface VenueState {
  lifecycleState: VenueLifecycleState;
  components: {
    server: ComponentState;
    schema: ComponentState;
    dashboard: ComponentState;
    baseline: ComponentState;
  };
  lastConvergedAt: string | null;
  lastStateChangeAt: string;
  blockedReason: string | null;
  degradedReasons: string[];
  convergenceAttempts: number;
}

// ---------------------------------------------------------------------------
//  Constants
// ---------------------------------------------------------------------------

const STATE_FILE = '/opt/gwi-pos/shared/state/venue-state.json';

/** Maximum convergence attempts before a component is considered BLOCKED. */
const MAX_CONVERGENCE_ATTEMPTS = 5;

/**
 * Valid state transitions. Each key is a current state; the value is the set
 * of states it can transition to.
 */
const VALID_TRANSITIONS: Record<VenueLifecycleState, Set<VenueLifecycleState>> = {
  BOOTSTRAPPING:     new Set(['CONVERGING', 'CONVERGED', 'BLOCKED']),
  CONVERGING:        new Set(['CONVERGED', 'DEGRADED', 'BLOCKED', 'ROLLING_BACK']),
  CONVERGED:         new Set(['CONVERGING', 'DEGRADED']),
  DEGRADED:          new Set(['CONVERGING', 'CONVERGED', 'BLOCKED']),
  BLOCKED:           new Set(['CONVERGING', 'RECOVERY_REQUIRED']),
  ROLLING_BACK:      new Set(['CONVERGED', 'DEGRADED', 'RECOVERY_REQUIRED']),
  RECOVERY_REQUIRED: new Set(['BOOTSTRAPPING', 'CONVERGING']),
};

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeDefaultComponent(name: string): ComponentState {
  return {
    name,
    targetVersion: '0.0.0',
    currentVersion: '0.0.0',
    lastKnownGoodVersion: null,
    status: 'unknown',
    lastConvergedAt: null,
    lastAttemptAt: null,
    attemptCount: 0,
    error: null,
  };
}

function makeDefaultState(): VenueState {
  return {
    lifecycleState: 'BOOTSTRAPPING',
    components: {
      server: makeDefaultComponent('server'),
      schema: makeDefaultComponent('schema'),
      dashboard: makeDefaultComponent('dashboard'),
      baseline: makeDefaultComponent('baseline'),
    },
    lastConvergedAt: null,
    lastStateChangeAt: now(),
    blockedReason: null,
    degradedReasons: [],
    convergenceAttempts: 0,
  };
}

// ---------------------------------------------------------------------------
//  Persistence
// ---------------------------------------------------------------------------

/**
 * Read the current venue state from disk.
 * Returns a default BOOTSTRAPPING state if the file does not exist or is corrupt.
 */
export function readVenueState(): VenueState {
  try {
    if (!existsSync(STATE_FILE)) {
      return makeDefaultState();
    }
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as VenueState;
    // Basic structural validation — if the top-level shape is wrong, reset
    if (!parsed.lifecycleState || !parsed.components) {
      return makeDefaultState();
    }
    return parsed;
  } catch {
    return makeDefaultState();
  }
}

/**
 * Write the full venue state to disk atomically (write-then-rename pattern).
 */
export function writeVenueState(state: VenueState): void {
  const dir = dirname(STATE_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${STATE_FILE}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8');
  renameSync(tmp, STATE_FILE);
}

// ---------------------------------------------------------------------------
//  State computation
// ---------------------------------------------------------------------------

/**
 * Derive the lifecycle state from current component states.
 *
 * Rules:
 *  - All converged                         → CONVERGED
 *  - Any failed after max attempts         → BLOCKED
 *  - Any "behind" but server is converged  → DEGRADED
 *  - Active update in progress (any behind/unknown, server not failed) → CONVERGING
 */
export function computeVenueState(
  components: VenueState['components']
): { lifecycle: VenueLifecycleState; blockedReason: string | null; degradedReasons: string[] } {
  const all = [components.server, components.schema, components.dashboard, components.baseline];

  // Check for blocked components (failed after max attempts)
  const blockedComponents = all.filter(
    (c) => c.status === 'failed' && c.attemptCount >= MAX_CONVERGENCE_ATTEMPTS
  );
  if (blockedComponents.length > 0) {
    const reason = blockedComponents
      .map((c) => `${c.name}: ${c.error ?? 'unknown error'} (${c.attemptCount} attempts)`)
      .join('; ');
    return { lifecycle: 'BLOCKED', blockedReason: reason, degradedReasons: [] };
  }

  // All converged?
  const allConverged = all.every((c) => c.status === 'converged');
  if (allConverged) {
    return { lifecycle: 'CONVERGED', blockedReason: null, degradedReasons: [] };
  }

  // Server healthy but other components behind → DEGRADED
  const serverHealthy = components.server.status === 'converged';
  const behindOrFailed = all.filter((c) => c.status === 'behind' || c.status === 'failed' || c.status === 'ahead');
  if (serverHealthy && behindOrFailed.length > 0) {
    const reasons = behindOrFailed.map(
      (c) => `${c.name}: ${c.status} (current=${c.currentVersion}, target=${c.targetVersion})`
    );
    return { lifecycle: 'DEGRADED', blockedReason: null, degradedReasons: reasons };
  }

  // Otherwise: converging (something is behind/unknown, no hard block)
  return { lifecycle: 'CONVERGING', blockedReason: null, degradedReasons: [] };
}

// ---------------------------------------------------------------------------
//  Mutations
// ---------------------------------------------------------------------------

/**
 * Validate and perform a lifecycle state transition.
 * Throws if the transition is invalid.
 */
export function transitionTo(targetState: VenueLifecycleState): VenueState {
  const state = readVenueState();
  const current = state.lifecycleState;

  if (current === targetState) {
    // No-op: already in the target state
    return state;
  }

  const allowed = VALID_TRANSITIONS[current];
  if (!allowed || !allowed.has(targetState)) {
    throw new Error(
      `Invalid venue state transition: ${current} → ${targetState}. ` +
      `Allowed from ${current}: [${[...(allowed ?? [])].join(', ')}]`
    );
  }

  state.lifecycleState = targetState;
  state.lastStateChangeAt = now();

  if (targetState === 'CONVERGED') {
    state.lastConvergedAt = now();
    state.blockedReason = null;
    state.degradedReasons = [];
    state.convergenceAttempts = 0;
  }

  if (targetState === 'CONVERGING') {
    state.convergenceAttempts += 1;
  }

  writeVenueState(state);
  return state;
}

/**
 * Update a single component's state and recompute the venue lifecycle.
 */
export function updateComponentState(
  componentName: ComponentName,
  update: Partial<Omit<ComponentState, 'name'>>
): VenueState {
  const state = readVenueState();
  const component = state.components[componentName];

  // Apply partial update
  if (update.targetVersion !== undefined) component.targetVersion = update.targetVersion;
  if (update.currentVersion !== undefined) component.currentVersion = update.currentVersion;
  if (update.lastKnownGoodVersion !== undefined) component.lastKnownGoodVersion = update.lastKnownGoodVersion;
  if (update.status !== undefined) component.status = update.status;
  if (update.lastConvergedAt !== undefined) component.lastConvergedAt = update.lastConvergedAt;
  if (update.lastAttemptAt !== undefined) component.lastAttemptAt = update.lastAttemptAt;
  if (update.attemptCount !== undefined) component.attemptCount = update.attemptCount;
  if (update.error !== undefined) component.error = update.error;

  // Auto-set lastConvergedAt when status becomes converged
  if (update.status === 'converged') {
    component.lastConvergedAt = now();
    component.error = null;
    // Promote current to last-known-good
    component.lastKnownGoodVersion = component.currentVersion;
  }

  // Recompute lifecycle from component states
  const computed = computeVenueState(state.components);
  const previousLifecycle = state.lifecycleState;
  const newLifecycle = computed.lifecycle;

  // Only transition if the computed state is a valid transition
  const allowed = VALID_TRANSITIONS[previousLifecycle];
  if (newLifecycle !== previousLifecycle && allowed && allowed.has(newLifecycle)) {
    state.lifecycleState = newLifecycle;
    state.lastStateChangeAt = now();

    if (newLifecycle === 'CONVERGED') {
      state.lastConvergedAt = now();
      state.convergenceAttempts = 0;
    }
  }

  state.blockedReason = computed.blockedReason;
  state.degradedReasons = computed.degradedReasons;

  writeVenueState(state);
  return state;
}

// ---------------------------------------------------------------------------
//  Convenience helpers (for gwi-node.sh bash integration via node -e)
// ---------------------------------------------------------------------------

/**
 * Mark a component as converged at a given version.
 */
export function markConverged(componentName: ComponentName, version: string): VenueState {
  return updateComponentState(componentName, {
    currentVersion: version,
    targetVersion: version,
    status: 'converged',
    lastAttemptAt: now(),
    error: null,
  });
}

/**
 * Mark a component as failed with an error message.
 */
export function markFailed(componentName: ComponentName, error: string): VenueState {
  const state = readVenueState();
  const component = state.components[componentName];
  return updateComponentState(componentName, {
    status: 'failed',
    lastAttemptAt: now(),
    attemptCount: component.attemptCount + 1,
    error,
  });
}

/**
 * Mark a component as actively converging (update in progress).
 */
export function markConverging(componentName: ComponentName, targetVersion: string): VenueState {
  return updateComponentState(componentName, {
    targetVersion,
    status: 'behind',
    lastAttemptAt: now(),
  });
}

/**
 * Check if the venue is in a terminal failure state.
 */
export function isBlocked(state?: VenueState): boolean {
  const s = state ?? readVenueState();
  return s.lifecycleState === 'BLOCKED' || s.lifecycleState === 'RECOVERY_REQUIRED';
}

/**
 * Get a human-readable summary of the venue state.
 */
export function getSummary(state?: VenueState): string {
  const s = state ?? readVenueState();
  const lines: string[] = [
    `Lifecycle: ${s.lifecycleState}`,
    `Last converged: ${s.lastConvergedAt ?? 'never'}`,
    `Last state change: ${s.lastStateChangeAt}`,
    `Convergence attempts: ${s.convergenceAttempts}`,
  ];

  if (s.blockedReason) {
    lines.push(`BLOCKED: ${s.blockedReason}`);
  }

  if (s.degradedReasons.length > 0) {
    lines.push('Degraded reasons:');
    for (const r of s.degradedReasons) {
      lines.push(`  - ${r}`);
    }
  }

  lines.push('');
  lines.push('Components:');
  for (const key of ['server', 'schema', 'dashboard', 'baseline'] as const) {
    const c = s.components[key];
    const convergedLabel = c.lastConvergedAt ? ` (converged: ${c.lastConvergedAt})` : '';
    lines.push(
      `  ${c.name}: ${c.status} current=${c.currentVersion} target=${c.targetVersion}${convergedLabel}`
    );
    if (c.error) {
      lines.push(`    error: ${c.error} (attempts: ${c.attemptCount})`);
    }
  }

  return lines.join('\n');
}

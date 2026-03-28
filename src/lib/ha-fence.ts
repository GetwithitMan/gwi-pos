/**
 * Persistent HA Fence State (STONITH-lite)
 *
 * Disk-backed fence state that survives process restarts.
 * When a node is fenced, it refuses all mutating (non-GET) requests
 * to prevent split-brain writes during MC-arbitrated failover.
 *
 * File location: /opt/gwi-pos/shared/state/fenced.json
 *
 * Design: The disk file is the source of truth. An in-memory cache
 * (5s TTL) avoids reading disk on every proxy request. On cache miss,
 * we re-read from disk synchronously (acceptable — file is tiny).
 *
 * Fail-open: If the fence file is corrupted or unreadable, the node
 * is NOT fenced. A disk error permanently bricking a node is worse
 * than briefly serving on a fenced node.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const FENCE_FILE = join(
  process.env.APP_BASE || '/opt/gwi-pos',
  'shared',
  'state',
  'fenced.json'
)

const CACHE_TTL_MS = 5000 // re-read from disk every 5s

let _cachedState: FenceState | null = null
let _cachedAt = 0

export interface FenceState {
  fenced: true
  fencedAt: string // ISO timestamp
  fencedBy: string // who requested (fleet command ID or "manual")
  reason: string // why
  previousRole: string // STATION_ROLE before fencing
}

/**
 * Check whether this node is currently fenced.
 * Uses a 5s disk-read cache for performance.
 * Returns false on any error (fail-open).
 */
export function isFenced(): boolean {
  const now = Date.now()
  if (_cachedState !== null && now - _cachedAt < CACHE_TTL_MS) {
    return _cachedState.fenced === true
  }

  try {
    if (!existsSync(FENCE_FILE)) {
      _cachedState = null
      _cachedAt = now
      return false
    }
    const data = JSON.parse(readFileSync(FENCE_FILE, 'utf8'))
    if (data && data.fenced === true) {
      _cachedState = data
      _cachedAt = now
      return true
    }
    // File exists but fenced !== true (cleared fence)
    _cachedState = null
    _cachedAt = now
    return false
  } catch {
    // Fail open — corrupted file should not brick the node
    _cachedState = null
    _cachedAt = now
    return false
  }
}

/**
 * Get the full fence state (or null if not fenced).
 * Refreshes the cache via isFenced().
 */
export function getFenceState(): FenceState | null {
  isFenced() // refresh cache
  return _cachedState
}

/**
 * Persist a fence to disk and set in-memory state.
 * Creates the state directory if it doesn't exist.
 * Also sets process.env.STATION_ROLE = 'fenced' for backward compatibility.
 */
export function fence(options: { by: string; reason: string }): void {
  const state: FenceState = {
    fenced: true,
    fencedAt: new Date().toISOString(),
    fencedBy: options.by,
    reason: options.reason,
    previousRole: process.env.STATION_ROLE || 'unknown',
  }

  const dir = dirname(FENCE_FILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(FENCE_FILE, JSON.stringify(state, null, 2))

  _cachedState = state
  _cachedAt = Date.now()

  // Also set in-memory for backward compatibility with code that reads process.env
  process.env.STATION_ROLE = 'fenced'
}

/**
 * Remove the fence: delete the fence file and restore the previous role.
 * If the fence file recorded a previousRole, restore it to process.env.
 * Otherwise falls back to reading STATION_ROLE from the .env file on disk.
 */
export function unfence(): void {
  let restoredRole = 'backup'

  try {
    if (existsSync(FENCE_FILE)) {
      const raw = readFileSync(FENCE_FILE, 'utf8')
      const state = JSON.parse(raw)
      if (state.previousRole && state.previousRole !== 'fenced' && state.previousRole !== 'unknown') {
        restoredRole = state.previousRole
      }
    }
  } catch {
    // If we can't read the old state, default to 'backup'
  }

  // Overwrite fence file with fenced=false (safer than deleting — avoids TOCTOU)
  try {
    writeFileSync(FENCE_FILE, JSON.stringify({ fenced: false }, null, 2))
  } catch {
    // ignore — state dir may not exist (shouldn't happen if fence() was called)
  }

  _cachedState = null
  _cachedAt = Date.now()

  // Restore the process.env role
  process.env.STATION_ROLE = restoredRole
}

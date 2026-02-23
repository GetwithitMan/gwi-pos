/**
 * Server-side floor plan snapshot cache.
 *
 * Caches the full snapshot response per locationId to avoid
 * 4 parallel DB queries on every request from every terminal.
 *
 * TTL: 5 seconds — short enough for order/status changes to appear quickly,
 * long enough to collapse 50 terminals polling simultaneously into 1 query.
 *
 * Invalidation: Called automatically from dispatchFloorPlanUpdate()
 * which fires on every table/section create, update, delete, and move.
 */

import type { SnapshotResult } from '@/lib/snapshot'

interface SnapshotCacheEntry {
  data: SnapshotResult
  timestamp: number
}

const cache = new Map<string, SnapshotCacheEntry>()

/** Cache TTL in milliseconds (5 seconds) */
const CACHE_TTL = 5 * 1000

/**
 * Get cached snapshot if still fresh
 */
export function getSnapshotCache(locationId: string): SnapshotResult | null {
  const entry = cache.get(locationId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(locationId)
    return null
  }
  return entry.data
}

/**
 * Store snapshot in cache
 */
export function setSnapshotCache(locationId: string, data: SnapshotResult): void {
  cache.set(locationId, { data, timestamp: Date.now() })
}

/**
 * Invalidate snapshot cache for a location.
 * Called from dispatchFloorPlanUpdate() on every table/section mutation.
 */
export function invalidateSnapshotCache(locationId: string): void {
  cache.delete(locationId)
}

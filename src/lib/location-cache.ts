/**
 * Location Settings Cache
 *
 * In-memory cache for location settings to avoid redundant database queries.
 * FIX-009: Eliminates repeated location.findUnique() calls for tax rate lookup.
 *
 * Cache invalidation:
 * - TTL: 5 minutes (settings don't change frequently)
 * - Manual: Call invalidate() when settings are updated
 */

import { db } from '@/lib/db'

// ============================================================================
// TYPES
// ============================================================================

export interface LocationSettings {
  tax?: {
    defaultRate?: number
  }
  [key: string]: unknown
}

interface CacheEntry {
  settings: LocationSettings | null
  timestamp: number
}

// ============================================================================
// CACHE
// ============================================================================

/**
 * In-memory cache for location settings
 * Map<locationId, CacheEntry>
 */
const cache = new Map<string, CacheEntry>()

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL = 5 * 60 * 1000

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get location settings with caching
 *
 * @param locationId - Location ID to fetch settings for
 * @returns Location settings or null if not found
 *
 * Example:
 *   const settings = await getLocationSettings(locationId)
 *   const taxRate = (settings?.tax?.defaultRate || 8) / 100
 */
export async function getLocationSettings(
  locationId: string
): Promise<LocationSettings | null> {
  // Check cache first
  const cached = cache.get(locationId)
  const now = Date.now()

  // Return cached value if still valid
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.settings
  }

  // Cache miss or expired - fetch from database
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  const settings = (location?.settings || null) as LocationSettings | null

  // Store in cache
  cache.set(locationId, {
    settings,
    timestamp: now,
  })

  return settings
}

/**
 * Invalidate cache for a specific location
 *
 * Call this when location settings are updated:
 *   await updateLocationSettings(locationId, newSettings)
 *   invalidateLocationCache(locationId)
 */
export function invalidateLocationCache(locationId: string): void {
  cache.delete(locationId)
}

/**
 * Invalidate entire cache
 *
 * Call this on deployment or after bulk settings updates
 */
export function invalidateAllLocationCaches(): void {
  cache.clear()
}

/**
 * Get cache statistics (for monitoring)
 */
export function getCacheStats() {
  const now = Date.now()
  const entries = Array.from(cache.entries())

  return {
    size: cache.size,
    entries: entries.map(([locationId, entry]) => ({
      locationId,
      age: Math.round((now - entry.timestamp) / 1000), // seconds
      isExpired: (now - entry.timestamp) >= CACHE_TTL,
    })),
  }
}

// ============================================================================
// CACHE WARMING (OPTIONAL)
// ============================================================================

/**
 * Pre-warm cache with location settings
 *
 * Call this on server startup to populate cache:
 *   await warmLocationCache([locationId1, locationId2])
 */
export async function warmLocationCache(locationIds: string[]): Promise<void> {
  const locations = await db.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, settings: true },
  })

  const now = Date.now()
  for (const location of locations) {
    cache.set(location.id, {
      settings: (location.settings || null) as LocationSettings | null,
      timestamp: now,
    })
  }
}

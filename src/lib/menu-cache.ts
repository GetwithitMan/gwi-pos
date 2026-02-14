/**
 * Server-side menu data cache.
 *
 * Caches the full menu response per locationId to avoid
 * expensive DB queries on every request (3 queries + heavy mapping).
 *
 * TTL: 60 seconds (menu data changes infrequently during service).
 * Invalidation: Call invalidateMenuCache() from menu CRUD routes.
 *
 * Volatile fields like entertainment status and 86 status are
 * patched client-side via socket events — the cache only needs
 * to be accurate at initial page load.
 */

interface MenuCacheEntry {
  data: unknown
  timestamp: number
}

const cache = new Map<string, MenuCacheEntry>()

/** Cache TTL in milliseconds (15 seconds — short enough for cross-process changes from cloud admin to appear quickly on NUC) */
const CACHE_TTL = 15 * 1000

/**
 * Build a cache key from location + optional filter params
 */
export function buildMenuCacheKey(
  locationId: string,
  categoryType?: string | null,
  categoryShow?: string | null
): string {
  return `${locationId}:${categoryType || ''}:${categoryShow || ''}`
}

/**
 * Get cached menu data if still fresh
 */
export function getMenuCache(cacheKey: string): unknown | null {
  const entry = cache.get(cacheKey)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(cacheKey)
    return null
  }
  return entry.data
}

/**
 * Store menu data in cache
 */
export function setMenuCache(cacheKey: string, data: unknown): void {
  cache.set(cacheKey, { data, timestamp: Date.now() })
}

/**
 * Invalidate all cache entries for a location.
 * Call this when menu items, categories, or modifiers change.
 */
export function invalidateMenuCache(locationId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(locationId)) {
      cache.delete(key)
    }
  }
}

/**
 * Invalidate entire menu cache (all locations).
 * Call this on deployment or bulk updates.
 */
export function invalidateAllMenuCaches(): void {
  cache.clear()
}

/**
 * Get cache statistics (for monitoring/debugging)
 */
export function getMenuCacheStats() {
  const now = Date.now()
  return {
    size: cache.size,
    entries: Array.from(cache.entries()).map(([key, entry]) => ({
      key,
      ageSeconds: Math.round((now - entry.timestamp) / 1000),
      isExpired: (now - entry.timestamp) >= CACHE_TTL,
    })),
  }
}

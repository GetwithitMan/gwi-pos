/**
 * Server-side open-orders response cache.
 *
 * Android registers poll every 60s + on socket events. Most calls return
 * identical data. A 5s TTL eliminates redundant DB work while socket-driven
 * invalidation keeps the cache fresh on mutations.
 *
 * Extracted from orders/open/route.ts so it can be imported by both the
 * route handler and socket dispatch without violating Next.js route module
 * export constraints (only route handlers and `config` may be exported).
 */

const openOrdersCache = new Map<string, { data: any; timestamp: number }>()

export const OPEN_ORDERS_CACHE_TTL = 5_000 // 5 seconds

/** Clear cached open-orders responses for a given location (called on mutations). */
export function invalidateOpenOrdersCache(locationId: string) {
  for (const key of openOrdersCache.keys()) {
    if (key.startsWith(locationId + ':')) {
      openOrdersCache.delete(key)
    }
  }
}

/** Get a cached entry if it exists. */
export function getOpenOrdersCacheEntry(key: string): { data: any; timestamp: number } | undefined {
  return openOrdersCache.get(key)
}

/** Store a response in the cache. */
export function setOpenOrdersCacheEntry(key: string, data: any): void {
  openOrdersCache.set(key, { data, timestamp: Date.now() })
}

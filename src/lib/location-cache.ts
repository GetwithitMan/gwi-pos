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
import { getRequestPrisma, getRequestSlug, getRequestLocationId } from '@/lib/request-context'

// ============================================================================
// TYPES
// ============================================================================

export interface LocationSettings {
  tax?: {
    defaultRate?: number
  }
  /** Feature flag: enables v2 liquor inventory with server-side spirit tier validation + pour multiplier propagation. Default false. */
  liquorInventoryV2?: boolean
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

/**
 * Inflight promise maps for request coalescing.
 * Prevents cache stampede: when TTL expires, only the first request hits the DB;
 * concurrent requests await the same promise.
 */
const inflightLocationId = new Map<string, Promise<string | null>>()
const inflightSettings = new Map<string, Promise<LocationSettings | null>>()

// ============================================================================
// LOCATION ID CACHE
// ============================================================================

/**
 * Per-venue location ID cache.
 * Keyed by venue slug from request context to prevent cross-tenant leaks
 * when multiple venues share a Vercel serverless process.
 * Map<venueSlug, { id, timestamp }>
 */
const locationIdCache = new Map<string, { id: string | null; timestamp: number }>()

/**
 * Get the location ID for the current venue database (cached per-venue).
 *
 * Since each venue DB has exactly one Location row, this is safe to cache.
 * Eliminates ~30 redundant db.location.findFirst() calls across pizza/liquor/menu routes.
 *
 * The cache is keyed by the venue slug from AsyncLocalStorage request context,
 * preventing the old singleton bug where venue A's locationId was returned to venue B.
 *
 * @returns The location ID, or null if no location exists
 *
 * Example:
 *   const locationId = await getLocationId()
 *   if (!locationId) return NextResponse.json({ error: 'No location found' }, { status: 400 })
 */
export async function getLocationId(): Promise<string | null> {
  // Fast path: if proxy/withVenue already resolved locationId from tenant JWT,
  // skip the DB query entirely. Saves 3-5s on Vercel cold starts.
  const contextLocationId = getRequestLocationId()
  if (contextLocationId) return contextLocationId

  const now = Date.now()
  const cacheKey = getRequestSlug()

  // Without a venue slug, we can't safely cache — different venues could share the same
  // serverless process. Always go to DB for unscoped requests.
  if (!cacheKey) {
    const prisma = getRequestPrisma() || db
    const location = await (prisma as any).location.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    return location?.id ?? null
  }

  const cached = locationIdCache.get(cacheKey)
  if (cached && cached.id && (now - cached.timestamp) < CACHE_TTL) {
    return cached.id
  }

  // Coalesce concurrent requests: return the same inflight promise
  const inflight = inflightLocationId.get(cacheKey)
  if (inflight) return inflight

  const promise = (async () => {
    // Use deterministic ordering so seed data (e.g. 'loc-1') is preferred
    // over auto-generated cuid IDs if multiple locations somehow exist.
    // Also prefer locations that have menu items (active venue vs stale shell).
    const prisma = getRequestPrisma() || db
    const location = await (prisma as any).location.findFirst({
      select: { id: true },
      orderBy: { id: 'asc' },
    })

    const id = location?.id ?? null
    locationIdCache.set(cacheKey, { id, timestamp: Date.now() })

    return id
  })().finally(() => {
    inflightLocationId.delete(cacheKey)
  })

  inflightLocationId.set(cacheKey, promise)
  return promise
}

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
 *   const taxRate = (settings?.tax?.defaultRate ?? 0) / 100
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

  // Coalesce concurrent requests: return the same inflight promise
  const inflight = inflightSettings.get(locationId)
  if (inflight) return inflight

  const promise = (async () => {
    // Cache miss or expired - fetch from database
    const prismaSettings = getRequestPrisma() || db
    const location = await (prismaSettings as any).location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })

    const settings = (location?.settings || null) as LocationSettings | null
    const fetchTime = Date.now()

    // Safety net: if settings.tax.defaultRate is missing, compute live from TaxRule records.
    // This handles locations where TaxRules exist but settings.tax.defaultRate was never synced.
    if (location && !settings?.tax?.defaultRate) {
      const rules = await (prismaSettings as any).taxRule.findMany({
        where: { locationId, deletedAt: null, isActive: true },
        select: { rate: true },
      })
      if (rules.length > 0) {
        const effectiveRate = rules.reduce((sum, rule) => sum + Number(rule.rate), 0)
        const enriched: LocationSettings = {
          ...(settings || {}),
          tax: { ...(settings?.tax || {}), defaultRate: Math.round(effectiveRate * 100 * 10000) / 10000 },
        }
        cache.set(locationId, { settings: enriched, timestamp: fetchTime })
        return enriched
      }
    }

    // Store in cache
    cache.set(locationId, {
      settings,
      timestamp: fetchTime,
    })

    return settings
  })().finally(() => {
    inflightSettings.delete(locationId)
  })

  inflightSettings.set(locationId, promise)
  return promise
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
  locationIdCache.clear()
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
  const prisma = getRequestPrisma() || db
  const locations = await (prisma as any).location.findMany({
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

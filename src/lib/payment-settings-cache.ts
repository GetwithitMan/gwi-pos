/**
 * Payment Settings Cache
 *
 * In-memory cache for payment-related location settings to avoid redundant
 * database queries during rush periods. Every card tap, pre-auth, auto-increment,
 * and capture goes through getDatacapClient() which previously hit the DB each time.
 *
 * Cache invalidation:
 * - TTL: 5 minutes (payment settings don't change during a shift)
 * - Manual: Call invalidatePaymentSettings() when settings are updated
 *   (from PUT /api/settings and PUT /api/payment-config)
 */

import { db } from '@/lib/db'

// ============================================================================
// TYPES
// ============================================================================

interface CacheEntry {
  settings: unknown  // Raw Location.settings JSON — parsed by caller via parseSettings()
  timestamp: number
}

// ============================================================================
// CACHE
// ============================================================================

/**
 * In-memory cache for location payment settings
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
 * Get location settings for payment flows (cached).
 *
 * Returns the raw Location.settings JSON — callers use parseSettings() to
 * extract typed PaymentSettings. This avoids double-parsing and keeps the
 * cache layer thin.
 *
 * @param locationId - Location ID to fetch settings for
 * @returns Raw settings JSON or null if location not found
 *
 * Example:
 *   const raw = await getPaymentSettingsCached(locationId)
 *   if (!raw) throw new Error('Location not found')
 *   const settings = parseSettings(raw)
 *   const payments = settings.payments
 */
export async function getPaymentSettingsCached(
  locationId: string
): Promise<unknown | null> {
  const cached = cache.get(locationId)
  const now = Date.now()

  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.settings
  }

  // Cache miss or expired — fetch from database
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  if (!location) return null

  cache.set(locationId, {
    settings: location.settings,
    timestamp: now,
  })

  return location.settings
}

/**
 * Invalidate cache for a specific location.
 *
 * Call this when payment settings are updated:
 *   - PUT /api/settings (general settings update)
 *   - PUT /api/payment-config (MC fleet command)
 */
export function invalidatePaymentSettings(locationId: string): void {
  cache.delete(locationId)
}

/**
 * Invalidate entire cache.
 *
 * Call this on deployment or after bulk settings updates.
 */
export function invalidateAllPaymentSettings(): void {
  cache.clear()
}

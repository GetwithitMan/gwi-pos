/**
 * In-memory rate limiter for public online ordering endpoints.
 *
 * Simple sliding-window counter keyed by IP + locationId.
 * Designed for local POS servers (single process, in-memory is fine).
 *
 * Limits:
 *   - checkout: 10 requests / minute per IP+location
 *   - menu:     30 requests / minute per IP+location
 */

interface RateLimitEntry {
  count: number
  resetAt: number // timestamp ms
}

const WINDOW_MS = 60 * 1000 // 1-minute window

const LIMITS: Record<string, number> = {
  checkout: 10,
  menu: 30,
}

const rateLimitMap = new Map<string, RateLimitEntry>()

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // Clean up every 5 minutes

/**
 * Check whether a request is allowed under the rate limit.
 *
 * @param ip         Client IP address
 * @param locationId Venue location ID
 * @param endpoint   Which endpoint ('checkout' | 'menu')
 * @returns { allowed, retryAfterSeconds? }
 */
export function checkOnlineRateLimit(
  ip: string,
  locationId: string,
  endpoint: 'checkout' | 'menu' = 'checkout'
): { allowed: boolean; retryAfterSeconds?: number } {
  const key = `${endpoint}:${ip}:${locationId}`
  const now = Date.now()
  const maxRequests = LIMITS[endpoint] ?? 10

  let entry = rateLimitMap.get(key)

  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + WINDOW_MS }
    rateLimitMap.set(key, entry)
    return { allowed: true }
  }

  entry.count++

  if (entry.count > maxRequests) {
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  return { allowed: true }
}

// Periodic cleanup to prevent unbounded memory growth
function cleanupStaleEntries(): void {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(key)
    }
  }
}

if (typeof globalThis !== 'undefined') {
  const timer = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL_MS)
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}

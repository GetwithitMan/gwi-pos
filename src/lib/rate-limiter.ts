/**
 * Generic in-memory rate limiter factory.
 *
 * Designed for local POS servers (single process — Map-based is fine).
 * Each limiter instance tracks attempts per key within a sliding window.
 * Stale entries are cleaned up automatically via periodic sweep.
 *
 * Usage:
 *   const limiter = createRateLimiter({ maxAttempts: 10, windowMs: 15 * 60 * 1000 })
 *   const result = limiter.check('some-key')
 *   if (!result.allowed) { return 429 with Retry-After: result.retryAfter }
 */

interface RateLimitBucket {
  attempts: number
  windowStart: number // timestamp ms
}

interface RateLimiterOptions {
  /** Maximum attempts allowed within the window */
  maxAttempts: number
  /** Time window in milliseconds */
  windowMs: number
  /** How often to sweep stale entries (default: 60s) */
  cleanupIntervalMs?: number
}

interface RateLimitResult {
  allowed: boolean
  /** Seconds until the window resets (only set when blocked) */
  retryAfter?: number
  /** Remaining attempts in current window */
  remaining: number
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { maxAttempts, windowMs, cleanupIntervalMs = 60_000 } = options
  const buckets = new Map<string, RateLimitBucket>()

  // Periodic cleanup of expired windows
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs) {
        buckets.delete(key)
      }
    }
  }, cleanupIntervalMs)

  // Allow process to exit without waiting for this timer
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    (timer as NodeJS.Timeout).unref()
  }

  return {
    /**
     * Check if a request is allowed for the given key.
     * Increments the attempt counter on each call.
     */
    check(key: string): RateLimitResult {
      const now = Date.now()
      let bucket = buckets.get(key)

      // Window expired — reset
      if (bucket && now - bucket.windowStart > windowMs) {
        buckets.delete(key)
        bucket = undefined
      }

      if (!bucket) {
        bucket = { attempts: 0, windowStart: now }
        buckets.set(key, bucket)
      }

      bucket.attempts++

      if (bucket.attempts > maxAttempts) {
        const retryAfter = Math.ceil((bucket.windowStart + windowMs - now) / 1000)
        return {
          allowed: false,
          retryAfter: Math.max(retryAfter, 1),
          remaining: 0,
        }
      }

      return {
        allowed: true,
        remaining: maxAttempts - bucket.attempts,
      }
    },

    /** Reset the counter for a key (e.g., on successful auth) */
    reset(key: string): void {
      buckets.delete(key)
    },

    /** Get current count without incrementing */
    peek(key: string): { attempts: number; remaining: number } {
      const now = Date.now()
      const bucket = buckets.get(key)
      if (!bucket || now - bucket.windowStart > windowMs) {
        return { attempts: 0, remaining: maxAttempts }
      }
      return {
        attempts: bucket.attempts,
        remaining: Math.max(0, maxAttempts - bucket.attempts),
      }
    },
  }
}

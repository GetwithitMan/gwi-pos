/**
 * Centralized Rate Limiting
 *
 * In-memory sliding window with configurable scopes.
 * On NUC (single-process), this is sufficient.
 * For Vercel/multi-instance, upgrade to Redis-backed.
 *
 * Replaces the scattered per-route rate limiters:
 *   - src/lib/auth-rate-limiter.ts (PIN/password lockout — kept for lockout semantics)
 *   - src/lib/online-rate-limiter.ts (online ordering)
 *   - inline rate limiters in public/orders, public/pay, verify-pin, etc.
 *
 * Usage:
 *   // Wrap an entire handler:
 *   export const POST = withRateLimit(RATE_LIMITS.PUBLIC_API, async (req) => { ... })
 *
 *   // Or check inline for more control:
 *   const result = checkRateLimit('public-orders', RATE_LIMITS.PUBLIC_API, extractKey(req, 'ip'))
 *   if (!result.allowed) return NextResponse.json({ error: result.message }, { status: 429, headers: { 'Retry-After': ... } })
 */

import { NextRequest, NextResponse } from 'next/server'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Time window in ms */
  windowMs: number
  /** Max requests allowed per window */
  maxRequests: number
  /** What to key the rate limit on */
  scope: 'ip' | 'employee' | 'terminal' | 'venue' | 'global'
  /** Custom error message returned in 429 response */
  message?: string
}

interface SlidingWindowEntry {
  /** Timestamps of requests within the current window */
  timestamps: number[]
}

interface RateLimitResult {
  allowed: boolean
  /** Seconds until the rate limit resets (only present when blocked) */
  retryAfterSeconds?: number
  /** Human-readable message (only present when blocked) */
  message?: string
}

// ── Presets ───────────────────────────────────────────────────────────────────

export const RATE_LIMITS = {
  /** PIN login: 5 attempts per minute per IP */
  AUTH_PIN: {
    windowMs: 60_000,
    maxRequests: 5,
    scope: 'ip' as const,
    message: 'Too many login attempts. Please wait before trying again.',
  },

  /** Password login: 10 attempts per 5 minutes per IP */
  AUTH_PASSWORD: {
    windowMs: 300_000,
    maxRequests: 10,
    scope: 'ip' as const,
    message: 'Too many login attempts. Please wait before trying again.',
  },

  /** Payment endpoints: 20 per minute per terminal */
  PAYMENT: {
    windowMs: 60_000,
    maxRequests: 20,
    scope: 'terminal' as const,
    message: 'Too many payment requests. Please wait.',
  },

  /** Public API (QR orders, menu, etc.): 10 per minute per IP */
  PUBLIC_API: {
    windowMs: 60_000,
    maxRequests: 10,
    scope: 'ip' as const,
    message: 'Too many requests. Please try again later.',
  },

  /** Public order submission: 5 per minute per IP (stricter) */
  PUBLIC_ORDER: {
    windowMs: 60_000,
    maxRequests: 5,
    scope: 'ip' as const,
    message: 'Too many orders. Please wait a minute before trying again.',
  },

  /** Public payment page GET: 10 per minute per IP */
  PUBLIC_PAY_READ: {
    windowMs: 60_000,
    maxRequests: 10,
    scope: 'ip' as const,
    message: 'Too many requests. Please try again later.',
  },

  /** Public payment page POST: 5 per minute per IP */
  PUBLIC_PAY_SUBMIT: {
    windowMs: 60_000,
    maxRequests: 5,
    scope: 'ip' as const,
    message: 'Too many payment attempts. Please wait and try again.',
  },

  /** Mutation endpoints: 30 per second per venue */
  MUTATION: {
    windowMs: 1_000,
    maxRequests: 30,
    scope: 'venue' as const,
    message: 'Request rate exceeded. Please try again.',
  },

  /** Report generation: 5 per 10 seconds per employee */
  REPORT: {
    windowMs: 10_000,
    maxRequests: 5,
    scope: 'employee' as const,
    message: 'Too many report requests. Please wait.',
  },
} as const

// ── Storage ───────────────────────────────────────────────────────────────────

/**
 * Two-level map: namespace -> key -> sliding window entry.
 * Namespace isolates different rate limit contexts (e.g. 'auth-login' vs 'public-orders')
 * so that hitting one limit doesn't count against another.
 */
const store = new Map<string, Map<string, SlidingWindowEntry>>()

function getNamespaceMap(namespace: string): Map<string, SlidingWindowEntry> {
  let nsMap = store.get(namespace)
  if (!nsMap) {
    nsMap = new Map()
    store.set(namespace, nsMap)
  }
  return nsMap
}

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Extract the rate limit key from a request based on scope.
 */
export function extractKey(request: NextRequest, scope: RateLimitConfig['scope']): string {
  switch (scope) {
    case 'ip':
      return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || 'unknown'

    case 'terminal':
      return request.headers.get('x-terminal-id')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown'

    case 'employee':
      // Employee ID typically comes from session/auth context.
      // Fall back to IP if not available at middleware level.
      return request.headers.get('x-employee-id')
        || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || 'unknown'

    case 'venue':
      return request.headers.get('x-venue-slug')
        || 'default'

    case 'global':
      return 'global'

    default:
      return 'unknown'
  }
}

/**
 * Check whether a request is allowed under the rate limit.
 * Uses a sliding window algorithm: only timestamps within the window are counted.
 *
 * @param namespace  Unique identifier for this rate limit context (e.g. 'auth-login', 'public-orders')
 * @param config     Rate limit configuration
 * @param key        The scoped key (IP, terminal ID, etc.)
 * @returns          { allowed, retryAfterSeconds?, message? }
 */
export function checkRateLimit(
  namespace: string,
  config: RateLimitConfig,
  key: string
): RateLimitResult {
  const now = Date.now()
  const nsMap = getNamespaceMap(namespace)
  let entry = nsMap.get(key)

  if (!entry) {
    entry = { timestamps: [now] }
    nsMap.set(key, entry)
    return { allowed: true }
  }

  // Evict timestamps outside the window
  const windowStart = now - config.windowMs
  entry.timestamps = entry.timestamps.filter(ts => ts > windowStart)

  if (entry.timestamps.length >= config.maxRequests) {
    // Find when the oldest timestamp in the window will expire
    const oldestInWindow = entry.timestamps[0]
    const retryAfterMs = oldestInWindow + config.windowMs - now
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))

    return {
      allowed: false,
      retryAfterSeconds,
      message: config.message || 'Too many requests',
    }
  }

  // Record this request
  entry.timestamps.push(now)
  return { allowed: true }
}

/**
 * Reset rate limit state for a given namespace + key.
 * Useful on successful login to clear failed attempt counters.
 */
export function resetRateLimit(namespace: string, key: string): void {
  const nsMap = store.get(namespace)
  if (nsMap) {
    nsMap.delete(key)
  }
}

// ── Middleware Wrapper ────────────────────────────────────────────────────────

/**
 * Wrap a Next.js API route handler with rate limiting.
 * Returns 429 with Retry-After header if limit is exceeded.
 *
 * @param namespace  Unique identifier for this rate limit context
 * @param config     Rate limit configuration
 * @param handler    The route handler to wrap
 *
 * @example
 *   export const POST = withRateLimit('public-orders', RATE_LIMITS.PUBLIC_ORDER,
 *     async (request: NextRequest) => {
 *       // handler code
 *     }
 *   )
 */
export function withRateLimit<
  T extends (request: NextRequest, context?: any) => Promise<NextResponse>
>(
  namespace: string,
  config: RateLimitConfig,
  handler: T
): T {
  const wrapped = async (request: NextRequest, context?: any): Promise<NextResponse> => {
    const key = extractKey(request, config.scope)
    const result = checkRateLimit(namespace, config, key)

    if (!result.allowed) {
      return NextResponse.json(
        { error: result.message },
        {
          status: 429,
          headers: {
            'Retry-After': String(result.retryAfterSeconds),
          },
        }
      )
    }

    return handler(request, context)
  }

  return wrapped as T
}

// ── Periodic Cleanup ──────────────────────────────────────────────────────────

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

function cleanupStaleEntries(): void {
  const now = Date.now()

  const STALE_THRESHOLD_MS = 10 * 60 * 1000

  store.forEach((nsMap, namespace) => {
    nsMap.forEach((entry, key) => {
      // Remove entries where all timestamps are older than the longest possible window.
      const newestTimestamp = entry.timestamps.length > 0
        ? entry.timestamps[entry.timestamps.length - 1]
        : 0

      if (now - newestTimestamp > STALE_THRESHOLD_MS) {
        nsMap.delete(key)
      }
    })

    // Remove empty namespace maps
    if (nsMap.size === 0) {
      store.delete(namespace)
    }
  })
}

// Start cleanup interval (only runs server-side)
if (typeof globalThis !== 'undefined') {
  const timer = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL_MS)
  // Allow process to exit without waiting for this timer
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}

// ── Test Helpers ──────────────────────────────────────────────────────────────

/** Clear all rate limit state. Only for use in tests. */
export function _resetAllForTesting(): void {
  store.clear()
}

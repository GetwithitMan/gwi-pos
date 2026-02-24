/**
 * In-memory rate limiter for PIN login attempts.
 *
 * Two layers of protection:
 *   1. Per-IP: 10 failed attempts → 5-minute lockout
 *   2. Per-employee: 5 failed attempts → 60-second lockout
 *
 * Designed for local POS servers (single process, in-memory is fine).
 * TTL cleanup prevents unbounded growth.
 */

interface RateLimitEntry {
  failures: number
  lockedUntil: number | null // timestamp ms
  lastFailure: number // timestamp ms
}

const IP_MAX_FAILURES = 10
const IP_LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes

const EMPLOYEE_MAX_FAILURES = 5
const EMPLOYEE_LOCKOUT_MS = 60 * 1000 // 60 seconds

// Stale entries are cleaned up after 10 minutes of inactivity
const CLEANUP_INTERVAL_MS = 60 * 1000 // Check every minute
const STALE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes

const ipMap = new Map<string, RateLimitEntry>()
const employeeMap = new Map<string, RateLimitEntry>()

function getOrCreate(map: Map<string, RateLimitEntry>, key: string): RateLimitEntry {
  let entry = map.get(key)
  if (!entry) {
    entry = { failures: 0, lockedUntil: null, lastFailure: 0 }
    map.set(key, entry)
  }
  return entry
}

/**
 * Check if a login attempt is allowed. Returns remaining lockout seconds if blocked.
 */
export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  const now = Date.now()
  const ipEntry = getOrCreate(ipMap, ip)

  // Check IP lockout
  if (ipEntry.lockedUntil && now < ipEntry.lockedUntil) {
    const retryAfterSeconds = Math.ceil((ipEntry.lockedUntil - now) / 1000)
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`,
    }
  }

  // Clear expired IP lockout
  if (ipEntry.lockedUntil && now >= ipEntry.lockedUntil) {
    ipEntry.failures = 0
    ipEntry.lockedUntil = null
  }

  return { allowed: true }
}

/**
 * Check if a specific employee is locked out (called after PIN match attempt).
 */
export function checkEmployeeLockout(employeeId: string): { allowed: boolean; retryAfterSeconds?: number; reason?: string } {
  const now = Date.now()
  const entry = getOrCreate(employeeMap, employeeId)

  if (entry.lockedUntil && now < entry.lockedUntil) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000)
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Account temporarily locked. Try again in ${retryAfterSeconds} seconds.`,
    }
  }

  // Clear expired lockout
  if (entry.lockedUntil && now >= entry.lockedUntil) {
    entry.failures = 0
    entry.lockedUntil = null
  }

  return { allowed: true }
}

/**
 * Record a failed login attempt.
 * Call with employeeId=undefined if PIN didn't match any employee.
 */
export function recordLoginFailure(ip: string, employeeId?: string): void {
  const now = Date.now()

  // Track IP failures
  const ipEntry = getOrCreate(ipMap, ip)
  ipEntry.failures++
  ipEntry.lastFailure = now
  if (ipEntry.failures >= IP_MAX_FAILURES) {
    ipEntry.lockedUntil = now + IP_LOCKOUT_MS
  }

  // Track employee failures (if we know which employee was targeted)
  if (employeeId) {
    const empEntry = getOrCreate(employeeMap, employeeId)
    empEntry.failures++
    empEntry.lastFailure = now
    if (empEntry.failures >= EMPLOYEE_MAX_FAILURES) {
      empEntry.lockedUntil = now + EMPLOYEE_LOCKOUT_MS
    }
  }
}

/**
 * Clear rate limit state on successful login.
 */
export function recordLoginSuccess(ip: string, employeeId: string): void {
  ipMap.delete(ip)
  employeeMap.delete(employeeId)
}

// Periodic cleanup of stale entries to prevent memory leaks
function cleanupStaleEntries(): void {
  const now = Date.now()
  for (const [key, entry] of ipMap) {
    if (now - entry.lastFailure > STALE_THRESHOLD_MS && (!entry.lockedUntil || now > entry.lockedUntil)) {
      ipMap.delete(key)
    }
  }
  for (const [key, entry] of employeeMap) {
    if (now - entry.lastFailure > STALE_THRESHOLD_MS && (!entry.lockedUntil || now > entry.lockedUntil)) {
      employeeMap.delete(key)
    }
  }
}

// Start cleanup interval (only runs server-side)
if (typeof globalThis !== 'undefined') {
  const timer = setInterval(cleanupStaleEntries, CLEANUP_INTERVAL_MS)
  // Allow process to exit without waiting for this timer
  if (timer && typeof timer === 'object' && 'unref' in timer) {
    timer.unref()
  }
}

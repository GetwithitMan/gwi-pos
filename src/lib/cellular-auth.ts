/**
 * Cellular Terminal Authentication
 *
 * JWT-based auth for cellular (LTE/5G) terminals operating outside
 * the local network. Uses Web Crypto HMAC-SHA256 (edge-compatible).
 *
 * Key constraints:
 * - CELLULAR_ROAMING terminals can NEVER issue refunds (canRefund=false)
 * - Tokens use CELLULAR_TOKEN_SECRET (separate from cloud JWT secret)
 * - Idle timeout: 2 hours since last request → token expired
 * - In-memory deny list for fast revocation checks
 */

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type CellularTerminalRole = 'CELLULAR_ROAMING'

export interface CellularTokenPayload {
  sub: 'cellular-terminal'
  terminalId: string
  locationId: string
  deviceFingerprint: string
  canRefund: boolean
  terminalRole: CellularTerminalRole
  iat: number
  exp: number
}

// ═══════════════════════════════════════════════════════════
// In-memory caches (module-level singletons)
// ═══════════════════════════════════════════════════════════

/** Deny list: terminalId → revokedAt timestamp (ms) */
const denyList = new Map<string, number>()

/** Last request time per terminalId (for idle timeout) */
const lastActivity = new Map<string, number>()

/** Rate limit: terminalId → { count, windowStart } */
const rateLimitBuckets = new Map<string, { count: number; windowStart: number }>()

/** Idle timeout: 2 hours in milliseconds */
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000

/** Rate limit: max requests per second per terminal */
const RATE_LIMIT_PER_SECOND = 10

// ═══════════════════════════════════════════════════════════
// Base64url helpers (same pattern as cloud-auth.ts)
// ═══════════════════════════════════════════════════════════

function base64urlEncodeBytes(bytes: Uint8Array): string {
  const binary = Array.from(bytes).map((b) => String.fromCharCode(b)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ═══════════════════════════════════════════════════════════
// Core JWT operations (Web Crypto — edge-compatible)
// ═══════════════════════════════════════════════════════════

function getCellularSecret(): string {
  const secret = process.env.CELLULAR_TOKEN_SECRET
  if (!secret) throw new Error('[cellular-auth] CELLULAR_TOKEN_SECRET is not set')
  return secret
}

/**
 * Verify a cellular terminal JWT token.
 * Returns the payload if valid, null if invalid/expired/revoked.
 * No DB queries — all checks are in-memory for middleware speed.
 */
export async function verifyCellularToken(token: string): Promise<CellularTokenPayload | null> {
  try {
    const secret = getCellularSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify HMAC-SHA256 signature
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signature = base64urlDecode(signatureB64)
    const data = encoder.encode(`${headerB64}.${payloadB64}`)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      data
    )

    if (!valid) return null

    // Decode payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64))
    ) as CellularTokenPayload

    // Check expiry
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null

    // Validate required fields
    if (
      payload.sub !== 'cellular-terminal' ||
      !payload.terminalId ||
      !payload.locationId ||
      !payload.deviceFingerprint ||
      !payload.terminalRole
    ) {
      return null
    }

    // Check revocation deny list
    if (isRevoked(payload.terminalId)) return null

    return payload
  } catch {
    return null
  }
}

/**
 * Issue a new cellular terminal JWT.
 * CELLULAR_ROAMING terminals always get canRefund=false.
 */
export async function issueCellularToken(
  terminalId: string,
  locationId: string,
  deviceFingerprint: string,
  terminalRole: CellularTerminalRole
): Promise<string> {
  const secret = getCellularSecret()
  const now = Math.floor(Date.now() / 1000)

  const payload: CellularTokenPayload = {
    sub: 'cellular-terminal',
    terminalId,
    locationId,
    deviceFingerprint,
    canRefund: false, // HARD rule: CELLULAR_ROAMING can NEVER refund
    terminalRole,
    iat: now,
    exp: now + 24 * 60 * 60, // 24h expiry
  }

  const encoder = new TextEncoder()
  const headerB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify(payload)))

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${headerB64}.${payloadB64}`)
  )

  const signatureB64 = base64urlEncodeBytes(new Uint8Array(signatureBuffer))

  // Record activity on issuance
  lastActivity.set(terminalId, Date.now())

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Refresh a cellular token.
 * Verifies old token, checks not revoked, issues new token with fresh expiry.
 * Returns null if old token is invalid or revoked.
 */
export async function refreshCellularToken(oldToken: string): Promise<string | null> {
  const payload = await verifyCellularToken(oldToken)
  if (!payload) return null

  // Check idle timeout
  if (checkIdleTimeout(payload.terminalId)) return null

  // Re-check revocation (belt-and-suspenders with verify)
  if (isRevoked(payload.terminalId)) return null

  // TODO: attestation check placeholder (Play Integrity / device attestation)
  // When implemented: verify device attestation before issuing refresh

  return issueCellularToken(
    payload.terminalId,
    payload.locationId,
    payload.deviceFingerprint,
    payload.terminalRole
  )
}

// ═══════════════════════════════════════════════════════════
// Idle timeout
// ═══════════════════════════════════════════════════════════

/**
 * Check if a terminal has been idle too long (>2 hours).
 * Returns true if timed out (token should be rejected).
 */
export function checkIdleTimeout(terminalId: string): boolean {
  const last = lastActivity.get(terminalId)
  if (!last) return false // No activity recorded = first request, not idle
  return Date.now() - last > IDLE_TIMEOUT_MS
}

/**
 * Record activity for a terminal (called on every successful auth).
 */
export function recordActivity(terminalId: string): void {
  lastActivity.set(terminalId, Date.now())
}

// ═══════════════════════════════════════════════════════════
// Revocation deny list
// ═══════════════════════════════════════════════════════════

/** Check if a terminalId is on the deny list */
export function isRevoked(terminalId: string): boolean {
  return denyList.has(terminalId)
}

/** Revoke a terminal (add to deny list) */
export function revokeTerminal(terminalId: string): void {
  denyList.set(terminalId, Date.now())
}

/** Un-revoke a terminal (remove from deny list) */
export function unrevokeTerminal(terminalId: string): void {
  denyList.delete(terminalId)
}

/** Bulk update the deny list (called by periodic sync from DB/MC) */
export function syncDenyList(entries: Array<{ terminalId: string; revokedAt: number }>): void {
  denyList.clear()
  for (const entry of entries) {
    denyList.set(entry.terminalId, entry.revokedAt)
  }
}

// ═══════════════════════════════════════════════════════════
// Rate limiting (in-memory, 1-second sliding window)
// ═══════════════════════════════════════════════════════════

/**
 * Check rate limit for a terminal.
 * Returns true if request is allowed, false if rate limited.
 */
export function checkRateLimit(terminalId: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(terminalId)

  if (!bucket || now - bucket.windowStart > 1000) {
    // New window
    rateLimitBuckets.set(terminalId, { count: 1, windowStart: now })
    return true
  }

  bucket.count++
  if (bucket.count > RATE_LIMIT_PER_SECOND) {
    return false
  }

  return true
}

// ═══════════════════════════════════════════════════════════
// Cache cleanup (prevent unbounded memory growth)
// ═══════════════════════════════════════════════════════════

/** Clean up stale entries from in-memory caches. Call periodically. */
export function cleanupCaches(): void {
  const now = Date.now()
  const ONE_DAY = 24 * 60 * 60 * 1000

  // Evict deny list entries older than 7 days
  for (const [id, revokedAt] of denyList) {
    if (now - revokedAt > 7 * ONE_DAY) denyList.delete(id)
  }

  // Evict activity records older than idle timeout + buffer
  for (const [id, last] of lastActivity) {
    if (now - last > IDLE_TIMEOUT_MS + ONE_DAY) lastActivity.delete(id)
  }

  // Evict stale rate limit buckets
  for (const [id, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > 10_000) rateLimitBuckets.delete(id)
  }
}

// Run cleanup every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCaches, 10 * 60 * 1000)
}

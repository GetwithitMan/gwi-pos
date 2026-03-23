import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('cellular-auth')

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
  venueSlug: string
  deviceFingerprint: string
  canRefund: boolean
  terminalRole: CellularTerminalRole
  /** Bound employee ID — set when a specific employee logs in on the cellular terminal */
  employeeId: string | null
  /** Bound employee display name — for audit logging */
  employeeName: string | null
  iat: number
  exp: number
}

// ═══════════════════════════════════════════════════════════
// Active session tracking (for POS admin UI)
// ═══════════════════════════════════════════════════════════

export interface ActiveCellularSession {
  terminalId: string
  locationId: string
  deviceFingerprint: string
  venueSlug: string
  issuedAt: Date
  expiresAt: Date
  lastRequestAt: Date
}

/** In-memory registry of active cellular sessions (populated on token verify success) */
const activeSessions = new Map<string, ActiveCellularSession>()

/**
 * Get all active (non-expired) cellular sessions for a location.
 * Lazily cleans up expired entries on each call.
 */
export function getActiveCellularSessions(locationId: string): ActiveCellularSession[] {
  const now = Date.now()
  const results: ActiveCellularSession[] = []
  for (const [key, session] of activeSessions) {
    if (session.expiresAt.getTime() <= now) {
      activeSessions.delete(key)
      continue
    }
    if (session.locationId === locationId) {
      results.push(session)
    }
  }
  return results
}

/**
 * Get ALL cellular sessions for a location (including expired, excluding revoked).
 * Used by the admin page to show recently-expired devices.
 */
export function getAllCellularSessions(locationId: string): (ActiveCellularSession & { isExpired: boolean })[] {
  const now = Date.now()
  const results: (ActiveCellularSession & { isExpired: boolean })[] = []
  // Clean up sessions expired more than 24h ago
  const STALE_THRESHOLD = 24 * 60 * 60 * 1000
  for (const [key, session] of activeSessions) {
    if (now - session.expiresAt.getTime() > STALE_THRESHOLD) {
      activeSessions.delete(key)
      continue
    }
    if (session.locationId === locationId) {
      results.push({ ...session, isExpired: session.expiresAt.getTime() <= now })
    }
  }
  return results
}

/**
 * Remove a session from the active sessions registry (called on revocation).
 */
export function removeActiveSession(terminalId: string, deviceFingerprint: string): void {
  activeSessions.delete(`${terminalId}:${deviceFingerprint}`)
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

/**
 * Grace period for expired tokens: 4 hours.
 *
 * During an outage, Android workers (CartOutboxWorker, PaymentReconciliationWorker)
 * queue orders/payments locally. When connectivity returns, the JWT may have expired.
 * This grace window allows recently-expired tokens to be used for:
 *   1. Token refresh via /api/auth/refresh-cellular
 *   2. Replay-specific endpoints (with automatic token reissue via X-Refreshed-Token header)
 *
 * Security constraints:
 * - Signature MUST still be valid (HMAC-SHA256)
 * - Device MUST NOT be revoked/quarantined (both L1 + L2 checks)
 * - Device fingerprint MUST match
 * - Grace period is narrow (4h) — beyond this, device must re-pair
 */
const EXPIRED_GRACE_PERIOD_S = 4 * 60 * 60 // 4 hours in seconds

/** Rate limit: max requests per second per terminal */
const RATE_LIMIT_PER_SECOND = 10

/** Max size for rateLimitBuckets before evicting oldest entries */
const MAX_RATE_LIMIT_BUCKETS = 10_000

/** Max size for lastActivity map before evicting oldest 20% */
const MAX_ACTIVITY_ENTRIES = 5_000

/** File path for persisting activity timestamps across restarts */
const ACTIVITY_PERSIST_FILE = '/opt/gwi-pos/.cellular-activity.json'

/** Debounce file writes — only persist every 30 seconds */
let _lastPersistTime = 0
const PERSIST_INTERVAL_MS = 30_000

function persistActivityToFile(): void {
  const now = Date.now()
  if (now - _lastPersistTime < PERSIST_INTERVAL_MS) return
  _lastPersistTime = now
  try {
    const fs = require('node:fs')
    const data: Record<string, number> = {}
    for (const [id, ts] of lastActivity) {
      data[id] = ts
    }
    fs.writeFileSync(ACTIVITY_PERSIST_FILE, JSON.stringify(data), { mode: 0o600 })
  } catch { /* best-effort — don't block requests */ }
}

function loadPersistedActivity(): void {
  try {
    const fs = require('node:fs')
    const raw = fs.readFileSync(ACTIVITY_PERSIST_FILE, 'utf8') as string
    const data = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    for (const [id, ts] of Object.entries(data)) {
      if (typeof ts === 'number' && now - ts < IDLE_TIMEOUT_MS) {
        lastActivity.set(id, ts)
      }
    }
  } catch { /* file doesn't exist or corrupt — start fresh */ }
}

loadPersistedActivity()

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

/** Cached secret so we only read from disk once per process lifetime */
let _cachedSecret: string | null = null

/** Path to persist a generated secret so it survives server restarts */
const CELLULAR_SECRET_FILE = '/opt/gwi-pos/.cellular-secret'

function getCellularSecret(): string {
  // Fast path: already cached
  if (_cachedSecret) return _cachedSecret

  // Priority 1: Try process.env first (works when systemd EnvironmentFile loads correctly)
  let secret = process.env.CELLULAR_TOKEN_SECRET

  // Priority 2: Read directly from .env files on disk.
  // Next.js 16 may sandbox process.env in API routes, so preload.js-set
  // vars can be invisible here. Reading from disk bypasses this entirely.
  if (!secret) {
    try {
      const fs = require('node:fs')
      const envPaths = ['/opt/gwi-pos/.env', '/opt/gwi-pos/app/.env', '/opt/gwi-pos/app/.env.local']
      for (const envPath of envPaths) {
        try {
          const content = fs.readFileSync(envPath, 'utf8') as string
          const match = content.match(/^CELLULAR_TOKEN_SECRET=(.+)$/m)
          if (match?.[1]) {
            secret = match[1].trim()
            break
          }
        } catch { /* file doesn't exist */ }
      }
    } catch { /* fs not available (edge runtime) */ }
  }

  // Priority 3: Read from persisted secret file (survives restarts)
  if (!secret) {
    try {
      const fs = require('node:fs')
      secret = (fs.readFileSync(CELLULAR_SECRET_FILE, 'utf8') as string).trim()
      if (secret) {
        log.info('[cellular-auth] Loaded secret from persisted file')
      }
    } catch { /* file doesn't exist yet */ }
  }

  // Priority 4: No secret found anywhere — fail hard in production, auto-generate in dev/test
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // FAIL HARD — do not auto-generate secrets in production
      throw new Error(
        'FATAL: CELLULAR_TOKEN_SECRET is not configured. ' +
        'In production, this secret must be explicitly set via /opt/gwi-pos/.env. ' +
        'Auto-generation is disabled in production to prevent unauthorized trust roots.'
      )
    }

    // Dev/test: auto-generate for convenience
    try {
      const crypto = require('node:crypto')
      const fs = require('node:fs')
      secret = (crypto.randomBytes(48) as Buffer).toString('hex')
      log.warn('[cellular-auth] CELLULAR_TOKEN_SECRET not set — auto-generating for development')
      try {
        fs.writeFileSync(CELLULAR_SECRET_FILE, secret, { mode: 0o600 })
      } catch (writeErr) {
        log.warn('[cellular-auth] Could not persist secret to file:', writeErr instanceof Error ? writeErr.message : writeErr)
      }
    } catch {
      // crypto/fs not available (edge runtime) — cannot generate
      throw new Error('[cellular-auth] CELLULAR_TOKEN_SECRET is not set and cannot generate secret in this runtime')
    }
  }

  _cachedSecret = secret
  return secret
}

/**
 * Verify a cellular terminal JWT token.
 * Returns the payload if valid, null if invalid/expired/revoked.
 * L1 (in-memory deny list) is checked first for speed, then L2 (DB) catches
 * revocations missed after Vercel cold starts.
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

    // Validate required fields — venueSlug is mandatory (needed for venue DB routing)
    if (
      payload.sub !== 'cellular-terminal' ||
      !payload.terminalId ||
      !payload.locationId ||
      !payload.venueSlug ||
      !payload.deviceFingerprint ||
      !payload.terminalRole
    ) {
      return null
    }

    // Check revocation deny list (L1: in-memory — fast path)
    if (isRevoked(payload.terminalId)) return null

    // L2: Check DB for revocation (critical on Vercel where in-memory is empty after cold start)
    if (await isRevokedFromDb(payload.terminalId, payload.locationId)) return null

    // Track active session for POS admin visibility
    activeSessions.set(`${payload.terminalId}:${payload.deviceFingerprint}`, {
      terminalId: payload.terminalId,
      locationId: payload.locationId,
      deviceFingerprint: payload.deviceFingerprint,
      venueSlug: payload.venueSlug,
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      lastRequestAt: new Date(),
    })

    return payload
  } catch {
    return null
  }
}

/**
 * Verify a cellular token with a grace period for recently-expired tokens.
 *
 * Same validation as verifyCellularToken() but allows tokens that expired
 * within EXPIRED_GRACE_PERIOD_S (4 hours). Used by:
 *   - /api/auth/refresh-cellular — so workers can refresh after outage
 *   - proxy.ts replay gate — so CartOutboxWorker requests auto-heal
 *
 * Returns { payload, expired } where:
 *   - payload is the decoded token (null if completely invalid)
 *   - expired is true if the token was in the grace window (not currently valid)
 *
 * Security: signature, device status, required fields all still enforced.
 */
export async function verifyCellularTokenWithGrace(
  token: string
): Promise<{ payload: CellularTokenPayload; expired: boolean } | null> {
  try {
    const secret = getCellularSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts

    // Verify HMAC-SHA256 signature (non-negotiable — no grace on tampered tokens)
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

    if (!payload.exp) return null

    const now = Math.floor(Date.now() / 1000)
    let expired = false

    if (payload.exp < now) {
      // Token is expired — check if within grace period
      const expiredSeconds = now - payload.exp
      if (expiredSeconds > EXPIRED_GRACE_PERIOD_S) {
        // Beyond grace period — reject completely
        return null
      }
      expired = true
    }

    // Validate required fields
    if (
      payload.sub !== 'cellular-terminal' ||
      !payload.terminalId ||
      !payload.locationId ||
      !payload.venueSlug ||
      !payload.deviceFingerprint ||
      !payload.terminalRole
    ) {
      return null
    }

    // Check revocation deny list (L1: in-memory)
    if (isRevoked(payload.terminalId)) return null

    // L2: Check DB for revocation
    if (await isRevokedFromDb(payload.terminalId, payload.locationId)) return null

    return { payload, expired }
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
  venueSlug: string,
  deviceFingerprint: string,
  terminalRole: CellularTerminalRole,
  employeeId?: string | null,
  employeeName?: string | null,
): Promise<string> {
  const secret = getCellularSecret()
  const now = Math.floor(Date.now() / 1000)

  const payload: CellularTokenPayload = {
    sub: 'cellular-terminal',
    terminalId,
    locationId,
    venueSlug,
    deviceFingerprint,
    canRefund: false, // HARD rule: CELLULAR_ROAMING can NEVER refund
    terminalRole,
    employeeId: employeeId || null,
    employeeName: employeeName || null,
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
  recordActivity(terminalId)

  // Track active session for POS admin visibility
  activeSessions.set(`${terminalId}:${deviceFingerprint}`, {
    terminalId,
    locationId,
    deviceFingerprint,
    venueSlug,
    issuedAt: new Date(payload.iat * 1000),
    expiresAt: new Date(payload.exp * 1000),
    lastRequestAt: new Date(),
  })

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Refresh a cellular token.
 * Verifies old token (with grace period for recently-expired tokens),
 * checks not revoked, issues new token with fresh expiry.
 * Returns null if old token is completely invalid, revoked, or expired beyond grace.
 *
 * Grace period: tokens expired within 4 hours can be refreshed. This is
 * critical for outage recovery — Android workers queue orders offline and
 * need to re-authenticate when connectivity returns.
 */
export async function refreshCellularToken(oldToken: string): Promise<string | null> {
  // Use grace-aware verification so recently-expired tokens can be refreshed
  const result = await verifyCellularTokenWithGrace(oldToken)
  if (!result) return null

  const { payload, expired } = result

  if (expired) {
    log.warn(JSON.stringify({
      event: 'cellular_token_grace_refresh',
      terminalId: payload.terminalId,
      locationId: payload.locationId,
      venueSlug: payload.venueSlug,
      tokenExpiredAt: new Date(payload.exp * 1000).toISOString(),
      graceWindowUsed: true,
      timestamp: new Date().toISOString(),
    }))
  }

  // Skip idle timeout check for grace-period refreshes — the device was offline,
  // so it couldn't have recorded activity. Idle timeout is meaningless after an outage.
  if (!expired && checkIdleTimeout(payload.terminalId)) return null

  // Re-check revocation (belt-and-suspenders with verify)
  if (isRevoked(payload.terminalId)) return null

  // Play Integrity attestation is verified at the route level (refresh-cellular/route.ts)
  // before calling this function. No double-check needed here.

  return issueCellularToken(
    payload.terminalId,
    payload.locationId,
    payload.venueSlug,
    payload.deviceFingerprint,
    payload.terminalRole,
    payload.employeeId,
    payload.employeeName,
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

  // Evict oldest 20% if map exceeds size cap
  if (lastActivity.size > MAX_ACTIVITY_ENTRIES) {
    const entries = Array.from(lastActivity.entries())
    entries.sort((a, b) => a[1] - b[1]) // sort by timestamp ascending
    const toDelete = Math.floor(entries.length * 0.2)
    for (let i = 0; i < toDelete; i++) {
      lastActivity.delete(entries[i][0])
    }
  }

  void Promise.resolve().then(persistActivityToFile).catch(() => {})
}

// ═══════════════════════════════════════════════════════════
// Revocation deny list
// ═══════════════════════════════════════════════════════════

/** Check if a terminalId is on the in-memory deny list (L1 cache — fast path) */
export function isRevoked(terminalId: string): boolean {
  return denyList.has(terminalId)
}

/**
 * Check if a terminal is revoked via DB lookup (L2 — for Vercel cold starts).
 * On Vercel, the in-memory deny list is empty after every cold start, so a revoked
 * device could operate for up to 24h (JWT expiry). This DB check closes that gap.
 * On NUC, this is redundant with the downstream-sync-worker but adds defense-in-depth.
 *
 * Fail-closed: if the DB check errors (table doesn't exist, connection issue),
 * we deny the request rather than allowing a potentially revoked device through.
 */
/** Whether the CellularDevice table exists on this NUC (cached after first check) */
let _cellularDeviceTableChecked: boolean | null = null

async function isRevokedFromDb(terminalId: string, locationId: string): Promise<boolean> {
  try {
    // Dynamic import to avoid top-level dependency on db module
    // (cellular-auth.ts is loaded in edge-compatible contexts)
    const { db } = await import('@/lib/db')

    // Check table existence once — avoids repeated "relation does not exist" errors
    // on NUCs where the CellularDevice table hasn't been created yet (pre-migration 045).
    // If the table doesn't exist, there can be no revocations in it → return false.
    if (_cellularDeviceTableChecked === null) {
      try {
        const result = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CellularDevice') as exists`
        )
        if (result[0]?.exists) {
          _cellularDeviceTableChecked = true
        } else {
          _cellularDeviceTableChecked = null  // Retry next time — DB may be in recovery
        }
      } catch {
        _cellularDeviceTableChecked = null  // Retry next time
      }
    }
    if (!_cellularDeviceTableChecked) return false

    const revoked = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "CellularDevice" WHERE "terminalId" = $1 AND "locationId" = $2 AND status IN ('REVOKED', 'QUARANTINED') LIMIT 1`,
      terminalId,
      locationId
    )
    if (revoked && revoked.length > 0) {
      // Populate in-memory cache so subsequent checks in this process are fast
      denyList.set(terminalId, Date.now())
      return true
    }
    return false
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    // "relation does not exist" = table missing — not a security risk, just missing migration
    if (errMsg.includes('does not exist') || errMsg.includes('relation')) {
      _cellularDeviceTableChecked = null  // Retry next time — table may appear after migration
      return false
    }
    // Fail-closed: if we can't verify a device's revocation status for other reasons, reject
    log.error({ err: error }, '[cellular-auth] DB revocation check failed, denying request:')
    return true
  }
}

/** Revoke a terminal (add to deny list + persist to DB + remove from active sessions) */
export async function revokeTerminal(terminalId: string, locationId?: string): Promise<void> {
  denyList.set(terminalId, Date.now())
  // Remove all sessions for this terminal from the active registry
  for (const [key, session] of activeSessions) {
    if (session.terminalId === terminalId) {
      activeSessions.delete(key)
    }
  }

  // Persist revocation to CellularDevice table (best-effort — in-memory is already set)
  try {
    const { db } = await import('@/lib/db')
    if (locationId) {
      await db.$executeRawUnsafe(
        `UPDATE "CellularDevice" SET status = 'REVOKED', "revokedAt" = NOW(), "updatedAt" = NOW() WHERE "terminalId" = $1 AND "locationId" = $2`,
        terminalId,
        locationId
      )
    } else {
      await db.$executeRawUnsafe(
        `UPDATE "CellularDevice" SET status = 'REVOKED', "revokedAt" = NOW(), "updatedAt" = NOW() WHERE "terminalId" = $1`,
        terminalId
      )
    }
  } catch {
    // DB write failed — in-memory revocation still active for this process lifetime
    log.warn(`[cellular-auth] Failed to persist revocation to DB for terminal ${terminalId}`)
  }
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

/**
 * Load revoked/quarantined devices from the CellularDevice table into
 * the in-memory deny list. Called on module initialization so the deny
 * list survives process restarts (closes the cold-start gap on NUC).
 */
export async function loadDenyListFromDb(): Promise<void> {
  try {
    const { db } = await import('@/lib/db')

    // Check table existence first (reuses the same pattern as isRevokedFromDb)
    const tableCheck = await db.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CellularDevice') as exists`
    )
    if (!tableCheck[0]?.exists) return

    const revoked = await db.$queryRawUnsafe<Array<{
      terminalId: string
      revokedAt: Date | null
      updatedAt: Date
    }>>(
      `SELECT "terminalId", "revokedAt", "updatedAt" FROM "CellularDevice" WHERE status IN ('REVOKED', 'QUARANTINED') AND "terminalId" IS NOT NULL`
    )

    for (const r of revoked) {
      const ts = r.revokedAt instanceof Date
        ? r.revokedAt.getTime()
        : r.updatedAt instanceof Date
          ? r.updatedAt.getTime()
          : Date.now()
      denyList.set(r.terminalId, ts)
    }

    if (revoked.length > 0) {
      log.info(`[cellular-auth] Loaded ${revoked.length} revoked/quarantined devices from DB into deny list`)
    }
  } catch {
    // DB not available yet or table doesn't exist — deny list starts empty
    // (isRevokedFromDb L2 check still catches revocations on a per-request basis)
  }
}

// Load deny list from DB on module init (non-blocking — don't delay imports)
void loadDenyListFromDb().catch(() => {})

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

    // Evict oldest entries if map exceeds size cap
    if (rateLimitBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
      let oldest: string | null = null
      let oldestTime = Infinity
      for (const [id, b] of rateLimitBuckets) {
        if (b.windowStart < oldestTime) {
          oldestTime = b.windowStart
          oldest = id
        }
      }
      if (oldest) rateLimitBuckets.delete(oldest)
    }

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

  // Hard cap: evict oldest 20% if still over limit after TTL eviction
  if (lastActivity.size > MAX_ACTIVITY_ENTRIES) {
    const entries = Array.from(lastActivity.entries())
    entries.sort((a, b) => a[1] - b[1])
    const toDelete = Math.floor(entries.length * 0.2)
    for (let i = 0; i < toDelete; i++) {
      lastActivity.delete(entries[i][0])
    }
  }

  // Evict stale rate limit buckets
  for (const [id, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > 10_000) rateLimitBuckets.delete(id)
  }

  // Evict active sessions expired more than 24 hours ago
  for (const [key, session] of activeSessions) {
    if (now - session.expiresAt.getTime() > ONE_DAY) {
      activeSessions.delete(key)
    }
  }
}

// Run cleanup every 5 minutes (reduced from 10 to limit memory growth)
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCaches, 5 * 60 * 1000)
}

// ═══════════════════════════════════════════════════════════
// Play Integrity Attestation
// ═══════════════════════════════════════════════════════════

/**
 * Play Integrity verdict response from Google's decodeIntegrityToken API.
 * Only the fields we need for device attestation are typed.
 */
interface PlayIntegrityVerdict {
  requestDetails?: {
    requestPackageName?: string
    timestampMillis?: string
    nonce?: string
  }
  appIntegrity?: {
    appRecognitionVerdict?: string
  }
  deviceIntegrity?: {
    deviceRecognitionVerdict?: string[]
  }
  accountDetails?: {
    appLicensingVerdict?: string
  }
}

export interface PlayIntegrityResult {
  valid: boolean
  verdict: string
  deviceRecognitionVerdict: string[]
  error?: string
}

/**
 * Verify a Play Integrity token by calling Google's server-side API.
 *
 * This uses the Cloud-based server-side API method:
 *   POST https://playintegrity.googleapis.com/v1/{packageName}:decodeIntegrityToken
 *
 * Requires:
 * - GOOGLE_CLOUD_PROJECT_NUMBER — Google Cloud project number
 * - GOOGLE_SERVICE_ACCOUNT_KEY — JSON service account key (or use Application Default Credentials)
 *
 * The integrity token is generated client-side on Android using the Play Integrity API
 * and sent in the `x-play-integrity-token` header during pairing/refresh.
 *
 * Device must have MEETS_DEVICE_INTEGRITY in deviceRecognitionVerdict.
 * Rooted / non-certified devices will be rejected.
 */
export async function verifyPlayIntegrity(
  integrityToken: string,
  packageName: string = 'com.gwi.pax'
): Promise<PlayIntegrityResult> {
  const projectNumber = process.env.GOOGLE_CLOUD_PROJECT_NUMBER
  if (!projectNumber) {
    const isProduction = process.env.NODE_ENV === 'production'
    if (isProduction) {
      // Fail-closed in production — missing Play Integrity config is a security risk.
      // Do NOT allow attestation bypass; block the request until configured.
      log.error('[PlayIntegrity] CRITICAL: GOOGLE_CLOUD_PROJECT_NUMBER not set in production — attestation DENIED. Configure immediately.')
      return {
        valid: false,
        verdict: 'denied_no_config',
        deviceRecognitionVerdict: [],
        error: 'Play Integrity not configured in production',
      }
    } else {
      log.warn('[PlayIntegrity] GOOGLE_CLOUD_PROJECT_NUMBER not set — attestation skipped (non-production)')
    }
    return {
      valid: true,
      verdict: 'skipped_no_config',
      deviceRecognitionVerdict: [],
    }
  }

  try {
    // Get access token for Google API call
    const accessToken = await getGoogleAccessToken()
    if (!accessToken) {
      const isProduction = process.env.NODE_ENV === 'production'
      if (isProduction) {
        // Fail-closed in production — cannot verify integrity without credentials.
        log.error('[PlayIntegrity] CRITICAL: Could not obtain Google access token in production — attestation DENIED. Configure GOOGLE_SERVICE_ACCOUNT_KEY immediately.')
        return {
          valid: false,
          verdict: 'denied_no_credentials',
          deviceRecognitionVerdict: [],
          error: 'Google access token not available in production',
        }
      } else {
        log.warn('[PlayIntegrity] Could not obtain Google access token — attestation skipped (non-production)')
      }
      return {
        valid: true,
        verdict: 'skipped_no_credentials',
        deviceRecognitionVerdict: [],
      }
    }

    const url = `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ integrity_token: integrityToken }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown')
      log.error(`[PlayIntegrity] Google API returned ${response.status}: ${errorBody}`)
      return {
        valid: false,
        verdict: `api_error_${response.status}`,
        deviceRecognitionVerdict: [],
        error: `Google API error: ${response.status}`,
      }
    }

    const result = await response.json() as { tokenPayloadExternal?: PlayIntegrityVerdict }
    const verdict = result.tokenPayloadExternal

    if (!verdict) {
      return {
        valid: false,
        verdict: 'no_verdict',
        deviceRecognitionVerdict: [],
        error: 'No verdict in response',
      }
    }

    const deviceVerdict = verdict.deviceIntegrity?.deviceRecognitionVerdict ?? []
    const meetsDeviceIntegrity = deviceVerdict.includes('MEETS_DEVICE_INTEGRITY')

    // Log the full verdict for debugging
    log.info(JSON.stringify({
      event: 'play_integrity_check',
      packageName: verdict.requestDetails?.requestPackageName,
      appVerdict: verdict.appIntegrity?.appRecognitionVerdict,
      deviceVerdict,
      meetsDeviceIntegrity,
      timestamp: new Date().toISOString(),
    }))

    return {
      valid: meetsDeviceIntegrity,
      verdict: meetsDeviceIntegrity ? 'MEETS_DEVICE_INTEGRITY' : 'DOES_NOT_MEET_DEVICE_INTEGRITY',
      deviceRecognitionVerdict: deviceVerdict,
      error: meetsDeviceIntegrity ? undefined : 'Device does not meet integrity requirements',
    }
  } catch (error) {
    log.error({ err: error }, '[PlayIntegrity] Verification failed:')
    return {
      valid: false,
      verdict: 'verification_error',
      deviceRecognitionVerdict: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Get a Google Cloud access token using service account credentials.
 *
 * Supports two modes:
 * 1. GOOGLE_SERVICE_ACCOUNT_KEY env var (JSON string) — for Vercel/external
 * 2. Application Default Credentials — for GCE/Cloud Run
 *
 * Uses the OAuth2 token endpoint with a self-signed JWT for service accounts.
 */
async function getGoogleAccessToken(): Promise<string | null> {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null

  try {
    const key = JSON.parse(keyJson) as {
      client_email: string
      private_key: string
      token_uri: string
    }

    const now = Math.floor(Date.now() / 1000)
    const jwtHeader = { alg: 'RS256', typ: 'JWT' }
    const jwtClaim = {
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/playintegrity',
      aud: key.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    // Sign the JWT with the service account private key
    const encoder = new TextEncoder()
    const headerB64 = btoa(JSON.stringify(jwtHeader)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const claimB64 = btoa(JSON.stringify(jwtClaim)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const unsignedJwt = `${headerB64}.${claimB64}`

    // Import the RSA private key
    const pemKey = key.private_key
    const pemBody = pemKey
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')

    const keyBuffer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      keyBuffer.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(unsignedJwt)
    )

    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    const signedJwt = `${unsignedJwt}.${sigB64}`

    // Exchange the signed JWT for an access token
    const tokenResponse = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${signedJwt}`,
      signal: AbortSignal.timeout(10_000),
    })

    if (!tokenResponse.ok) {
      log.error('[PlayIntegrity] Token exchange failed:', tokenResponse.status)
      return null
    }

    const tokenData = await tokenResponse.json() as { access_token?: string }
    return tokenData.access_token ?? null
  } catch (error) {
    log.error({ err: error }, '[PlayIntegrity] Failed to get Google access token:')
    return null
  }
}

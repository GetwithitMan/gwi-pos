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

/** Max size for rateLimitBuckets before evicting oldest entries */
const MAX_RATE_LIMIT_BUCKETS = 10_000

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
        console.info('[cellular-auth] Loaded secret from persisted file')
      }
    } catch { /* file doesn't exist yet */ }
  }

  // Priority 4: Generate a new secret and persist it to disk
  if (!secret) {
    try {
      const crypto = require('node:crypto')
      const fs = require('node:fs')
      secret = (crypto.randomBytes(48) as Buffer).toString('hex')
      console.warn(
        '[cellular-auth] CELLULAR_TOKEN_SECRET not set — generated new secret and persisting to',
        CELLULAR_SECRET_FILE,
        '(set the env var to avoid this warning)'
      )
      try {
        fs.writeFileSync(CELLULAR_SECRET_FILE, secret, { mode: 0o600 })
      } catch (writeErr) {
        console.warn('[cellular-auth] Could not persist secret to file:', writeErr instanceof Error ? writeErr.message : writeErr)
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
  venueSlug: string,
  deviceFingerprint: string,
  terminalRole: CellularTerminalRole
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

  // Play Integrity attestation is verified at the route level (refresh-cellular/route.ts)
  // before calling this function. No double-check needed here.

  return issueCellularToken(
    payload.terminalId,
    payload.locationId,
    payload.venueSlug,
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

  // Evict stale rate limit buckets
  for (const [id, bucket] of rateLimitBuckets) {
    if (now - bucket.windowStart > 10_000) rateLimitBuckets.delete(id)
  }
}

// Run cleanup every 10 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupCaches, 10 * 60 * 1000)
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
    console.warn('[PlayIntegrity] GOOGLE_CLOUD_PROJECT_NUMBER not set — skipping attestation')
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
      console.warn('[PlayIntegrity] Could not obtain Google access token — allowing request (gradual rollout)')
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
      console.error(`[PlayIntegrity] Google API returned ${response.status}: ${errorBody}`)
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
    console.info(JSON.stringify({
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
    console.error('[PlayIntegrity] Verification failed:', error)
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
      console.error('[PlayIntegrity] Token exchange failed:', tokenResponse.status)
      return null
    }

    const tokenData = await tokenResponse.json() as { access_token?: string }
    return tokenData.access_token ?? null
  } catch (error) {
    console.error('[PlayIntegrity] Failed to get Google access token:', error)
    return null
  }
}

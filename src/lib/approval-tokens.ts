/**
 * Mutation-Bound Manager Approval Tokens
 *
 * Defense-in-depth layer: when a manager approves a comp/void/discount via PIN,
 * the server issues a short-lived HMAC-signed token binding the approval to:
 *   - managerId (who approved)
 *   - locationId (where)
 *   - timestamp (when)
 *   - nonce (one-time use)
 *
 * Mutation routes verify the token before accepting the approvedById. If only
 * approvedById is present (no token), the mutation still proceeds for backward
 * compatibility with older clients, but a warning is logged.
 *
 * Uses Node.js built-in crypto -- no external dependencies.
 */

import crypto from 'crypto'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('approval-tokens')

// ── Secret management ───────────────────────────────────────────────────────
// Prefer env var; fall back to a per-process random secret (sufficient for
// single-NUC deployments where the same process issues and verifies tokens).
const APPROVAL_SECRET = process.env.APPROVAL_TOKEN_SECRET
  || crypto.randomBytes(32).toString('hex')

// ── Token TTL ───────────────────────────────────────────────────────────────
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ── Nonce replay prevention ─────────────────────────────────────────────────
// In-memory set of recently used nonces. Cleaned up periodically.
// This prevents replaying the same token for multiple mutations.
const usedNonces = new Set<string>()
const NONCE_CLEANUP_INTERVAL = setInterval(() => {
  // Simple cleanup: clear the entire set every 10 minutes.
  // Tokens older than 5 minutes are rejected by TTL check anyway,
  // so clearing at 10 minutes is safe and avoids unbounded growth.
  usedNonces.clear()
}, 10 * 60 * 1000)
if (NONCE_CLEANUP_INTERVAL && typeof NONCE_CLEANUP_INTERVAL === 'object' && 'unref' in NONCE_CLEANUP_INTERVAL) {
  (NONCE_CLEANUP_INTERVAL as NodeJS.Timeout).unref()
}

// ── Token format ────────────────────────────────────────────────────────────
// Base64URL-encoded JSON payload + "." + HMAC-SHA256 signature
// Payload: { m: managerId, l: locationId, t: timestampMs, n: nonce }

interface TokenPayload {
  m: string   // managerId
  l: string   // locationId
  t: number   // timestamp (ms since epoch)
  n: string   // nonce (UUID)
}

function base64urlEncode(data: string): string {
  return Buffer.from(data, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64urlDecode(encoded: string): string {
  // Restore base64 padding
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
  while (padded.length % 4 !== 0) padded += '='
  return Buffer.from(padded, 'base64').toString('utf-8')
}

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', APPROVAL_SECRET)
    .update(payload)
    .digest('base64url')
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate an approval token after successful manager PIN verification.
 *
 * @param managerId - The verified manager's employee ID
 * @param locationId - The location where the approval was granted
 * @returns A signed approval token string
 */
export function generateApprovalToken(managerId: string, locationId: string): string {
  const payload: TokenPayload = {
    m: managerId,
    l: locationId,
    t: Date.now(),
    n: crypto.randomUUID(),
  }

  const payloadStr = base64urlEncode(JSON.stringify(payload))
  const signature = sign(payloadStr)

  return `${payloadStr}.${signature}`
}

export interface ApprovalTokenResult {
  valid: boolean
  managerId?: string
  locationId?: string
  error?: string
}

/**
 * Verify an approval token and check it matches the expected manager.
 *
 * Checks:
 *   1. Signature validity (HMAC-SHA256)
 *   2. Token not expired (5 min TTL)
 *   3. Nonce not already used (replay prevention)
 *   4. managerId matches expectedManagerId (if provided)
 *
 * @param token - The approval token to verify
 * @param expectedManagerId - If provided, the token's managerId must match
 * @returns Verification result with managerId if valid
 */
export function verifyApprovalToken(
  token: string,
  expectedManagerId?: string,
): ApprovalTokenResult {
  try {
    const dotIndex = token.indexOf('.')
    if (dotIndex === -1) {
      return { valid: false, error: 'Malformed token' }
    }

    const payloadStr = token.slice(0, dotIndex)
    const providedSig = token.slice(dotIndex + 1)

    // 1. Verify signature
    const expectedSig = sign(payloadStr)
    if (!crypto.timingSafeEqual(
      Buffer.from(providedSig, 'base64url'),
      Buffer.from(expectedSig, 'base64url'),
    )) {
      return { valid: false, error: 'Invalid signature' }
    }

    // 2. Decode payload
    let payload: TokenPayload
    try {
      payload = JSON.parse(base64urlDecode(payloadStr))
    } catch {
      return { valid: false, error: 'Invalid payload' }
    }

    // 3. Check TTL
    const age = Date.now() - payload.t
    if (age > TOKEN_TTL_MS) {
      return { valid: false, error: 'Token expired' }
    }
    if (age < -30_000) {
      // Token from the future (>30s clock skew) -- reject
      return { valid: false, error: 'Token timestamp invalid' }
    }

    // 4. Check nonce replay
    if (usedNonces.has(payload.n)) {
      return { valid: false, error: 'Token already used' }
    }

    // 5. Check managerId match
    if (expectedManagerId && payload.m !== expectedManagerId) {
      return { valid: false, error: 'Manager ID mismatch' }
    }

    // Mark nonce as used
    usedNonces.add(payload.n)

    return {
      valid: true,
      managerId: payload.m,
      locationId: payload.l,
    }
  } catch (caughtErr) {
    log.warn({ err: caughtErr }, 'Approval token verification failed unexpectedly')
    return { valid: false, error: 'Verification failed' }
  }
}

/**
 * Validate an approval token from a mutation request.
 *
 * This is the convenience function for mutation routes. It handles three cases:
 *   1. approvalToken present -> verify it, reject if invalid
 *   2. approvalToken absent but approvedById present -> accept (backward compat), log warning
 *   3. Neither present -> no approval needed, pass through
 *
 * @returns { valid: true } if the approval is acceptable, { valid: false, error } if not
 */
export function validateMutationApproval(opts: {
  approvalToken?: string | null
  approvedById?: string | null
  routeName: string
}): { valid: true } | { valid: false; error: string; status: number } {
  const { approvalToken, approvedById, routeName } = opts

  // Case 1: Token provided -- must be valid
  if (approvalToken) {
    const result = verifyApprovalToken(approvalToken, approvedById || undefined)
    if (!result.valid) {
      log.warn(
        { routeName, approvedById, error: result.error },
        'Approval token rejected'
      )
      return { valid: false, error: `Invalid approval token: ${result.error}`, status: 403 }
    }
    return { valid: true }
  }

  // Case 2: No token but approvedById present -- backward compatibility
  if (approvedById) {
    log.warn(
      { routeName, approvedById },
      'Manager approval without token (legacy client) -- accepting for backward compatibility'
    )
    return { valid: true }
  }

  // Case 3: No approval needed
  return { valid: true }
}

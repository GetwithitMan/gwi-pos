/**
 * Portal Authentication Utilities
 *
 * HMAC-signed tokens for single-order view links, OTP generation/verification,
 * session token management, and redemption code generation for the customer portal.
 */

import crypto from 'crypto'

function getPortalSecret(): string {
  const secret = process.env.PORTAL_HMAC_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: PORTAL_HMAC_SECRET must be set in production')
    }
    return 'gwi-portal-hmac-secret-change-me' // dev only
  }
  return secret
}

const PORTAL_SECRET = getPortalSecret()

// ─── HMAC-Signed Order View Tokens ─────────────────────────────────────────

/** Generate HMAC-signed token for single-order view links. Token = base64url(JSON({cakeOrderId, customerId, exp})) + '.' + hmac */
export function generateOrderViewToken(cakeOrderId: string, customerId: string, expiryDays = 30): string {
  const exp = Date.now() + expiryDays * 86400000
  const payload = Buffer.from(JSON.stringify({ cakeOrderId, customerId, exp })).toString('base64url')
  const sig = crypto.createHmac('sha256', PORTAL_SECRET).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

/** Verify and decode order view token */
export function verifyOrderViewToken(token: string): { valid: boolean; cakeOrderId?: string; customerId?: string; expired?: boolean } {
  try {
    const [payload, sig] = token.split('.')
    if (!payload || !sig) return { valid: false }
    const expectedSig = crypto.createHmac('sha256', PORTAL_SECRET).update(payload).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return { valid: false }
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (data.exp < Date.now()) return { valid: false, expired: true, cakeOrderId: data.cakeOrderId, customerId: data.customerId }
    return { valid: true, cakeOrderId: data.cakeOrderId, customerId: data.customerId }
  } catch { return { valid: false } }
}

// ─── OTP (One-Time Password) ───────────────────────────────────────────────

/** Generate 6-digit OTP + SHA-256 hash */
export function generateOTP(): { code: string; hash: string; expiresAt: Date } {
  const code = String(crypto.randomInt(100000, 999999))
  const hash = crypto.createHash('sha256').update(code + PORTAL_SECRET).digest('hex')
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
  return { code, hash, expiresAt }
}

/** Verify OTP code against stored hash */
export function verifyOTP(code: string, storedHash: string, expiresAt: Date): boolean {
  if (new Date() > expiresAt) return false
  const hash = crypto.createHash('sha256').update(code + PORTAL_SECRET).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash))
}

// ─── Session Tokens ────────────────────────────────────────────────────────

/** Generate random 64-char hex session token */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/** Session expires in 7 days */
export function getSessionExpiry(): Date {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}

// ─── Redemption Codes ──────────────────────────────────────────────────────

/** Generate 6-char alphanumeric redemption code */
export function generateRedemptionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no O/0/1/I for readability
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(chars.length)]
  return code
}

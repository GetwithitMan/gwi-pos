/**
 * POS Session Token — HMAC-SHA256 signed httpOnly cookie.
 *
 * On login, the server creates a signed token containing the employee's
 * identity and sets it as an httpOnly cookie. The Zustand auth store
 * in localStorage becomes a display-only cache — all server-side
 * permission checks validate against this cookie.
 *
 * Uses the same HMAC-SHA256 pattern as cloud-auth.ts but with a
 * separate secret (NEXTAUTH_SECRET) and POS-specific payload.
 *
 * Cookie: `pos-session` (httpOnly, sameSite=lax, 8-hour expiry)
 */

import { cookies } from 'next/headers'

export const POS_SESSION_COOKIE = 'pos-session'
const SESSION_EXPIRY_SECONDS = 8 * 60 * 60 // 8 hours
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

export interface PosSessionPayload {
  employeeId: string
  locationId: string
  roleId: string
  roleName: string
  permissions: string[]
  iat: number
  exp: number
  lastActivity: number // timestamp seconds — updated on each verified request
}

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.SESSION_SECRET || 'dev-pos-session-secret'
}

// ─── Base64url helpers (same as cloud-auth.ts) ──────────────────────────

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

// ─── Token creation ─────────────────────────────────────────────────────

export async function createSessionToken(payload: Omit<PosSessionPayload, 'iat' | 'exp' | 'lastActivity'>): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: PosSessionPayload = {
    ...payload,
    iat: now,
    exp: now + SESSION_EXPIRY_SECONDS,
    lastActivity: now,
  }

  const secret = getSecret()
  const encoder = new TextEncoder()
  const headerB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify(fullPayload)))

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

  return `${headerB64}.${payloadB64}.${base64urlEncodeBytes(new Uint8Array(signatureBuffer))}`
}

// ─── Token verification ─────────────────────────────────────────────────

export async function verifySessionToken(token: string): Promise<PosSessionPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, signatureB64] = parts
    const secret = getSecret()
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const signature = base64urlDecode(signatureB64)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`)
    )

    if (!valid) return null

    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64))
    ) as PosSessionPayload

    // Check token expiry
    const now = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp < now) return null

    // Check idle timeout (30 min since last activity)
    if (payload.lastActivity && (now - payload.lastActivity) > (SESSION_IDLE_TIMEOUT_MS / 1000)) {
      return null
    }

    // Validate required fields
    if (!payload.employeeId || !payload.locationId || !payload.roleId) return null

    return payload
  } catch {
    return null
  }
}

// ─── Cookie helpers (for use in API routes) ──────────────────────────────

/**
 * Set the POS session cookie after a successful login.
 * Must be called inside a route handler (uses next/headers cookies()).
 */
export async function setSessionCookie(payload: Omit<PosSessionPayload, 'iat' | 'exp' | 'lastActivity'>): Promise<string> {
  const token = await createSessionToken(payload)
  const cookieStore = await cookies()
  cookieStore.set(POS_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRY_SECONDS,
    path: '/',
  })
  return token
}

/**
 * Read and verify the POS session cookie from the current request.
 * Returns the payload if valid, null if missing/expired/tampered.
 */
export async function getSessionFromCookie(): Promise<PosSessionPayload | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(POS_SESSION_COOKIE)?.value
    if (!token) return null
    return verifySessionToken(token)
  } catch {
    return null
  }
}

/**
 * Refresh the session cookie with updated lastActivity timestamp.
 * Called on authenticated API requests to keep the session alive.
 */
export async function refreshSessionCookie(payload: PosSessionPayload): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  // Only refresh if >1 min since last refresh to avoid excessive cookie writes
  if (now - payload.lastActivity < 60) return

  const refreshed: Omit<PosSessionPayload, 'iat' | 'exp' | 'lastActivity'> = {
    employeeId: payload.employeeId,
    locationId: payload.locationId,
    roleId: payload.roleId,
    roleName: payload.roleName,
    permissions: payload.permissions,
  }
  await setSessionCookie(refreshed)
}

/**
 * Clear the POS session cookie (on logout).
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(POS_SESSION_COOKIE)
}

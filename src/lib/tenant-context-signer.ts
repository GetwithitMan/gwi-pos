/**
 * Signed Internal Tenant JWT
 *
 * Signs and verifies a short-lived JWT that binds:
 *   venueSlug + locationId + method + path + bodySha256 + jti
 *
 * Used by proxy.ts to sign context at slug-set points,
 * and by with-venue.ts to verify before trusting headers.
 *
 * Web Crypto API (edge-compatible — works in Next.js middleware).
 * 15-second max expiry (proxy → app is same process/invocation).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TenantContextPayload {
  venueSlug: string
  locationId: string
  method: string
  path: string
  iat: number
  exp: number
  jti: string
  iss: string
  aud: string
  bodySha256?: string // required for POST/PUT/PATCH/DELETE
}

import { base64urlEncodeBytes, base64urlDecode } from './base64url'

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 of a request body (base64url encoded).
 * Always hashes the full body — no truncation.
 */
export async function hashBody(body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return base64urlEncodeBytes(new Uint8Array(digest))
}

/**
 * Sign a tenant context JWT.
 *
 * @param payload - venueSlug, locationId, method, path, bodySha256
 * @param secret - TENANT_SIGNING_KEY (from system-config.ts)
 * @returns Signed JWT string
 */
export async function signTenantContext(
  payload: Omit<TenantContextPayload, 'iat' | 'exp' | 'jti' | 'iss' | 'aud'>,
  secret: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const full: TenantContextPayload = {
    ...payload,
    iat: now,
    exp: now + 15, // 15 seconds max
    jti: crypto.randomUUID(),
    iss: 'gwi-pos-proxy',
    aud: 'gwi-pos-backend',
  }

  const encoder = new TextEncoder()
  const headerB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = base64urlEncodeBytes(encoder.encode(JSON.stringify(full)))

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(`${headerB64}.${payloadB64}`))
  return `${headerB64}.${payloadB64}.${base64urlEncodeBytes(new Uint8Array(signatureBuffer))}`
}

// ── Verification ─────────────────────────────────────────────────────────────

export interface VerifyOptions {
  /** Expected HTTP method */
  method: string
  /** Expected request path */
  path: string
  /** Body SHA-256 (for mutating methods) — re-compute and compare */
  bodySha256?: string
}

/**
 * Verify a tenant context JWT.
 *
 * Returns the decoded payload on success, null on failure.
 * Checks: signature, expiry, method/path binding, body hash.
 */
export async function verifyTenantContext(
  token: string,
  secret: string,
  opts: VerifyOptions,
): Promise<TenantContextPayload | null> {
  try {
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
      ['verify'],
    )
    const signature = base64urlDecode(signatureB64)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature.buffer.slice(signature.byteOffset, signature.byteOffset + signature.byteLength) as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`),
    )
    if (!valid) return null

    // Decode payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payloadB64))
    ) as TenantContextPayload

    // Check expiry
    const now = Math.floor(Date.now() / 1000)
    if (!payload.exp || payload.exp < now) return null

    // Check issuer/audience
    if (payload.iss !== 'gwi-pos-proxy' || payload.aud !== 'gwi-pos-backend') return null

    // Check method binding
    if (payload.method !== opts.method) return null

    // Check path binding
    if (payload.path !== opts.path) return null

    // Check body hash for mutating methods
    if (opts.bodySha256 !== undefined) {
      if (payload.bodySha256 !== opts.bodySha256) return null
    }

    return payload
  } catch {
    return null
  }
}

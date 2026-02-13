/**
 * Cloud Authentication for Venue Admin Access
 *
 * When the POS is accessed via *.ordercontrolcenter.com (cloud mode),
 * authentication is handled by Mission Control via Clerk.
 *
 * Flow:
 * 1. Owner visits slug.ordercontrolcenter.com
 * 2. POS middleware detects cloud mode, checks session cookie
 * 3. No session → redirect to MC for Clerk auth
 * 4. MC validates access → generates signed JWT → redirects back
 * 5. POS validates JWT → creates session → shows admin pages only
 *
 * Security:
 * - HMAC-SHA256 signed JWT (shared PROVISION_API_KEY secret)
 * - 8-hour token lifetime
 * - Slug-bound (token only works for the matching venue)
 * - httpOnly session cookie (XSS-proof)
 * - Admin routes only (POS ordering blocked in cloud mode)
 */

export interface CloudTokenPayload {
  sub: string // Clerk user ID
  email: string
  name: string
  slug: string // Venue slug
  orgId: string // Organization ID
  role: string // Admin role
  iat: number
  exp: number
}

/**
 * Verify a cloud access JWT token using Web Crypto API.
 * Edge-compatible (works in Next.js middleware).
 */
export async function verifyCloudToken(
  token: string,
  secret: string
): Promise<CloudTokenPayload | null> {
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
    ) as CloudTokenPayload

    // Check expiry
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Validate required fields
    if (!payload.sub || !payload.email || !payload.slug) {
      return null
    }

    return payload
  } catch {
    return null
  }
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

/** Routes blocked in cloud mode (POS front-of-house only) */
const CLOUD_BLOCKED_PATHS = [
  '/login',
  '/orders',
  '/kds',
  '/entertainment',
  '/cfd',
  '/mobile',
  '/tabs',
  '/crew',
  '/pay-at-table',
  '/tips',
  '/approve-void',
]

/** Check if a pathname is blocked in cloud mode */
export function isBlockedInCloudMode(pathname: string): boolean {
  return CLOUD_BLOCKED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )
}

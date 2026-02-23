/**
 * GWI Access Gate — Email-Based Session Token
 *
 * First layer of protection for *.barpos.restaurant before the existing
 * cloud session auth (pos-cloud-session) takes over.
 *
 * Session Strategy: Signed JWT stored in gwi-access httpOnly cookie
 *   - 1-hour lifetime (refreshed on each request while active)
 *   - Contains email + timestamps
 *   - Edge-compatible (Web Crypto API, same pattern as cloud-auth.ts)
 */

export interface AccessPayload {
  email: string
  iat: number
  exp: number
}

/**
 * Sign a gwi-access JWT (1-hour lifetime).
 * Edge-compatible.
 */
export async function signAccessToken(
  email: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: AccessPayload = {
    email,
    iat: now,
    exp: now + 60 * 60, // 1 hour — refreshed on each request while active
  }
  const encoder = new TextEncoder()
  const headerB64 = _b64u(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payloadB64 = _b64u(encoder.encode(JSON.stringify(payload)))

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${headerB64}.${payloadB64}`)
  )
  return `${headerB64}.${payloadB64}.${_b64u(new Uint8Array(sigBuf))}`
}

/**
 * Verify a gwi-access JWT. Returns payload or null.
 * Edge-compatible.
 */
export async function verifyAccessToken(
  token: string,
  secret: string
): Promise<AccessPayload | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, signatureB64] = parts
    const encoder = new TextEncoder()

    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    const sig = _b64uDecode(signatureB64)
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
      encoder.encode(`${headerB64}.${payloadB64}`)
    )
    if (!valid) return null

    const payload = JSON.parse(
      new TextDecoder().decode(_b64uDecode(payloadB64))
    ) as AccessPayload

    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

function _b64u(bytes: Uint8Array): string {
  const binary = Array.from(bytes)
    .map((b) => String.fromCharCode(b))
    .join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function _b64uDecode(str: string): Uint8Array {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

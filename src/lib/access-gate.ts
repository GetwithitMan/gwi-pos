/**
 * GWI Access Gate — SMS OTP + Session Token (T-070)
 *
 * First layer of protection for *.barpos.restaurant before the existing
 * cloud session auth (pos-cloud-session) takes over.
 *
 * OTP Strategy: Time-based HMAC (stateless — no DB needed for codes)
 *   - Window: 10 minutes. Checks current + previous window (20-min grace).
 *   - Code: 6 digits derived from HMAC-SHA256(GWI_ACCESS_SECRET, phone:window)
 *
 * Session Strategy: Signed JWT stored in gwi-access httpOnly cookie
 *   - 8-hour lifetime
 *   - Contains masked phone + timestamps
 *   - Edge-compatible (Web Crypto API, same pattern as cloud-auth.ts)
 */

export interface AccessPayload {
  phone: string // masked: +1-xxx-xxx-XXXX
  iat: number
  exp: number
}

/** Mask a phone number for logging: +1-xxx-xxx-1234 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 10) return 'xxx-xxx-****'
  return `+1-xxx-xxx-${digits.slice(-4)}`
}

/** Normalize phone to E.164 digits only */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return `+${digits}`
}

/**
 * Generate a 6-digit HMAC OTP for a phone number.
 * Valid for the current 10-minute window.
 * Edge-compatible (Web Crypto).
 */
export async function generateOTP(phone: string, secret: string): Promise<string> {
  const window = Math.floor(Date.now() / (10 * 60 * 1000))
  return _hmacCode(phone, window, secret)
}

/**
 * Verify a 6-digit OTP. Accepts current + previous window (20-min grace).
 * Edge-compatible.
 */
export async function verifyOTP(
  phone: string,
  code: string,
  secret: string
): Promise<boolean> {
  const window = Math.floor(Date.now() / (10 * 60 * 1000))
  for (const w of [window, window - 1]) {
    const expected = await _hmacCode(phone, w, secret)
    if (expected === code.trim()) return true
  }
  return false
}

async function _hmacCode(phone: string, window: number, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const data = encoder.encode(`${phone}:${window}`)
  const signature = await crypto.subtle.sign('HMAC', key, data)
  const bytes = new Uint8Array(signature)
  const num =
    ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
  return String(num % 1_000_000).padStart(6, '0')
}

/**
 * Sign a gwi-access JWT (8-hour lifetime).
 * Edge-compatible.
 */
export async function signAccessToken(
  phone: string,
  secret: string
): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload: AccessPayload = {
    phone: maskPhone(phone),
    iat: now,
    exp: now + 8 * 60 * 60,
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

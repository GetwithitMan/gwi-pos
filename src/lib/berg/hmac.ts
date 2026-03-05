/**
 * Berg Bridge — HMAC Authentication (v2)
 *
 * The berg-bridge service signs each request to /api/berg/dispense:
 *   Headers: x-berg-ts (unix ms), x-berg-body-sha256 (hex SHA256 of body)
 *   Authorization: Bearer HMAC_SHA256(deviceId.ts.bodySha256, plainSecret)
 *
 * Security properties:
 * - Body SHA256 bound into HMAC prevents body tampering
 * - Timestamp prevents replay attacks (±60s window)
 * - deviceId bound into HMAC prevents cross-device replay
 * - Secrets can be AES-256-GCM encrypted in DB (BRIDGE_MASTER_KEY)
 * - Falls back to GWI_BRIDGE_SECRETS env var (legacy)
 */

import {
  createHmac,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'crypto'

/** Max clock skew allowed between bridge and POS (milliseconds) */
const MAX_CLOCK_SKEW_MS = 60_000

/**
 * Generate a new random bridge secret (hex string, 32 bytes = 64 hex chars).
 * Call this on device creation; show it once in UI; store encrypted or hashed.
 */
export function generateBridgeSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Encrypt a bridge secret using AES-256-GCM with BRIDGE_MASTER_KEY.
 * Stored format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function encryptBridgeSecret(secret: string): { encrypted: string; keyVersion: number } {
  const masterKeyHex = process.env.BRIDGE_MASTER_KEY
  if (!masterKeyHex) {
    throw new Error('BRIDGE_MASTER_KEY env var not set')
  }
  const key = Buffer.from(masterKeyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('BRIDGE_MASTER_KEY must be 32 bytes (64 hex chars)')
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`,
    keyVersion: 1,
  }
}

/**
 * Decrypt a bridge secret from AES-256-GCM format using BRIDGE_MASTER_KEY.
 * Input format: `${iv_hex}:${authTag_hex}:${ciphertext_hex}`
 */
export function decryptBridgeSecret(encrypted: string): string {
  const masterKeyHex = process.env.BRIDGE_MASTER_KEY
  if (!masterKeyHex) {
    throw new Error('BRIDGE_MASTER_KEY env var not set')
  }
  const key = Buffer.from(masterKeyHex, 'hex')
  if (key.length !== 32) {
    throw new Error('BRIDGE_MASTER_KEY must be 32 bytes (64 hex chars)')
  }

  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format (expected iv:authTag:ciphertext)')
  }

  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const ciphertext = Buffer.from(parts[2], 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * Compute the HMAC token for a bridge request (v2).
 * Message format: `${deviceId}.${ts}.${bodySha256}`
 */
export function computeBridgeHMAC(
  deviceId: string,
  ts: number,
  bodySha256: string,
  secret: string,
): string {
  const message = `${deviceId}.${ts}.${bodySha256}`
  return createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * Validate bridge request headers (v2 scheme).
 * Expects: Authorization: Bearer <hmac>, x-berg-ts, x-berg-body-sha256
 */
export function validateBridgeHMAC(
  headers: {
    authorization: string | null
    ts: string | null
    bodySha256: string | null
  },
  deviceId: string,
  secret: string,
): { valid: boolean; reason?: string } {
  const { authorization, ts, bodySha256 } = headers

  if (!authorization?.startsWith('Bearer ')) {
    return { valid: false, reason: 'Missing or malformed Authorization header' }
  }
  if (!ts) {
    return { valid: false, reason: 'Missing x-berg-ts header' }
  }
  if (!bodySha256) {
    return { valid: false, reason: 'Missing x-berg-body-sha256 header' }
  }

  const timestamp = parseInt(ts, 10)
  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp' }
  }

  const skew = Math.abs(Date.now() - timestamp)
  if (skew > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: `Clock skew too large: ${skew}ms (max ${MAX_CLOCK_SKEW_MS}ms)` }
  }

  const receivedHmac = authorization.slice(7)
  const expectedHmac = computeBridgeHMAC(deviceId, timestamp, bodySha256, secret)

  try {
    const expected = Buffer.from(expectedHmac, 'hex')
    const received = Buffer.from(receivedHmac, 'hex')
    if (expected.length !== received.length) {
      return { valid: false, reason: 'HMAC length mismatch' }
    }
    const valid = timingSafeEqual(expected, received)
    return { valid, reason: valid ? undefined : 'HMAC mismatch' }
  } catch {
    return { valid: false, reason: 'HMAC comparison error' }
  }
}

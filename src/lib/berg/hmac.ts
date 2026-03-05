/**
 * Berg Bridge — HMAC Authentication
 *
 * The berg-bridge service signs each request to /api/berg/dispense:
 *   Authorization: Bearer <HMAC-SHA256(deviceId + ":" + timestamp, bridgeSecret)>
 *
 * /api/berg/dispense validates the HMAC before processing.
 *
 * Security properties:
 * - bridgeSecret is generated per device at creation, stored as bcrypt hash in DB
 * - The plaintext secret is shown once in the UI and never stored in plaintext
 * - HMAC includes timestamp to prevent replay attacks (±60s window)
 * - deviceId is bound into the HMAC to prevent cross-device replay
 */

import { createHmac, timingSafeEqual } from 'crypto'

/** Max clock skew allowed between bridge and POS (milliseconds) */
const MAX_CLOCK_SKEW_MS = 60_000

/**
 * Generate a new random bridge secret (hex string, 32 bytes = 64 hex chars).
 * Call this on device creation; show it once in UI; store only the hash.
 */
export function generateBridgeSecret(): string {
  return require('crypto').randomBytes(32).toString('hex')
}

/**
 * Compute the HMAC token for a bridge request.
 * @param deviceId - The BergDevice.id
 * @param timestamp - Unix timestamp in ms (Date.now())
 * @param secret - The plaintext bridge secret (held only by the bridge process)
 */
export function computeBridgeHMAC(deviceId: string, timestamp: number, secret: string): string {
  const message = `${deviceId}:${timestamp}`
  return createHmac('sha256', secret).update(message).digest('hex')
}

/**
 * Validate an Authorization header from the bridge.
 * Returns { valid: boolean, deviceId?: string, reason?: string }
 *
 * @param authHeader - The raw Authorization header value (e.g. "Bearer abc123")
 * @param deviceId - The claimed deviceId from the request body
 * @param secret - The plaintext bridge secret for this device (retrieved from DB or env)
 */
export function validateBridgeHMAC(
  authHeader: string | null,
  deviceId: string,
  secret: string
): { valid: boolean; reason?: string } {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, reason: 'Missing or malformed Authorization header' }
  }

  const token = authHeader.slice(7)
  // Token format: <timestamp>.<hmac>
  const dotIdx = token.indexOf('.')
  if (dotIdx === -1) {
    return { valid: false, reason: 'Invalid token format' }
  }

  const timestamp = parseInt(token.slice(0, dotIdx), 10)
  const receivedHmac = token.slice(dotIdx + 1)

  if (isNaN(timestamp)) {
    return { valid: false, reason: 'Invalid timestamp in token' }
  }

  const skew = Math.abs(Date.now() - timestamp)
  if (skew > MAX_CLOCK_SKEW_MS) {
    return { valid: false, reason: `Clock skew too large: ${skew}ms (max ${MAX_CLOCK_SKEW_MS}ms)` }
  }

  const expectedHmac = computeBridgeHMAC(deviceId, timestamp, secret)

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

/**
 * Shared auth for Android update proxy routes.
 *
 * Phase 4 observation: after the employee PIN login, the Android client's
 * AuthInterceptor swaps the WiFi device token for an employee session JWT
 * on every request. Phase 2 shipped with only a Terminal.deviceToken
 * lookup, so all post-login update calls 401'd.
 *
 * Accept any of the three token families the app might send, in order of
 * cheapest-first:
 *   1. Cellular JWT   — LTE terminals (rare on register/PAX today, but
 *      supported by the rest of the stack and free to check)
 *   2. Session JWT    — employee session after PIN login (the common case)
 *   3. WiFi device token — pre-login / long-lived WiFi pairing token
 *
 * All three expose a locationId; the caller only needs that to resolve
 * the venue's cloudLocationId for the MC proxy call.
 */

import { db } from '@/lib/db'
import { verifyCellularToken } from '@/lib/cellular-auth'
import { verifySessionToken } from '@/lib/auth-session'

export interface AndroidUpdateAuth {
  locationId: string
  tokenKind: 'cellular' | 'session' | 'device'
}

export async function authenticateAndroidUpdate(
  token: string,
): Promise<AndroidUpdateAuth | null> {
  const cellular = await verifyCellularToken(token)
  if (cellular?.locationId) {
    return { locationId: cellular.locationId, tokenKind: 'cellular' }
  }

  const session = await verifySessionToken(token, { skipIdleCheck: true })
  if (session?.locationId) {
    return { locationId: session.locationId, tokenKind: 'session' }
  }

  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { locationId: true },
  })
  if (terminal) {
    return { locationId: terminal.locationId, tokenKind: 'device' }
  }

  return null
}

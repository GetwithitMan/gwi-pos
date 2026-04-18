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

/**
 * LAN-scoped auth path for KDS devices.
 *
 * Decision: `docs/decisions/2026-04-18-kds-update-auth.md` (Option A).
 *
 * `KDSScreen` has no `deviceToken` field and no pairing flow that mints one.
 * KDS's existing `/api/kds?locationId=...&screenId=...` endpoint already
 * trusts LAN + locationId for real-time order data, so the same trust model
 * is acceptable for fleet-update metadata.
 *
 * Returns the NUC's own cloudLocationId on a valid KDS-LAN request;
 * the route uses this directly (skipping `resolveCloudLocationId` because
 * there's no terminal token to key off of).
 *
 * Qualifies only when:
 *   - `app` starts with `KDS_` (KDS_PITBOSS / KDS_FOODKDS / KDS_DELIVERY)
 *   - `cloudLocationId` query param is present AND equals the NUC's own
 *     `CLOUD_LOCATION_ID` env (or cached `Location.cloudLocationId`)
 *
 * Non-KDS apps MUST use Bearer auth; this function returns null for them
 * so the caller falls through to the existing 401 path.
 */
export async function authenticateKdsLanRequest(
  app: string,
  locationIdQueryParam: string | null,
): Promise<{ cloudLocationId: string; tokenKind: 'kds-lan' } | null> {
  if (!app.startsWith('KDS_')) return null
  if (!locationIdQueryParam) return null

  const nucCloudLocationId = await resolveCloudLocationId('')
  if (!nucCloudLocationId) return null

  // Accept either form the device may have stored at pairing time:
  //   - cloud locationId (direct match against the NUC's env)
  //   - local Location.id (translate via DB lookup, then match)
  // KDS pairing historically stores the local id (that's what `/api/kds`
  // uses), but newer venues may store the cloud id directly. Either way,
  // a successful match means the request originates from this NUC's LAN.
  if (locationIdQueryParam === nucCloudLocationId) {
    return { cloudLocationId: nucCloudLocationId, tokenKind: 'kds-lan' }
  }

  const row = await db.location.findUnique({
    where: { id: locationIdQueryParam },
    select: { cloudLocationId: true },
  })
  if (row?.cloudLocationId === nucCloudLocationId) {
    return { cloudLocationId: nucCloudLocationId, tokenKind: 'kds-lan' }
  }

  return null
}

/**
 * Resolve the MC CloudLocation ID for the venue this NUC serves.
 *
 * A NUC is a single-venue appliance. Its identity comes from the installer-
 * populated `.env` (`CLOUD_LOCATION_ID`), which is the canonical source.
 * The DB `Location.cloudLocationId` field is kept in sync by registration /
 * heartbeat but can be NULL on older venues until the next heartbeat
 * refreshes it — the env var is the durable fallback.
 *
 * Returns null only when the NUC has never been paired with MC.
 */
export async function resolveCloudLocationId(
  localLocationId: string,
): Promise<string | null> {
  const envCloudLocationId = process.env.CLOUD_LOCATION_ID?.trim()
  if (envCloudLocationId) {
    return envCloudLocationId
  }

  const row = await db.location.findUnique({
    where: { id: localLocationId },
    select: { cloudLocationId: true },
  })
  return row?.cloudLocationId ?? null
}

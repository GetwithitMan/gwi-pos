import { NextRequest, NextResponse } from 'next/server'
import {
  verifyCellularToken,
  verifyCellularTokenWithGrace,
  issueCellularToken,
  checkIdleTimeout,
  recordActivity,
  checkRateLimit,
} from '@/lib/cellular-auth'
import {
  CELLULAR_ALLOWLIST,
  CELLULAR_HARD_BLOCKED,
  CELLULAR_REAUTH_ROUTES,
  CELLULAR_GRACE_ELIGIBLE_ROUTES,
  matchesRouteList,
} from './route-policies'
import { signAndAttachTenantJwt } from './tenant-signing'

function logCellularBlock(terminalId: string, locationId: string, pathname: string, reason: string): void {
  console.error(JSON.stringify({
    event: 'cellular_request_blocked',
    terminalId,
    locationId,
    pathname,
    reason,
    authDecisionSource: 'proxy',
    timestamp: new Date().toISOString(),
  }))
}

/**
 * Handle cellular terminal authentication.
 *
 * Returns a NextResponse if the request is cellular (either allowed or denied).
 * Returns null if the request is NOT cellular — caller should continue to other handlers.
 */
export async function handleCellularAuth(
  request: NextRequest,
  pathname: string,
): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const explicitCellular = request.headers.get('x-cellular-terminal') === 'true'

  // Auto-detect: if Bearer token is present, try verifying as cellular JWT
  let cellularPayload: Awaited<ReturnType<typeof verifyCellularToken>> = null
  let gracePayload: Awaited<ReturnType<typeof verifyCellularTokenWithGrace>> = null
  let refreshedToken: string | null = null

  if (bearerToken) {
    cellularPayload = await verifyCellularToken(bearerToken)

    // If normal verification failed, check if this is a grace-eligible route
    // with a recently-expired token (outage recovery scenario)
    if (!cellularPayload && (explicitCellular || matchesRouteList(pathname, CELLULAR_GRACE_ELIGIBLE_ROUTES))) {
      gracePayload = await verifyCellularTokenWithGrace(bearerToken)
      if (gracePayload?.expired) {
        // Token is expired but within 4h grace window — issue a fresh token
        try {
          refreshedToken = await issueCellularToken(
            gracePayload.payload.terminalId,
            gracePayload.payload.locationId,
            gracePayload.payload.venueSlug,
            gracePayload.payload.deviceFingerprint,
            gracePayload.payload.terminalRole
          )
          console.warn(JSON.stringify({
            event: 'cellular_grace_token_issued',
            terminalId: gracePayload.payload.terminalId,
            locationId: gracePayload.payload.locationId,
            pathname,
            tokenExpiredAt: new Date(gracePayload.payload.exp * 1000).toISOString(),
            timestamp: new Date().toISOString(),
          }))
        } catch (issueErr) {
          console.error('[proxy] Failed to issue grace token:', issueErr)
        }
      }
    }
  }

  // A request is cellular if: valid token, or explicitly cellular, or grace-verified
  const effectiveCellularPayload = cellularPayload ?? gracePayload?.payload ?? null
  const isCellularRequest = explicitCellular || effectiveCellularPayload !== null

  if (!isCellularRequest) return null

  if (!bearerToken) {
    return NextResponse.json({ error: 'Missing cellular token' }, { status: 401 })
  }

  const payload = effectiveCellularPayload
  if (!payload) {
    return NextResponse.json({ error: 'Invalid or expired cellular token' }, { status: 401 })
  }

  const isGraceAuth = gracePayload?.expired === true

  // Fingerprint check: if JWT contains a fingerprint (set during pairing), always validate
  const fingerprintHeader = request.headers.get('x-device-fingerprint')
  if (payload.deviceFingerprint) {
    if (!fingerprintHeader || fingerprintHeader !== payload.deviceFingerprint) {
      logCellularBlock(payload.terminalId, payload.locationId, pathname, 'fingerprint_missing_or_mismatch')
      return NextResponse.json({ error: 'Device fingerprint missing or invalid' }, { status: 401 })
    }
  }

  // Idle timeout check — skip for grace-auth (device was offline, no activity to record)
  if (!isGraceAuth && checkIdleTimeout(payload.terminalId)) {
    logCellularBlock(payload.terminalId, payload.locationId, pathname, 'idle_timeout')
    return NextResponse.json({ error: 'Session expired due to inactivity' }, { status: 401 })
  }

  // Rate limit: 10 req/s per terminalId
  if (!checkRateLimit(payload.terminalId)) {
    logCellularBlock(payload.terminalId, payload.locationId, pathname, 'rate_limited')
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  // Grace-auth is ONLY allowed on grace-eligible routes (replay + refresh)
  if (isGraceAuth && !matchesRouteList(pathname, CELLULAR_GRACE_ELIGIBLE_ROUTES)) {
    logCellularBlock(payload.terminalId, payload.locationId, pathname, 'grace_not_eligible')
    return NextResponse.json({ error: 'Token expired. Refresh your token first.' }, { status: 401 })
  }

  // Hard-blocked routes (403 — admin, settings, reports, refund, etc.)
  if (matchesRouteList(pathname, CELLULAR_HARD_BLOCKED)) {
    logCellularBlock(payload.terminalId, payload.locationId, pathname, 'hard_blocked')
    return NextResponse.json({ error: 'Route not available for cellular terminals' }, { status: 403 })
  }

  // Allowlisted routes — pass through with terminal context headers
  if (matchesRouteList(pathname, CELLULAR_ALLOWLIST)) {
    recordActivity(payload.terminalId)

    const headers = new Headers(request.headers)
    headers.set('x-terminal-id', payload.terminalId)
    headers.set('x-location-id', payload.locationId)
    headers.set('x-terminal-role', payload.terminalRole)
    headers.set('x-cellular-authenticated', '1')
    headers.set('x-can-refund', String(payload.canRefund))
    // Route to the correct venue database — venueSlug is mandatory
    if (!payload.venueSlug) {
      console.error(`[proxy] cellular token missing venueSlug — cannot resolve venue DB. terminalId=${payload.terminalId} locationId=${payload.locationId}`)
      return NextResponse.json({ error: 'Cellular token missing venueSlug; cannot resolve venue DB. Re-pair the device.' }, { status: 400 })
    }
    headers.set('x-venue-slug', payload.venueSlug)
    headers.set('x-original-path', pathname)
    await signAndAttachTenantJwt(request, headers, payload.venueSlug, payload.locationId)

    // Re-auth required routes: void/comp pass through but flagged
    if (matchesRouteList(pathname, CELLULAR_REAUTH_ROUTES)) {
      headers.set('x-requires-reauth', 'true')
    }

    // If a refreshed token was issued (grace-period auth), attach it as a
    // response header so the Android client can pick it up and store it
    if (refreshedToken) {
      const response = NextResponse.next({ request: { headers } })
      response.headers.set('X-Refreshed-Token', refreshedToken)
      return response
    }

    return NextResponse.next({ request: { headers } })
  }

  // Not on allowlist and not hard-blocked → default deny
  logCellularBlock(payload.terminalId, payload.locationId, pathname, 'not_allowlisted')
  return NextResponse.json({ error: 'Route not available for cellular terminals' }, { status: 403 })
}

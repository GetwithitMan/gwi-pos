import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken, isBlockedInCloudMode } from '@/lib/cloud-auth'
import { verifyAccessToken } from '@/lib/access-gate'
import {
  verifyCellularToken,
  verifyCellularTokenWithGrace,
  issueCellularToken,
  checkIdleTimeout,
  recordActivity,
  checkRateLimit,
} from '@/lib/cellular-auth'
import { signTenantContext, hashBody } from '@/lib/tenant-context-signer'
import { parseBool, parseStationRole, parseNodeEnv } from '@/lib/env-parse'

// ── Edge-safe proxy config ──────────────────────────────────────────────
// All env reads consolidated here. Uses shared parsers from env-parse.ts.
// No direct process.env reads anywhere else in this file.
const proxyConfig = {
  gwiAccessSecret: process.env.GWI_ACCESS_SECRET ?? '',
  tenantJwtEnabled: parseBool(process.env.TENANT_JWT_ENABLED, false),
  tenantSigningKey: process.env.TENANT_SIGNING_KEY || '',
  missionControlUrl: process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com',
  provisionApiKey: process.env.PROVISION_API_KEY || '',
  isNucStation: !!process.env.STATION_ROLE,
  stationRole: parseStationRole(process.env.STATION_ROLE),
  nodeEnv: parseNodeEnv(process.env.NODE_ENV),
} as const

// Fail-fast: PROVISION_API_KEY is required in production cloud deployments.
// NUC stations use PIN-based auth and never serve cloud subdomain requests.
if (!proxyConfig.provisionApiKey && proxyConfig.nodeEnv === 'production' && !proxyConfig.isNucStation) {
  throw new Error('[Startup] PROVISION_API_KEY environment variable is required in production')
}

/**
 * Multi-tenant proxy with cloud auth enforcement.
 *
 * Two modes:
 *
 * CLOUD MODE (*.ordercontrolcenter.com, *.barpos.restaurant):
 *   - Requires signed JWT from Mission Control
 *   - Admin/settings pages only (POS ordering blocked)
 *   - Session stored in httpOnly cookie
 *
 * LOCAL MODE (localhost, NUC server IP):
 *   - Standard PIN-based auth
 *   - Full POS access (ordering, KDS, etc.)
 *   - No cloud session required
 */

const MAIN_HOSTNAMES = new Set([
  'localhost',
  'gwi-pos.vercel.app',
  'barpos.restaurant',
  'www.barpos.restaurant',
  'ordercontrolcenter.com',
  'www.ordercontrolcenter.com',
])

/** Check if hostname is a private/local IP (terminals connecting to NUC server) */
function isLocalNetworkHost(hostname: string): boolean {
  // IPv4 private ranges: 10.x, 172.16-31.x, 192.168.x, 127.x
  if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.)/.test(hostname)) return true
  // IPv6 loopback
  if (hostname === '::1') return true
  return false
}

/** Parent domains that support venue subdomains */
const VENUE_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

/** Cloud venue domains (owner admin access via MC) */
const CLOUD_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

function isVercelPreview(hostname: string): boolean {
  return hostname.endsWith('.vercel.app') && hostname !== 'gwi-pos.vercel.app'
}

function extractVenueSlug(hostname: string): string | null {
  for (const parent of VENUE_PARENT_DOMAINS) {
    if (hostname.endsWith(parent)) {
      const slug = hostname.slice(0, -parent.length)
      if (slug && !slug.includes('.') && slug !== 'www') {
        return slug
      }
    }
  }
  return null
}

/** Check if hostname is a cloud venue (not localhost or local network) */
function isCloudVenueHost(hostname: string): boolean {
  for (const parent of CLOUD_PARENT_DOMAINS) {
    if (hostname.endsWith(parent)) {
      const slug = hostname.slice(0, -parent.length)
      if (slug && !slug.includes('.') && slug !== 'www') {
        return true
      }
    }
  }
  return false
}

/**
 * Online ordering paths: /:orderCode/:slug[/...]
 *
 * Pattern: 4–8 uppercase alphanumeric chars followed by a lowercase slug.
 * Example: /ABC123/my-venue or /ABC123/my-venue/confirm
 *
 * These are customer-facing public pages — no auth cookies required.
 * We extract the slug from the path and pass it via x-venue-slug so that
 * the page component can call /api/public/resolve-order-code to get the
 * locationId without triggering the authenticated proxy flow.
 */
const ONLINE_ORDER_PATH_RE = /^\/([A-Z0-9]{4,8})\/([a-z0-9-]+)(\/.*)?$/

/**
 * Public API paths that must never be blocked by cloud auth.
 * /api/online/* and /api/public/* are already behind locationId-based
 * isolation — no venue session required.
 */
const PUBLIC_API_PATH_RE = /^\/api\/(online|public)\//

// ═══════════════════════════════════════════════════════════
// Cellular terminal route policies
// ═══════════════════════════════════════════════════════════

/** Routes allowed for cellular terminals */
const CELLULAR_ALLOWLIST: Array<string | RegExp> = [
  /^\/api\/orders$/,                           // GET list, POST create
  /^\/api\/orders\/[^/]+$/,                    // GET single order
  /^\/api\/orders\/[^/]+\/items$/,             // POST add items
  /^\/api\/orders\/[^/]+\/send$/,              // POST send to kitchen
  /^\/api\/orders\/[^/]+\/pay$/,               // POST payment
  /^\/api\/orders\/replay-cart-events$/,       // POST cart replay
  /^\/api\/menu(\/|$)/,         // read-only menu access
  /^\/api\/sync(\/|$)/,         // all sync endpoints (bootstrap, delta, events, floor-plan, outbox)
  /^\/api\/order-events(\/|$)/, // event-sourced order mutations (batch)
  /^\/api\/auth\/login(\/|$)/,      // PIN login
  /^\/api\/auth\/verify-pin(\/|$)/, // PIN verification for operations (voids, comps, etc.)
  /^\/api\/session(\/|$)/,      // session bootstrap
  /^\/api\/employees(\/|$)/,    // employee list for display
  '/api/barcode/lookup',        // barcode scanning
  '/api/auth/refresh-cellular', // token refresh
  /^\/api\/health(\/|$)/,       // health check
]

/** Routes hard-blocked for CELLULAR_ROAMING (403 always) */
const CELLULAR_HARD_BLOCKED: Array<string | RegExp> = [
  /^\/api\/orders\/[^/]+\/refund/,
  /^\/api\/orders\/[^/]+\/adjust-tip/,
  /^\/api\/orders\/[^/]+\/split/,
  /^\/api\/orders\/[^/]+\/merge/,
  /^\/api\/shifts\/[^/]+\/close/,
  /^\/api\/(admin|settings|reports)(\/|$)/,
  /^\/api\/inventory(\/|$)/,
  /^\/api\/integrations(\/|$)/,
  /^\/api\/dashboard(\/|$)/,
  /^\/api\/cron(\/|$)/,
  /^\/api\/internal(\/|$)/,
  /^\/api\/fleet(\/|$)/,
]

/** Routes that require re-auth (pass through but flagged) */
const CELLULAR_REAUTH_ROUTES: RegExp[] = [
  /^\/api\/orders\/[^/]+\/void/,
  /^\/api\/orders\/[^/]+\/comp/,
]

/**
 * Routes eligible for expired-token grace period.
 *
 * These are outage-recovery replay endpoints used by Android workers
 * (CartOutboxWorker, PaymentReconciliationWorker). When the JWT is expired
 * but within the 4-hour grace window, the proxy:
 *   1. Allows the request through (with x-cellular-authenticated headers)
 *   2. Issues a fresh token and attaches it as X-Refreshed-Token response header
 *   3. Logs the grace event for audit
 *
 * The Android client reads X-Refreshed-Token and stores the new JWT for
 * subsequent requests, self-healing without requiring a re-pair.
 */
const CELLULAR_GRACE_ELIGIBLE_ROUTES: Array<string | RegExp> = [
  /^\/api\/orders\/replay-cart-events$/,  // CartOutboxWorker replay
  /^\/api\/orders\/[^/]+\/pay$/,          // PaymentReconciliationWorker replay
  '/api/auth/refresh-cellular',           // Token refresh itself
]

/**
 * Normalize a URL path by resolving `.` and `..` segments.
 *
 * Next.js `request.nextUrl.pathname` already normalizes via the WHATWG URL
 * constructor, but we normalize explicitly as defense-in-depth: if any
 * upstream layer ever passes a raw path, traversal sequences like
 * `/api/orders/../../admin/settings` cannot bypass the allowlist/blocklist.
 */
function normalizePath(pathname: string): string {
  const segments = pathname.split('/').filter(s => s !== '' && s !== '.')
  const normalized: string[] = []
  for (const seg of segments) {
    if (seg === '..') {
      normalized.pop()
    } else {
      normalized.push(seg)
    }
  }
  return '/' + normalized.join('/')
}

function matchesRouteList(pathname: string, routes: Array<string | RegExp>): boolean {
  const safe = normalizePath(pathname)
  for (const route of routes) {
    if (typeof route === 'string') {
      if (safe === route) return true
    } else {
      if (route.test(safe)) return true
    }
  }
  return false
}

/**
 * Sign tenant context JWT and attach to request headers.
 * Only active when TENANT_JWT_ENABLED=true.
 * For mutating methods, hashes the request body for integrity binding.
 */
async function signAndAttachTenantJwt(
  request: NextRequest,
  headers: Headers,
  venueSlug: string,
  locationId: string,
): Promise<void> {
  if (!proxyConfig.tenantJwtEnabled) return
  if (!proxyConfig.tenantSigningKey) {
    console.warn('[proxy] TENANT_JWT_ENABLED=true but no signing key — skipping JWT')
    return
  }

  const method = request.method
  const path = request.nextUrl.pathname
  let bodySha256: string | undefined

  // Hash body for mutating methods — use clone() to preserve the original
  // body stream for downstream route handlers.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    try {
      const body = await request.clone().text()
      if (body) {
        bodySha256 = await hashBody(body)
      }
    } catch {
      // Body may not be available — skip hash
    }
  }

  try {
    const jwt = await signTenantContext(
      { venueSlug, locationId: locationId || '', method, path, bodySha256 },
      proxyConfig.tenantSigningKey,
    )
    headers.set('x-tenant-context', jwt)
    // Pass body digest as a trusted internal header so with-venue can verify
    // the JWT's bodySha256 claim without re-reading the request body.
    if (bodySha256) {
      headers.set('x-tenant-body-hash', bodySha256)
    }
  } catch (err) {
    console.error('[proxy] Failed to sign tenant context:', err)
  }
}

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

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0]
  const pathname = request.nextUrl.pathname

  // ═══════════════════════════════════════════════════════════
  // FENCED NODE CHECK (STONITH-lite)
  //
  // If this node has been fenced by the new primary (via
  // /api/internal/ha-fence), reject all write requests with 503.
  // Read-only requests (GET/HEAD) still pass so health checks
  // and diagnostics remain functional.
  // ═══════════════════════════════════════════════════════════
  if (proxyConfig.stationRole === 'fenced') {
    // Allow the fence endpoint itself through so STONITH can get acknowledgment
    const isFenceEndpoint = pathname === '/api/internal/ha-fence'
    if (!isFenceEndpoint && request.method !== 'GET' && request.method !== 'HEAD') {
      return NextResponse.json(
        { error: 'This server has been fenced. Please reconnect to the primary.' },
        { status: 503 }
      )
    }
  }

  // ═══════════════════════════════════════════════════════════
  // EARLY BYPASS: Online ordering customer pages + public APIs
  //
  // These paths are served without authentication so that
  // customers can browse menus and place orders.
  // ═══════════════════════════════════════════════════════════
  const onlineOrderMatch = ONLINE_ORDER_PATH_RE.exec(pathname)
  if (onlineOrderMatch) {
    // onlineOrderMatch[2] is the slug portion of the path
    const slugFromPath = onlineOrderMatch[2]
    const headers = new Headers(request.headers)
    headers.set('x-venue-slug', slugFromPath)
    headers.set('x-original-path', pathname)
    await signAndAttachTenantJwt(request, headers, slugFromPath, '')
    return NextResponse.next({ request: { headers } })
  }

  if (PUBLIC_API_PATH_RE.test(pathname)) {
    // Public APIs need no venue context — pass through unmodified
    return NextResponse.next()
  }

  // Allow cellular nonce exchange without auth (nonce IS the credential)
  if (pathname === '/api/auth/cellular-exchange') {
    return NextResponse.next()
  }

  // ═══════════════════════════════════════════════════════════
  // CELLULAR TERMINAL AUTH
  //
  // Cellular terminals (LTE/5G) authenticate via Bearer JWT.
  // Detection: explicit x-cellular-terminal header OR Bearer token
  // that verifies as a valid cellular JWT (auto-detect).
  // This check runs BEFORE cloud/local auth so cellular requests
  // never hit cookie checks. No DB queries — all in-memory.
  // ═══════════════════════════════════════════════════════════
  const authHeader = request.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const explicitCellular = request.headers.get('x-cellular-terminal') === 'true'

  // Auto-detect: if Bearer token is present, try verifying as cellular JWT
  // This allows cellular terminals to work without x-cellular-terminal header
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
        // to send back via X-Refreshed-Token header
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
          // Continue without refreshed token — the request will still go through
        }
      }
    }
  }

  // A request is cellular if: valid token, or explicitly cellular, or grace-verified
  const effectiveCellularPayload = cellularPayload ?? gracePayload?.payload ?? null
  const isCellularRequest = explicitCellular || effectiveCellularPayload !== null

  if (isCellularRequest) {
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
      // for subsequent requests — self-healing without explicit refresh call.
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

  // ═══════════════════════════════════════════════════════════
  // GWI ACCESS GATE FOR www.barpos.restaurant (demo domain)
  //
  // The main demo domain is not a cloud venue subdomain, so the
  // cloud-mode gate below won't catch it. Apply the SMS OTP gate
  // here before any other routing logic.
  // ═══════════════════════════════════════════════════════════
  if (
    (hostname === 'www.barpos.restaurant' || hostname === 'barpos.restaurant') &&
    proxyConfig.gwiAccessSecret
  ) {
    // Always allow: the access gate page itself, its API routes,
    // auth routes (forgot/reset password), and internal admin API routes
    if (
      pathname === '/access' ||
      pathname.startsWith('/api/access/') ||
      pathname.startsWith('/api/admin/') ||
      pathname === '/api/auth/forgot-password' ||
      pathname === '/api/auth/reset-password'
    ) {
      return NextResponse.next()
    }

    const accessToken = request.cookies.get('gwi-access')?.value
    const accessPayload = accessToken
      ? await verifyAccessToken(accessToken, proxyConfig.gwiAccessSecret)
      : null

    if (!accessPayload) {
      const gateUrl = new URL('/access', request.url)
      gateUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(gateUrl)
    }

    // Refresh the session cookie on every request — resets the 1-hour
    // inactivity clock so active users stay logged in automatically.
    const { signAccessToken } = await import('@/lib/access-gate')
    const freshToken = await signAccessToken(accessPayload.email, proxyConfig.gwiAccessSecret)
    const response = NextResponse.next()
    response.cookies.set('gwi-access', freshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 60 * 60,
      path: '/',
    })
    return response
  }

  const isCloud = isCloudVenueHost(hostname)
  const venueSlug = extractVenueSlug(hostname)

  // ═══════════════════════════════════════════════════════════
  // CLOUD MODE: Authenticated admin access only
  // Only approved users from Mission Control can access
  // ═══════════════════════════════════════════════════════════
  if (isCloud && venueSlug) {
    // Always allow: SMS access gate + auth endpoints (no session required)
    if (
      pathname === '/access' ||
      pathname.startsWith('/api/access/') ||
      pathname === '/auth/cloud' ||
      pathname.startsWith('/api/auth/cloud') ||
      pathname === '/admin-login' ||
      pathname.startsWith('/api/auth/venue-login') ||
      pathname.startsWith('/api/auth/venue-setup') ||
      pathname === '/auth/owner' ||
      pathname.startsWith('/api/auth/owner-session') ||
      pathname === '/api/auth/forgot-password' ||
      pathname === '/api/auth/reset-password' ||
      // Internal MC→POS endpoints — authenticated via x-api-key, not session cookie
      pathname.startsWith('/api/internal/')
    ) {
      const headers = new Headers(request.headers)
      headers.set('x-venue-slug', venueSlug)
      headers.set('x-original-path', pathname)
      headers.set('x-cloud-mode', '1')
      await signAndAttachTenantJwt(request, headers, venueSlug, '')
      return NextResponse.next({ request: { headers } })
    }

    // ── GWI ACCESS GATE (T-070) ─────────────────────────────────
    // Only for *.barpos.restaurant (demo domain). Production venues
    // at *.ordercontrolcenter.com skip this — they only need the
    // pos-cloud-session cookie from venue-login / cloud auth.
    const isBarposDomain = hostname.endsWith('.barpos.restaurant')
    if (proxyConfig.gwiAccessSecret && isBarposDomain) {
      const accessToken = request.cookies.get('gwi-access')?.value
      const accessPayload = accessToken
        ? await verifyAccessToken(accessToken, proxyConfig.gwiAccessSecret)
        : null

      if (!accessPayload) {
        const gateUrl = new URL('/access', request.url)
        gateUrl.searchParams.set('next', pathname)
        return NextResponse.redirect(gateUrl)
      }
    }
    // ─────────────────────────────────────────────────────────────

    // Check for cloud session cookie
    const sessionToken = request.cookies.get('pos-cloud-session')?.value

    if (!sessionToken) {
      // No session → redirect to venue-local admin login
      return NextResponse.redirect(new URL('/admin-login', request.url))
    }

    // Validate JWT token (signature + expiry + slug match)
    const payload = await verifyCloudToken(sessionToken, proxyConfig.provisionApiKey)

    if (!payload || payload.slug !== venueSlug) {
      // Invalid or expired session → clear cookie, redirect to admin-login
      const response = NextResponse.redirect(new URL('/admin-login', request.url))
      response.cookies.delete('pos-cloud-session')
      return response
    }

    // Block POS front-of-house routes (ordering, KDS, tabs, etc.)
    if (
      pathname === '/' ||
      pathname === '/login' ||
      isBlockedInCloudMode(pathname)
    ) {
      return NextResponse.redirect(new URL('/settings', request.url))
    }

    // Allow admin routes with venue context headers
    const headers = new Headers(request.headers)
    headers.set('x-venue-slug', venueSlug)
    headers.set('x-original-path', pathname)
    headers.set('x-cloud-mode', '1')
    await signAndAttachTenantJwt(request, headers, venueSlug, payload.posLocationId || '')
    return NextResponse.next({ request: { headers } })
  }

  // ═══════════════════════════════════════════════════════════
  // LOCAL MODE: Standard POS with PIN auth
  // Full access to all routes (ordering, KDS, admin, etc.)
  // ═══════════════════════════════════════════════════════════
  let localVenueSlug: string | null = null

  if (!MAIN_HOSTNAMES.has(hostname) && !isVercelPreview(hostname) && !isLocalNetworkHost(hostname)) {
    localVenueSlug = extractVenueSlug(hostname)

    if (!localVenueSlug) {
      const parts = hostname.split('.')
      if (parts.length >= 3) {
        localVenueSlug = parts[0]
      } else if (parts.length === 2 && parts[1] === 'localhost') {
        localVenueSlug = parts[0]
      }
    }
  }

  if (localVenueSlug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(localVenueSlug)) {
    const headers = new Headers(request.headers)
    headers.set('x-venue-slug', localVenueSlug)
    headers.set('x-original-path', pathname)
    await signAndAttachTenantJwt(request, headers, localVenueSlug, '')
    return NextResponse.next({ request: { headers } })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

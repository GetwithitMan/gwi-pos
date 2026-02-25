import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken, isBlockedInCloudMode } from '@/lib/cloud-auth'
import { verifyAccessToken } from '@/lib/access-gate'

const GWI_ACCESS_SECRET = process.env.GWI_ACCESS_SECRET ?? ''

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

const MISSION_CONTROL_URL =
  process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
// PROVISION_API_KEY is only needed for cloud deployments (Vercel) to verify
// pos-cloud-session JWTs. NUC stations (identified by STATION_ROLE) use
// PIN-based auth and never serve cloud subdomain requests.
const IS_NUC_STATION = !!process.env.STATION_ROLE
if (!process.env.PROVISION_API_KEY && process.env.NODE_ENV === 'production' && !IS_NUC_STATION) {
  throw new Error('[Startup] PROVISION_API_KEY environment variable is required in production')
}
const PROVISION_API_KEY = process.env.PROVISION_API_KEY || ''

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

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0]
  const pathname = request.nextUrl.pathname

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
    return NextResponse.next({ request: { headers } })
  }

  if (PUBLIC_API_PATH_RE.test(pathname)) {
    // Public APIs need no venue context — pass through unmodified
    return NextResponse.next()
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
    GWI_ACCESS_SECRET
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
      ? await verifyAccessToken(accessToken, GWI_ACCESS_SECRET)
      : null

    if (!accessPayload) {
      const gateUrl = new URL('/access', request.url)
      gateUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(gateUrl)
    }

    // Refresh the session cookie on every request — resets the 1-hour
    // inactivity clock so active users stay logged in automatically.
    const { signAccessToken } = await import('@/lib/access-gate')
    const freshToken = await signAccessToken(accessPayload.email, GWI_ACCESS_SECRET)
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
      headers.set('x-cloud-mode', '1')
      return NextResponse.next({ request: { headers } })
    }

    // ── GWI ACCESS GATE (T-070) ─────────────────────────────────
    // Only for *.barpos.restaurant (demo domain). Production venues
    // at *.ordercontrolcenter.com skip this — they only need the
    // pos-cloud-session cookie from venue-login / cloud auth.
    const isBarposDomain = hostname.endsWith('.barpos.restaurant')
    if (GWI_ACCESS_SECRET && isBarposDomain) {
      const accessToken = request.cookies.get('gwi-access')?.value
      const accessPayload = accessToken
        ? await verifyAccessToken(accessToken, GWI_ACCESS_SECRET)
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
    const payload = await verifyCloudToken(sessionToken, PROVISION_API_KEY)

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
    headers.set('x-cloud-mode', '1')
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

import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken, isBlockedInCloudMode } from '@/lib/cloud-auth'

/**
 * Multi-tenant middleware with cloud auth enforcement.
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

export async function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0]
  const pathname = request.nextUrl.pathname

  const isCloud = isCloudVenueHost(hostname)
  const venueSlug = extractVenueSlug(hostname)

  // ═══════════════════════════════════════════════════════════
  // CLOUD MODE: Authenticated admin access only
  // Only approved users from Mission Control can access
  // ═══════════════════════════════════════════════════════════
  if (isCloud && venueSlug) {
    // Always allow: cloud auth endpoint (creates the session)
    if (
      pathname === '/auth/cloud' ||
      pathname.startsWith('/api/auth/cloud')
    ) {
      const headers = new Headers(request.headers)
      headers.set('x-venue-slug', venueSlug)
      headers.set('x-cloud-mode', '1')
      return NextResponse.next({ request: { headers } })
    }

    // Check for cloud session cookie
    const sessionToken = request.cookies.get('pos-cloud-session')?.value

    if (!sessionToken) {
      // No session → redirect to Mission Control for authentication
      return NextResponse.redirect(
        `${MISSION_CONTROL_URL}/pos-access/${venueSlug}`
      )
    }

    // Validate JWT token (signature + expiry + slug match)
    const payload = await verifyCloudToken(sessionToken, PROVISION_API_KEY)

    if (!payload || payload.slug !== venueSlug) {
      // Invalid or expired session → clear cookie, redirect to MC
      const response = NextResponse.redirect(
        `${MISSION_CONTROL_URL}/pos-access/${venueSlug}`
      )
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

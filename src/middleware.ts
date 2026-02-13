import { NextRequest, NextResponse } from 'next/server'

/**
 * Multi-tenant middleware: extracts venue slug from subdomain
 * and injects it as a request header for downstream API routes.
 *
 * joes-bar.ordercontrolcenter.com → x-venue-slug: "joes-bar"
 * joes-bar.barpos.restaurant      → x-venue-slug: "joes-bar"
 * barpos.restaurant               → no header (master/demo database)
 * gwi-pos.vercel.app              → no header (master/demo database)
 * localhost:3000                   → no header (master/demo database)
 * joes-bar.localhost:3000          → x-venue-slug: "joes-bar" (dev testing)
 */

const MAIN_HOSTNAMES = new Set([
  'localhost',
  'gwi-pos.vercel.app',
  'barpos.restaurant',
  'www.barpos.restaurant',
  'ordercontrolcenter.com',
  'www.ordercontrolcenter.com',
])

/** Parent domains that support venue subdomains */
const VENUE_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

function isVercelPreview(hostname: string): boolean {
  // Vercel preview deployments: gwi-xxx-brians-projects-xxx.vercel.app
  return hostname.endsWith('.vercel.app') && hostname !== 'gwi-pos.vercel.app'
}

function extractVenueSlug(hostname: string): string | null {
  // Check each parent domain for a subdomain prefix
  for (const parent of VENUE_PARENT_DOMAINS) {
    if (hostname.endsWith(parent)) {
      const slug = hostname.slice(0, -parent.length)
      // Only single-level subdomains (no dots), skip www
      if (slug && !slug.includes('.') && slug !== 'www') {
        return slug
      }
    }
  }
  return null
}

export function middleware(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0] // Strip port (localhost:3000 → localhost)

  let venueSlug: string | null = null

  if (!MAIN_HOSTNAMES.has(hostname) && !isVercelPreview(hostname)) {
    // Try known parent domains first
    venueSlug = extractVenueSlug(hostname)

    // Fallback: generic subdomain detection
    if (!venueSlug) {
      const parts = hostname.split('.')
      if (parts.length >= 3) {
        venueSlug = parts[0]
      } else if (parts.length === 2 && parts[1] === 'localhost') {
        // Dev mode: joes-bar.localhost:3000 → joes-bar
        venueSlug = parts[0]
      }
    }
  }

  // Only set header for valid venue slugs (lowercase alphanumeric + hyphens)
  if (venueSlug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(venueSlug)) {
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-venue-slug', venueSlug)

    return NextResponse.next({
      request: { headers: requestHeaders },
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

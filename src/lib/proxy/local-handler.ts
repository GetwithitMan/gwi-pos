import { NextRequest, NextResponse } from 'next/server'
import { MAIN_HOSTNAMES, isVercelPreview, isLocalNetworkHost, extractVenueSlug } from './host-detection'
import { signAndAttachTenantJwt } from './tenant-signing'

/**
 * Handle local mode: standard POS with PIN auth.
 * Full access to all routes (ordering, KDS, admin, etc.)
 *
 * Returns a NextResponse with venue headers if a local venue slug is detected.
 * Returns null if no local slug — caller should pass through.
 */
export async function handleLocalMode(
  request: NextRequest,
  hostname: string,
  pathname: string,
): Promise<NextResponse | null> {
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

  return null
}

import { NextRequest, NextResponse } from 'next/server'
import { proxyConfig } from '@/lib/proxy/proxy-config'
import { extractVenueSlug, isCloudVenueHost } from '@/lib/proxy/host-detection'
import { ONLINE_ORDER_PATH_RE, PUBLIC_API_PATH_RE } from '@/lib/proxy/route-policies'
import { signAndAttachTenantJwt } from '@/lib/proxy/tenant-signing'
import { handleCellularAuth } from '@/lib/proxy/cellular-handler'
import { handleAccessGate, handleCloudMode } from '@/lib/proxy/cloud-handler'
import { handleLocalMode } from '@/lib/proxy/local-handler'

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
export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') || ''
  const hostname = host.split(':')[0]
  const pathname = request.nextUrl.pathname

  // Generate request ID at edge — flows through to server.ts via request headers.
  // All handlers that create `new Headers(request.headers)` inherit this automatically.
  // server.ts reads `req.headers['x-request-id']` and stores it in AsyncLocalStorage.
  if (!request.headers.get('x-request-id')) {
    try { request.headers.set('x-request-id', crypto.randomUUID()) } catch { /* immutable in some runtimes */ }
  }

  // ═══════════════════════════════════════════════════════════
  // FENCED NODE CHECK (STONITH-lite)
  // ═══════════════════════════════════════════════════════════
  if (proxyConfig.stationRole === 'fenced') {
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
  // ═══════════════════════════════════════════════════════════
  const onlineOrderMatch = ONLINE_ORDER_PATH_RE.exec(pathname)
  if (onlineOrderMatch) {
    const slugFromPath = onlineOrderMatch[2]
    const headers = new Headers(request.headers)
    headers.set('x-venue-slug', slugFromPath)
    headers.set('x-original-path', pathname)
    await signAndAttachTenantJwt(request, headers, slugFromPath, '')
    return NextResponse.next({ request: { headers } })
  }

  if (PUBLIC_API_PATH_RE.test(pathname)) {
    return NextResponse.next()
  }

  // Allow installer files to be served without auth (NUC curl bootstrap)
  if (pathname.startsWith('/installer') || pathname === '/install.sh' || pathname === '/schema.sql' || pathname === '/version-contract.json') {
    return NextResponse.next()
  }

  // Allow cellular nonce exchange without auth (nonce IS the credential)
  if (pathname === '/api/auth/cellular-exchange') {
    return NextResponse.next()
  }

  // ═══════════════════════════════════════════════════════════
  // CELLULAR TERMINAL AUTH
  // ═══════════════════════════════════════════════════════════
  const cellularResponse = await handleCellularAuth(request, pathname)
  if (cellularResponse) return cellularResponse

  // ═══════════════════════════════════════════════════════════
  // GWI ACCESS GATE FOR www.barpos.restaurant (demo domain)
  // ═══════════════════════════════════════════════════════════
  const accessGateResponse = await handleAccessGate(request, hostname, pathname)
  if (accessGateResponse) return accessGateResponse

  // ═══════════════════════════════════════════════════════════
  // CLOUD MODE: Authenticated admin access only
  // ═══════════════════════════════════════════════════════════
  const isCloud = isCloudVenueHost(hostname)
  const venueSlug = extractVenueSlug(hostname)

  if (isCloud && venueSlug) {
    const cloudResponse = await handleCloudMode(request, hostname, pathname, venueSlug)
    if (cloudResponse) return cloudResponse
  }

  // ═══════════════════════════════════════════════════════════
  // LOCAL MODE: Standard POS with PIN auth
  // ═══════════════════════════════════════════════════════════
  const localResponse = await handleLocalMode(request, hostname, pathname)
  if (localResponse) return localResponse

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Match all paths except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

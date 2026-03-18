import { NextRequest, NextResponse } from 'next/server'
import { verifyCloudToken, isBlockedInCloudMode } from '@/lib/cloud-auth'
import { verifyAccessToken } from '@/lib/access-gate'
import { proxyConfig } from './proxy-config'
import { signAndAttachTenantJwt } from './tenant-signing'

/**
 * Handle GWI access gate for www.barpos.restaurant (demo domain).
 *
 * Returns a NextResponse if the gate applies (redirect or pass-through).
 * Returns null if not applicable — caller should continue to other handlers.
 */
export async function handleAccessGate(
  request: NextRequest,
  hostname: string,
  pathname: string,
): Promise<NextResponse | null> {
  if (
    (hostname !== 'www.barpos.restaurant' && hostname !== 'barpos.restaurant') ||
    !proxyConfig.gwiAccessSecret
  ) {
    return null
  }

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

/**
 * Handle cloud mode authentication for venue subdomains.
 *
 * Returns a NextResponse if in cloud mode (auth pass/fail).
 * Returns null if not a cloud venue — caller should continue.
 */
export async function handleCloudMode(
  request: NextRequest,
  hostname: string,
  pathname: string,
  venueSlug: string,
): Promise<NextResponse | null> {
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
    // Internal MC->POS endpoints — authenticated via x-api-key, not session cookie
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

  // Check for cloud session cookie
  const sessionToken = request.cookies.get('pos-cloud-session')?.value

  if (!sessionToken) {
    // No session -> redirect to venue-local admin login
    return NextResponse.redirect(new URL('/admin-login', request.url))
  }

  // Validate JWT token (signature + expiry + slug match)
  const payload = await verifyCloudToken(sessionToken, proxyConfig.provisionApiKey)

  if (!payload || payload.slug !== venueSlug) {
    // Invalid or expired session -> clear cookie, redirect to admin-login
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

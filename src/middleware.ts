import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

/**
 * Next.js Edge Middleware — CORS enforcement for REST API routes.
 *
 * Socket.io CORS is handled separately in socket-server.ts.
 * This middleware covers /api/* routes served by Next.js.
 *
 * On NUC (LAN), ALLOWED_ORIGINS is typically unset — all origins are allowed
 * because the POS server is only reachable on the local network.
 * On Vercel (cloud), ALLOWED_ORIGINS should be set to restrict access.
 */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Only apply CORS headers to API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const origin = request.headers.get('origin')
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean) ?? []

  // Handle preflight (OPTIONS) requests
  if (request.method === 'OPTIONS') {
    const preflightResponse = new NextResponse(null, { status: 204 })
    if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
      preflightResponse.headers.set('Access-Control-Allow-Origin', origin)
    }
    preflightResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    preflightResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-venue-slug, x-terminal-id')
    preflightResponse.headers.set('Access-Control-Max-Age', '86400')
    return preflightResponse
  }

  // For actual requests, set CORS headers on the response
  const response = NextResponse.next()
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    response.headers.set('Access-Control-Allow-Origin', origin)
  }

  return response
}

export const config = {
  matcher: '/api/:path*',
}

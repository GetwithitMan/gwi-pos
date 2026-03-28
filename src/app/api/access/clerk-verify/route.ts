import { NextRequest, NextResponse } from 'next/server'
import { verifyWithClerk } from '@/lib/clerk-verify'
import { signAccessToken } from '@/lib/access-gate'
import { isEmailAllowed } from '@/lib/access-allowlist'
import { err, forbidden, unauthorized } from '@/lib/api-response'

/**
 * POST /api/access/clerk-verify
 *
 * Verifies email + password against Clerk FAPI and issues a gwi-access
 * session cookie. Also checks the GWI Access allowlist — removing
 * someone from the allowlist blocks future logins.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email, password } = body

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return err('Email and password required')
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check allowlist first — deleting from allowlist blocks access
  const allowed = await isEmailAllowed(normalizedEmail)
  if (!allowed) {
    return forbidden('Access not authorized. Contact your administrator.')
  }

  const clerkValid = await verifyWithClerk(normalizedEmail, password)
  if (!clerkValid) {
    return unauthorized('Invalid email or password')
  }

  const secret = process.env.GWI_ACCESS_SECRET
  if (!secret) {
    console.error('[clerk-verify] GWI_ACCESS_SECRET not configured')
    return err('Server misconfigured', 500)
  }

  const token = await signAccessToken(normalizedEmail, secret)

  // Sanitize redirect — must be same-origin leading-slash path, not the access page itself
  let next = request.nextUrl.searchParams.get('next') || '/'
  if (!next.startsWith('/') || next === '/access' || next.startsWith('/access?')) {
    next = '/'
  }
  const response = NextResponse.json({ redirect: next })
  response.cookies.set('gwi-access', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 3600,
    path: '/',
  })

  return response
}

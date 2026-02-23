import { NextRequest, NextResponse } from 'next/server'
import { verifyWithClerk } from '@/lib/clerk-verify'
import { signAccessToken } from '@/lib/access-gate'
import { isEmailAllowed } from '@/lib/access-allowlist'

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
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check allowlist first — deleting from allowlist blocks access
  const allowed = await isEmailAllowed(normalizedEmail)
  if (!allowed) {
    return NextResponse.json({ error: 'Access not authorized. Contact your administrator.' }, { status: 403 })
  }

  const clerkValid = await verifyWithClerk(normalizedEmail, password)
  if (!clerkValid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const secret = process.env.GWI_ACCESS_SECRET
  if (!secret) {
    console.error('[clerk-verify] GWI_ACCESS_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
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

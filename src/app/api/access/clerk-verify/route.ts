import { NextRequest, NextResponse } from 'next/server'
import { verifyWithClerk } from '@/lib/clerk-verify'
import { signAccessToken } from '@/lib/access-gate'

/**
 * POST /api/access/clerk-verify
 *
 * Verifies email + password against Clerk FAPI and issues a gwi-access
 * session cookie. Replaces the old phone + OTP verification flow.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email, password } = body

  if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const clerkValid = await verifyWithClerk(email.trim().toLowerCase(), password)
  if (!clerkValid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const secret = process.env.GWI_ACCESS_SECRET
  if (!secret) {
    console.error('[clerk-verify] GWI_ACCESS_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const token = await signAccessToken(email.trim().toLowerCase(), secret)

  const next = request.nextUrl.searchParams.get('next') || '/'
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

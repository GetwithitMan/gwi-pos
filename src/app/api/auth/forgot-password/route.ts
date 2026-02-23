import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'

function getClerkFapiUrl(): string {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
  if (!pk) return ''
  try {
    const base64 = pk.replace(/^pk_(test|live)_/, '')
    const decoded = Buffer.from(base64, 'base64').toString('utf8').replace(/\$$/, '')
    return `https://${decoded}`
  } catch {
    return ''
  }
}

/**
 * POST /api/auth/forgot-password
 *
 * Initiates a Clerk password reset via FAPI reset_password_email_code strategy.
 * Clerk sends a 6-digit code to the owner's email.
 * Returns { signInId } which the client needs to call /api/auth/reset-password.
 *
 * Also sets a `clerk-reset-client` httpOnly cookie carrying the Clerk __client
 * token. The browser forwards this cookie automatically on the subsequent
 * reset-password call, so Clerk FAPI can associate the two requests.
 *
 * No auth required — public endpoint (in cloud mode allowlist).
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email } = body

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email required' }, { status: 400 })
  }

  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const res = await fetch(`${fapiUrl}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        identifier: email.trim().toLowerCase(),
        strategy: 'reset_password_email_code',
      }).toString(),
      signal: AbortSignal.timeout(5000),
    })

    const data = await res.json()
    const signInId = data.response?.id

    if (!signInId) {
      // Clerk returns an error object if the email isn't found — return generic message
      return NextResponse.json(
        { error: 'If that email is registered, a reset code has been sent.' },
        { status: 200 } // Always 200 to avoid email enumeration
      )
    }

    // Capture the Clerk __client token from all Set-Cookie headers.
    // This is required for the multi-step FAPI flow — attempt_first_factor
    // needs the same client context that created the sign-in.
    let clerkClientToken = ''
    const setCookies = res.headers.getSetCookie?.() ?? []
    for (const sc of setCookies) {
      const match = sc.match(/__client=([^;]+)/)
      if (match) {
        clerkClientToken = match[1]
        break
      }
    }
    // Fallback: try single header (some runtimes merge Set-Cookie)
    if (!clerkClientToken) {
      const single = res.headers.get('set-cookie') || ''
      const match = single.match(/__client=([^;]+)/)
      if (match) clerkClientToken = match[1]
    }

    const response = NextResponse.json({ data: { signInId } })

    // Store the Clerk client token as our own httpOnly cookie so the browser
    // automatically carries it to the reset-password call.
    if (clerkClientToken) {
      response.cookies.set('clerk-reset-client', clerkClientToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600, // 10 minutes — enough time to receive and enter the code
        path: '/',
      })
    }

    return response
  } catch {
    return NextResponse.json({ error: 'Failed to send reset email. Please try again.' }, { status: 500 })
  }
})

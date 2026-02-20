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

    return NextResponse.json({ data: { signInId } })
  } catch {
    return NextResponse.json({ error: 'Failed to send reset email. Please try again.' }, { status: 500 })
  }
})

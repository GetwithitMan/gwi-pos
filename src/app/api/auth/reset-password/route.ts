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
 * POST /api/auth/reset-password
 *
 * Completes a Clerk password reset using the signInId from forgot-password
 * plus the 6-digit code the user received by email.
 *
 * Reads the `clerk-reset-client` httpOnly cookie (set by forgot-password)
 * and forwards it as `Cookie: __client=...` to Clerk FAPI so the multi-step
 * sign-in session is properly associated.
 *
 * Two-step Clerk FAPI flow:
 * 1. attempt_first_factor — submit code (+ optional password)
 * 2. reset_password — if status === 'needs_new_password', set the new password
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { signInId, code, password } = body

  if (!signInId || typeof signInId !== 'string') {
    return NextResponse.json({ error: 'Missing session ID' }, { status: 400 })
  }
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Verification code required' }, { status: 400 })
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Read the Clerk __client token set by forgot-password as an httpOnly cookie
  const clerkClientToken = request.cookies.get('clerk-reset-client')?.value

  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (clerkClientToken) {
    reqHeaders['Cookie'] = `__client=${clerkClientToken}`
  }

  try {
    // Step 1: Attempt with code + new password
    const attemptRes = await fetch(
      `${fapiUrl}/v1/client/sign_ins/${signInId}/attempt_first_factor`,
      {
        method: 'POST',
        headers: reqHeaders,
        body: new URLSearchParams({
          strategy: 'reset_password_email_code',
          code: code.trim(),
          password,
        }).toString(),
        signal: AbortSignal.timeout(5000),
      }
    )

    const attemptData = await attemptRes.json()
    const status = attemptData.response?.status

    if (status === 'complete') {
      const response = NextResponse.json({ data: { success: true } })
      response.cookies.delete('clerk-reset-client')
      return response
    }

    if (status === 'needs_new_password') {
      // Step 2: Some Clerk configs require a separate reset_password call
      const resetRes = await fetch(
        `${fapiUrl}/v1/client/sign_ins/${signInId}/reset_password`,
        {
          method: 'POST',
          headers: reqHeaders,
          body: new URLSearchParams({
            password,
            sign_out_of_other_sessions: 'true',
          }).toString(),
          signal: AbortSignal.timeout(5000),
        }
      )

      const resetData = await resetRes.json()
      if (resetData.response?.status === 'complete') {
        const response = NextResponse.json({ data: { success: true } })
        response.cookies.delete('clerk-reset-client')
        return response
      }

      return NextResponse.json({ error: 'Could not set new password. Please try again.' }, { status: 400 })
    }

    // Likely wrong code or expired session
    const clerkError = attemptData.errors?.[0]?.long_message
    return NextResponse.json(
      { error: clerkError || 'Invalid or expired code. Please check your email and try again.' },
      { status: 400 }
    )
  } catch {
    return NextResponse.json({ error: 'Reset failed. Please try again.' }, { status: 500 })
  }
})

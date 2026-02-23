import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/reset-password
 *
 * Server-side proxy for Clerk FAPI password reset step 2.
 * Verifies the emailed code and sets a new password.
 */

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
 * Extract client token from Clerk FAPI response.
 * Production Clerk returns it in the `authorization` response header (JWT).
 * Dev instances may return it as a `__client` Set-Cookie.
 */
function extractClientToken(res: Response): string | null {
  // Production: authorization response header
  const authHeader = res.headers.get('authorization')
  if (authHeader) return authHeader

  // Dev fallback: __client cookie
  const cookies = res.headers.getSetCookie?.() || []
  for (const cookie of cookies) {
    const match = cookie.match(/^__client=([^;]+)/)
    if (match) return match[1]
  }
  const single = res.headers.get('set-cookie') || ''
  const match = single.match(/__client=([^;]+)/)
  return match ? match[1] : null
}

export async function POST(request: NextRequest) {
  const { code, password } = await request.json().catch(() => ({} as any))

  if (!code || !password) {
    return NextResponse.json({ error: 'Code and password are required' }, { status: 400 })
  }

  // Read the stored reset state from cookie
  const resetStateCookie = request.cookies.get('clerk-reset-state')?.value
  if (!resetStateCookie) {
    return NextResponse.json({ error: 'Reset session expired. Please start over.' }, { status: 400 })
  }

  let signInId: string
  let clientToken: string | null
  try {
    const state = JSON.parse(resetStateCookie)
    signInId = state.signInId
    clientToken = state.clientToken
  } catch {
    return NextResponse.json({ error: 'Invalid reset session. Please start over.' }, { status: 400 })
  }

  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) {
    return NextResponse.json({ error: 'Password reset is not configured' }, { status: 500 })
  }

  try {
    // Step 3: Verify the reset code
    const attemptHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (clientToken) {
      attemptHeaders['Authorization'] = clientToken
      attemptHeaders['Cookie'] = `__client=${clientToken}`
    }

    const attemptRes = await fetch(
      `${fapiUrl}/v1/client/sign_ins/${signInId}/attempt_first_factor`,
      {
        method: 'POST',
        headers: attemptHeaders,
        body: new URLSearchParams({ strategy: 'reset_password_email_code', code }),
      },
    )

    const attemptData = await attemptRes.json()

    if (attemptData.errors?.length) {
      return NextResponse.json({
        error: attemptData.errors[0]?.long_message || attemptData.errors[0]?.message || 'Invalid code',
      }, { status: 400 })
    }

    if (attemptData.response?.status === 'needs_new_password') {
      // Extract updated __client token
      const updatedToken = extractClientToken(attemptRes) || clientToken
      const resetHeaders: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
      }
      if (updatedToken) {
        resetHeaders['Authorization'] = updatedToken
        resetHeaders['Cookie'] = `__client=${updatedToken}`
      }

      // Step 4: Set the new password
      const resetRes = await fetch(
        `${fapiUrl}/v1/client/sign_ins/${signInId}/reset_password`,
        {
          method: 'POST',
          headers: resetHeaders,
          body: new URLSearchParams({ password }),
        },
      )

      const resetData = await resetRes.json()

      if (resetData.errors?.length) {
        return NextResponse.json({
          error: resetData.errors[0]?.long_message || resetData.errors[0]?.message || 'Could not reset password',
        }, { status: 400 })
      }

      // Success — clear the reset state cookie
      const response = NextResponse.json({ ok: true })
      response.cookies.delete('clerk-reset-state')
      return response
    }

    return NextResponse.json({ error: 'Invalid or expired code' }, { status: 400 })
  } catch (err) {
    console.error('[reset-password] Error:', err)
    return NextResponse.json({ error: 'Connection error. Please try again.' }, { status: 500 })
  }
}

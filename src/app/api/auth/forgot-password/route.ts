import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/auth/forgot-password
 *
 * Server-side proxy for Clerk FAPI password reset step 1.
 * Creates a sign-in and sends a reset code to the user's email.
 *
 * Why server-side: Clerk production FAPI rejects browser requests from
 * domains that aren't thepasspos.com (barpos.restaurant, ordercontrolcenter.com).
 * Server-to-server calls have no Origin header so they work from any domain.
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
  const { email } = await request.json().catch(() => ({} as any))

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) {
    return NextResponse.json({ error: 'Password reset is not configured' }, { status: 500 })
  }

  try {
    // Step 1: Create sign-in attempt
    const createRes = await fetch(`${fapiUrl}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: email.trim().toLowerCase() }),
    })

    const createData = await createRes.json()

    if (createData.errors?.length) {
      const msg = createData.errors[0]?.long_message || createData.errors[0]?.message
      return NextResponse.json({ error: msg || 'Account not found' }, { status: 404 })
    }

    const signInId = createData.response?.id
    if (!signInId) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Extract email_address_id from supported first factors
    const factors = createData.response?.supported_first_factors || []
    const emailFactor = factors.find(
      (f: { strategy: string }) => f.strategy === 'email_code' || f.strategy === 'reset_password_email_code'
    )
    const emailAddressId = emailFactor?.email_address_id

    // Extract __client token from step 1
    const clientToken = extractClientToken(createRes)

    // Step 2: Request password reset code via email
    const prepareHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    }
    if (clientToken) {
      prepareHeaders['Authorization'] = clientToken
      prepareHeaders['Cookie'] = `__client=${clientToken}`
    }

    const prepareBody: Record<string, string> = {
      strategy: 'reset_password_email_code',
    }
    if (emailAddressId) {
      prepareBody['email_address_id'] = emailAddressId
    }

    const prepareRes = await fetch(
      `${fapiUrl}/v1/client/sign_ins/${signInId}/prepare_first_factor`,
      {
        method: 'POST',
        headers: prepareHeaders,
        body: new URLSearchParams(prepareBody),
      },
    )

    const prepareData = await prepareRes.json()

    if (prepareData.errors?.length) {
      const msg = prepareData.errors[0]?.long_message || prepareData.errors[0]?.message
      return NextResponse.json({ error: msg || 'Could not send reset code' }, { status: 400 })
    }

    // Extract updated __client token from step 2
    const updatedClientToken = extractClientToken(prepareRes) || clientToken

    // Store __client + signInId in an httpOnly cookie for step 2
    const resetState = JSON.stringify({ signInId, clientToken: updatedClientToken })
    const response = NextResponse.json({ signInId })
    response.cookies.set('clerk-reset-state', resetState, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60, // 10 minutes
    })

    return response
  } catch (err) {
    console.error('[forgot-password] Error:', err)
    return NextResponse.json({ error: 'Connection error. Please try again.' }, { status: 500 })
  }
}

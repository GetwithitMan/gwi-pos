/**
 * Client-side Clerk FAPI password reset.
 *
 * Runs entirely in the browser on the venue's own domain — no redirects
 * to Mission Control or any external site. The browser manages the Clerk
 * __client cookie automatically between FAPI requests, which is why this
 * works client-side but failed server-to-server.
 */

function getClerkFapiUrl(): string {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || ''
  if (!pk) return ''
  try {
    const base64 = pk.replace(/^pk_(test|live)_/, '')
    // URL-safe base64 → standard base64 with proper padding (atob is strict)
    const safe = base64.replace(/-/g, '+').replace(/_/g, '/')
    const padded = safe.padEnd(Math.ceil(safe.length / 4) * 4, '=')
    const decoded = atob(padded).replace(/\$$/, '')
    return `https://${decoded}`
  } catch {
    return ''
  }
}

/**
 * Step 1: Create a sign-in and send a password reset code to the user's email.
 */
export async function requestPasswordReset(email: string): Promise<{
  ok: boolean
  signInId?: string
  error?: string
}> {
  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) return { ok: false, error: 'Password reset is not configured' }

  try {
    const createRes = await fetch(`${fapiUrl}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ identifier: email }),
      credentials: 'include',
    })

    const createData = await createRes.json()

    // Surface the actual Clerk error message
    if (createData.errors?.length) {
      const msg = createData.errors[0]?.long_message || createData.errors[0]?.message
      return { ok: false, error: msg || 'Account not found' }
    }

    const signInId = createData.response?.id
    if (!signInId) return { ok: false, error: 'Account not found' }

    const prepareRes = await fetch(
      `${fapiUrl}/v1/client/sign_ins/${signInId}/prepare_first_factor`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ strategy: 'reset_password_email_code' }),
        credentials: 'include',
      },
    )

    if (!prepareRes.ok) {
      const prepareData = await prepareRes.json().catch(() => ({}))
      const msg = prepareData.errors?.[0]?.long_message || prepareData.errors?.[0]?.message
      return { ok: false, error: msg || 'Could not send reset code. Please try again.' }
    }

    return { ok: true, signInId }
  } catch {
    return { ok: false, error: 'Connection error. Please try again.' }
  }
}

/**
 * Step 2: Verify the emailed code and set a new password.
 */
export async function completePasswordReset(
  signInId: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) return { ok: false, error: 'Password reset is not configured' }

  try {
    const attemptRes = await fetch(
      `${fapiUrl}/v1/client/sign_ins/${signInId}/attempt_first_factor`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ strategy: 'reset_password_email_code', code }),
        credentials: 'include',
      },
    )

    const attemptData = await attemptRes.json()

    if (attemptData.errors?.length) {
      return {
        ok: false,
        error: attemptData.errors[0]?.long_message || attemptData.errors[0]?.message || 'Invalid code',
      }
    }

    if (attemptData.response?.status === 'needs_new_password') {
      const resetRes = await fetch(
        `${fapiUrl}/v1/client/sign_ins/${signInId}/reset_password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ password: newPassword }),
          credentials: 'include',
        },
      )

      const resetData = await resetRes.json()

      if (resetData.errors?.length) {
        return {
          ok: false,
          error: resetData.errors[0]?.long_message || resetData.errors[0]?.message || 'Could not reset password',
        }
      }

      return { ok: true }
    }

    return { ok: false, error: 'Invalid or expired code' }
  } catch {
    return { ok: false, error: 'Connection error. Please try again.' }
  }
}

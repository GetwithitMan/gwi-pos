/**
 * Password reset client helpers.
 *
 * Calls our own server-side API routes which proxy to Clerk FAPI.
 * Server-to-server calls bypass Clerk's Origin header restriction
 * that blocks browser requests from non-thepasspos.com domains.
 */

/**
 * Step 1: Request a password reset code be sent to the user's email.
 */
export async function requestPasswordReset(email: string): Promise<{
  ok: boolean
  signInId?: string
  error?: string
}> {
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data.error || 'Account not found' }
    }

    return { ok: true, signInId: data.signInId }
  } catch {
    return { ok: false, error: 'Connection error. Please try again.' }
  }
}

/**
 * Step 2: Verify the emailed code and set a new password.
 */
export async function completePasswordReset(
  _signInId: string,
  code: string,
  newPassword: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, password: newPassword }),
    })

    const data = await res.json()

    if (!res.ok) {
      return { ok: false, error: data.error || 'Could not reset password' }
    }

    return { ok: true }
  } catch {
    return { ok: false, error: 'Connection error. Please try again.' }
  }
}

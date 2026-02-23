/**
 * Clerk FAPI credential verification — shared module.
 *
 * Verifies email + password against the Clerk tenant server-to-server
 * using Clerk's Frontend API (FAPI). Used by:
 *   - /api/auth/venue-login  (venue admin login)
 *   - /api/access/clerk-verify  (GWI access gate)
 */

/**
 * Derive the Clerk Frontend API URL from the publishable key.
 * pk_test_Y2hhb... -> base64 -> "champion-mackerel-95.clerk.accounts.dev$"
 * -> FAPI URL: https://champion-mackerel-95.clerk.accounts.dev
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
 * Verify email + password against the Clerk tenant server-to-server.
 * Uses Clerk's Frontend API (FAPI) which accepts plain HTTP requests.
 * Returns true if the credentials are valid in Clerk.
 */
export async function verifyWithClerk(email: string, password: string): Promise<boolean> {
  const fapiUrl = getClerkFapiUrl()
  if (!fapiUrl) return false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(`${fapiUrl}/v1/client/sign_ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        identifier: email,
        strategy: 'password',
        password,
      }).toString(),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!res.ok && res.status !== 422) return false

    const data = await res.json()
    // Successful sign-in: response.status === 'complete'
    return data.response?.status === 'complete'
  } catch {
    clearTimeout(timeout)
    return false
  }
}

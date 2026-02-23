import { NextRequest, NextResponse } from 'next/server'
import { verifyWithClerk } from '@/lib/clerk-verify'

/**
 * POST /api/auth/venue-login/debug
 *
 * TEMPORARY diagnostic endpoint — tests each step of the venue-login flow.
 * Remove after debugging is complete.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const { email, password } = body
  const venueSlug = request.headers.get('x-venue-slug') || '(none)'

  const diagnostics: Record<string, unknown> = {
    venueSlug,
    hasClerkKey: !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    hasProvisionKey: !!process.env.PROVISION_API_KEY,
    mcUrl: process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com',
  }

  // Test Clerk auth
  if (email && password) {
    const normalizedEmail = email.trim().toLowerCase()
    diagnostics.normalizedEmail = normalizedEmail
    diagnostics.clerkValid = await verifyWithClerk(normalizedEmail, password)

    // Test MC call
    if (diagnostics.clerkValid) {
      const mcUrl = process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com'
      const provisionKey = process.env.PROVISION_API_KEY || ''
      try {
        const venueRes = await fetch(
          `${mcUrl}/api/owner/venues?email=${encodeURIComponent(normalizedEmail)}`,
          {
            headers: { Authorization: `Bearer ${provisionKey}` },
            signal: AbortSignal.timeout(4000),
          }
        )
        diagnostics.mcStatus = venueRes.status
        diagnostics.mcOk = venueRes.ok
        if (venueRes.ok) {
          const venueData = await venueRes.json()
          diagnostics.mcVenues = venueData.data?.venues ?? []
          diagnostics.mcName = venueData.data?.name ?? null
        } else {
          diagnostics.mcBody = await venueRes.text().catch(() => '(unreadable)')
        }
      } catch (err: any) {
        diagnostics.mcError = err?.message || String(err)
      }
    }
  }

  return NextResponse.json(diagnostics)
}

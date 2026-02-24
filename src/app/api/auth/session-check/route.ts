import { NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { getSessionFromCookie, refreshSessionCookie } from '@/lib/auth-session'

/**
 * GET /api/auth/session-check
 *
 * Lightweight endpoint for the client idle timer to check session validity.
 * Also refreshes the lastActivity timestamp on the session cookie.
 *
 * Returns:
 *   200 { data: { valid: true, employeeId } } — session is valid
 *   401 { error: 'session_expired' } — session expired or missing
 */
export const GET = withVenue(async function GET() {
  const session = await getSessionFromCookie()

  if (!session) {
    return NextResponse.json(
      { error: 'session_expired' },
      { status: 401 }
    )
  }

  // Refresh activity timestamp (no-op if <1 min since last refresh)
  await refreshSessionCookie(session)

  return NextResponse.json({
    data: {
      valid: true,
      employeeId: session.employeeId,
    },
  })
})

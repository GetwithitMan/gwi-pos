import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { clearSessionCookie, getSessionFromCookie } from '@/lib/auth-session'

/**
 * POST /api/auth/logout
 *
 * Clears the httpOnly pos-session cookie and logs the logout event.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const session = await getSessionFromCookie()

    // Log the logout before clearing the cookie
    if (session) {
      void db.auditLog.create({
        data: {
          locationId: session.locationId,
          employeeId: session.employeeId,
          action: 'logout',
          entityType: 'employee',
          entityId: session.employeeId,
          details: { reason: 'user_initiated' },
        },
      }).catch(console.error)
    }

    await clearSessionCookie()

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Logout error:', error)
    // Still clear the cookie even if logging fails
    try { await clearSessionCookie() } catch {}
    return NextResponse.json({ data: { success: true } })
  }
})

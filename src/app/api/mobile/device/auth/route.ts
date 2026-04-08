import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { err, ok, unauthorized } from '@/lib/api-response'

// GET: validate mobile session token → return employee data
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    // Accept token from httpOnly cookie first, then x-mobile-session header as fallback
    const token =
      request.cookies.get('mobile-session')?.value ??
      request.headers.get('x-mobile-session') ??
      null

    if (!token) {
      return unauthorized('No session token')
    }

    const session = await db.mobileSession.findFirst({
      where: { sessionToken: token, revokedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            role: { select: { id: true, name: true, permissions: true } },
          },
        },
      },
    })

    if (!session || session.expiresAt < new Date()) {
      return unauthorized('Session expired or invalid')
    }

    // Verify session belongs to this venue's location
    const locationId = await getLocationId()
    if (locationId && session.locationId !== locationId) {
      return NextResponse.json({ error: 'Session does not match this venue' }, { status: 403 })
    }

    return ok({
        employeeId: session.employeeId,
        employee: session.employee,
        expiresAt: session.expiresAt.toISOString(),
      })
  } catch (error) {
    console.error('[mobile/device/auth] Error:', error)
    return err('Internal server error', 500)
  }
})

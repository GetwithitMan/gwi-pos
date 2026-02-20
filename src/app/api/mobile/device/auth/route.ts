import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET: validate mobile session token → return employee data
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    // Accept token from httpOnly cookie first, then x-mobile-session header as fallback
    const token =
      request.cookies.get('mobile-session')?.value ??
      request.headers.get('x-mobile-session') ??
      null

    if (!token) {
      return NextResponse.json({ error: 'No session token' }, { status: 401 })
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
      return NextResponse.json({ error: 'Session expired or invalid' }, { status: 401 })
    }

    return NextResponse.json({
      data: {
        employeeId: session.employeeId,
        employee: session.employee,
        expiresAt: session.expiresAt.toISOString(),
      },
    })
  } catch (error) {
    console.error('[mobile/device/auth] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

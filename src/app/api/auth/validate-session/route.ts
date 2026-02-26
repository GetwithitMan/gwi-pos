import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/auth/validate-session?locationId=X&employeeId=Y
 *
 * Lightweight check that the session's locationId and employeeId
 * exist in the current venue database. Returns 401 if either is
 * missing, signaling the client to force re-login.
 *
 * This prevents stale sessions (e.g., locationId from the master DB)
 * from causing random 500s on every subsequent API call.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')
  const employeeId = searchParams.get('employeeId')

  if (!locationId || !employeeId) {
    return NextResponse.json(
      { valid: false, reason: 'missing_params' },
      { status: 400 }
    )
  }

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { id: true },
  })

  if (!location) {
    return NextResponse.json(
      { valid: false, reason: 'location_not_found' },
      { status: 401 }
    )
  }

  // Cloud users (JWT-backed, not DB records) have IDs like "cloud-user_..."
  // They're authenticated via the cloud-session endpoint, not the employee table.
  if (!employeeId.startsWith('cloud-')) {
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, isActive: true },
    })

    if (!employee || !employee.isActive) {
      return NextResponse.json(
        { valid: false, reason: 'employee_not_found' },
        { status: 401 }
      )
    }
  }

  return NextResponse.json({ data: { valid: true } })
})

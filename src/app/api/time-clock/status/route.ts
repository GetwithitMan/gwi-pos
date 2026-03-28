import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET /api/time-clock/status?employeeId=X - Check if employee is clocked in
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const employeeId = request.nextUrl.searchParams.get('employeeId')

    if (!employeeId) {
      return err('employeeId is required')
    }

    const activeEntry = await db.timeClockEntry.findFirst({
      where: {
        employeeId,
        clockOut: null,
        deletedAt: null,
      },
      select: {
        id: true,
        clockIn: true,
      },
    })

    return ok({
      clockedIn: !!activeEntry,
      entryId: activeEntry?.id || null,
      clockInTime: activeEntry?.clockIn.toISOString() || null,
    })
  } catch (error) {
    console.error('Failed to check clock-in status:', error)
    return err('Failed to check clock-in status', 500)
  }
})

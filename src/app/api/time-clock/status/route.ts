import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET /api/time-clock/status?employeeId=X - Check if employee is clocked in
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const employeeId = request.nextUrl.searchParams.get('employeeId')

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required' },
        { status: 400 }
      )
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

    return NextResponse.json({
      clockedIn: !!activeEntry,
      entryId: activeEntry?.id || null,
      clockInTime: activeEntry?.clockIn.toISOString() || null,
    })
  } catch (error) {
    console.error('Failed to check clock-in status:', error)
    return NextResponse.json(
      { error: 'Failed to check clock-in status' },
      { status: 500 }
    )
  }
})

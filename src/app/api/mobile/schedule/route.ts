import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Fetch upcoming shifts for an employee (mobile "My Schedule" view)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')
    const weeksAheadParam = searchParams.get('weeksAhead')
    const weeksAhead = weeksAheadParam ? parseInt(weeksAheadParam, 10) : 2

    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
    }
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const startDate = new Date()
    startDate.setHours(0, 0, 0, 0)

    const endDate = new Date(startDate)
    endDate.setDate(endDate.getDate() + weeksAhead * 7)

    const shifts = await db.scheduledShift.findMany({
      where: {
        employeeId,
        locationId,
        deletedAt: null,
        date: {
          gte: startDate,
          lte: endDate,
        },
        schedule: {
          status: { in: ['published'] },
        },
      },
      include: {
        schedule: {
          select: { weekStart: true, weekEnd: true, status: true },
        },
        role: {
          select: { name: true },
        },
      },
      orderBy: { date: 'asc' },
    })

    const formatted = shifts.map(shift => ({
      id: shift.id,
      date: shift.date.toISOString(),
      startTime: shift.startTime,
      endTime: shift.endTime,
      breakMinutes: shift.breakMinutes,
      status: shift.status,
      roleName: shift.role?.name ?? null,
      scheduleWeekStart: shift.schedule?.weekStart?.toISOString() ?? null,
      notes: shift.notes ?? null,
    }))

    return NextResponse.json({ data: { shifts: formatted } })
  } catch (error) {
    console.error('Failed to fetch mobile schedule:', error)
    return NextResponse.json({ error: 'Failed to fetch schedule' }, { status: 500 })
  }
})

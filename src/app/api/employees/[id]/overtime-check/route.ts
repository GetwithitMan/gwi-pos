import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// I-3: Overtime check — returns current week hours for employee
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: employeeId } = await params
    const searchParams = request.nextUrl.searchParams
    const threshold = parseFloat(searchParams.get('threshold') || '40')

    // Calculate start of current work week (Monday)
    const now = new Date()
    const dayOfWeek = now.getDay()
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - mondayOffset)
    weekStart.setHours(0, 0, 0, 0)

    const entries = await db.timeClockEntry.findMany({
      where: {
        employeeId,
        clockIn: { gte: weekStart },
      },
      select: {
        clockIn: true,
        clockOut: true,
        regularHours: true,
        overtimeHours: true,
        breakMinutes: true,
      },
    })

    let weeklyHours = 0
    entries.forEach(entry => {
      if (entry.clockOut) {
        weeklyHours += Number(entry.regularHours || 0) + Number(entry.overtimeHours || 0)
      } else {
        // Currently clocked in — calculate hours so far
        const hoursWorked = (now.getTime() - entry.clockIn.getTime()) / (1000 * 60 * 60)
        const breakHours = (entry.breakMinutes || 0) / 60
        weeklyHours += Math.max(0, hoursWorked - breakHours)
      }
    })

    weeklyHours = Math.round(weeklyHours * 100) / 100

    return ok({
      employeeId,
      weeklyHours,
      threshold,
      isOverThreshold: weeklyHours >= threshold,
      hoursRemaining: Math.max(0, Math.round((threshold - weeklyHours) * 100) / 100),
      weekStart: weekStart.toISOString(),
    })
  } catch (error) {
    console.error('Failed to check overtime:', error)
    return err('Failed to check overtime', 500)
  }
})

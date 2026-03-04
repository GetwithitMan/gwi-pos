import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// I-4: Schedule compliance report — scheduled vs actual hours
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const end = endDate ? new Date(endDate + 'T23:59:59') : new Date()
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Fetch scheduled shifts and time clock entries in parallel
    const [scheduledShifts, timeEntries] = await Promise.all([
      db.scheduledShift.findMany({
        where: {
          locationId,
          date: { gte: start, lte: end },
          deletedAt: null,
          status: { notIn: ['called_off', 'no_show'] },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
        orderBy: { date: 'asc' },
      }),
      db.timeClockEntry.findMany({
        where: {
          locationId,
          clockIn: { gte: start, lte: end },
          clockOut: { not: null },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
    ])

    // Group by employee + date
    type ComplianceRow = {
      employeeId: string
      employeeName: string
      date: string
      scheduledStart: string | null
      scheduledEnd: string | null
      scheduledHours: number
      actualStart: string | null
      actualEnd: string | null
      actualHours: number
      variance: number // actual - scheduled
      status: 'on_time' | 'late' | 'early' | 'no_show' | 'unscheduled'
    }

    const rows: ComplianceRow[] = []

    // Process scheduled shifts
    scheduledShifts.forEach(shift => {
      const dateKey = shift.date.toISOString().split('T')[0]
      const empName = shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`

      // Parse scheduled hours from startTime/endTime (HH:MM format)
      const [startH, startM] = shift.startTime.split(':').map(Number)
      const [endH, endM] = shift.endTime.split(':').map(Number)
      let scheduledMinutes = (endH * 60 + endM) - (startH * 60 + startM)
      if (scheduledMinutes < 0) scheduledMinutes += 24 * 60 // overnight
      const scheduledHours = (scheduledMinutes - shift.breakMinutes) / 60

      // Find matching time clock entry
      const matching = timeEntries.find(
        e => e.employeeId === shift.employeeId &&
             e.clockIn.toISOString().split('T')[0] === dateKey
      )

      if (matching) {
        const actualHours = Number(matching.regularHours || 0) + Number(matching.overtimeHours || 0)

        // Determine if late (clocked in > 5 minutes after scheduled start)
        const scheduledStartDate = new Date(shift.date)
        scheduledStartDate.setHours(startH, startM, 0, 0)
        const diffMinutes = (matching.clockIn.getTime() - scheduledStartDate.getTime()) / (1000 * 60)

        let status: ComplianceRow['status'] = 'on_time'
        if (diffMinutes > 5) status = 'late'
        else if (diffMinutes < -5) status = 'early'

        rows.push({
          employeeId: shift.employeeId,
          employeeName: empName,
          date: dateKey,
          scheduledStart: shift.startTime,
          scheduledEnd: shift.endTime,
          scheduledHours: Math.round(scheduledHours * 100) / 100,
          actualStart: matching.clockIn.toISOString(),
          actualEnd: matching.clockOut!.toISOString(),
          actualHours: Math.round(actualHours * 100) / 100,
          variance: Math.round((actualHours - scheduledHours) * 100) / 100,
          status,
        })
      } else {
        rows.push({
          employeeId: shift.employeeId,
          employeeName: empName,
          date: dateKey,
          scheduledStart: shift.startTime,
          scheduledEnd: shift.endTime,
          scheduledHours: Math.round(scheduledHours * 100) / 100,
          actualStart: null,
          actualEnd: null,
          actualHours: 0,
          variance: -Math.round(scheduledHours * 100) / 100,
          status: 'no_show',
        })
      }
    })

    // Find unscheduled entries (clocked in but not on schedule)
    const scheduledKeys = new Set(
      scheduledShifts.map(s => `${s.employeeId}|${s.date.toISOString().split('T')[0]}`)
    )
    timeEntries.forEach(entry => {
      const dateKey = entry.clockIn.toISOString().split('T')[0]
      if (!scheduledKeys.has(`${entry.employeeId}|${dateKey}`)) {
        const empName = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`
        const actualHours = Number(entry.regularHours || 0) + Number(entry.overtimeHours || 0)
        rows.push({
          employeeId: entry.employeeId,
          employeeName: empName,
          date: dateKey,
          scheduledStart: null,
          scheduledEnd: null,
          scheduledHours: 0,
          actualStart: entry.clockIn.toISOString(),
          actualEnd: entry.clockOut!.toISOString(),
          actualHours: Math.round(actualHours * 100) / 100,
          variance: Math.round(actualHours * 100) / 100,
          status: 'unscheduled',
        })
      }
    })

    // Summary stats
    const totalScheduled = rows.reduce((s, r) => s + r.scheduledHours, 0)
    const totalActual = rows.reduce((s, r) => s + r.actualHours, 0)
    const noShows = rows.filter(r => r.status === 'no_show').length
    const lateCount = rows.filter(r => r.status === 'late').length

    return NextResponse.json({ data: {
      rows: rows.sort((a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName)),
      summary: {
        totalScheduledHours: Math.round(totalScheduled * 100) / 100,
        totalActualHours: Math.round(totalActual * 100) / 100,
        variance: Math.round((totalActual - totalScheduled) * 100) / 100,
        noShows,
        lateCount,
        complianceRate: rows.length > 0
          ? Math.round(((rows.length - noShows) / rows.length) * 10000) / 100
          : 100,
      },
      filters: { startDate: start.toISOString(), endDate: end.toISOString() },
    } })
  } catch (error) {
    console.error('Failed to generate schedule compliance report:', error)
    return NextResponse.json({ error: 'Failed to generate schedule compliance report' }, { status: 500 })
  }
})

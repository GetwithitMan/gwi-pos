import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// I-7: Labor forecast widget — scheduled employees per hour + estimated labor cost
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const targetDate = dateStr ? new Date(dateStr) : new Date()
    const dayStart = new Date(targetDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(targetDate)
    dayEnd.setHours(23, 59, 59, 999)

    const scheduledShifts = await db.scheduledShift.findMany({
      where: {
        locationId,
        date: { gte: dayStart, lte: dayEnd },
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
            hourlyRate: true,
          },
        },
        role: { select: { name: true } },
      },
    })

    // Build hourly breakdown (6am to 2am next day = hours 6-25)
    type HourSlot = {
      hour: number
      label: string
      employeeCount: number
      employees: { name: string; role: string }[]
      estimatedCost: number
    }

    const hours: HourSlot[] = []

    for (let h = 6; h <= 25; h++) {
      const displayHour = h % 24
      const label = displayHour === 0 ? '12am' :
                    displayHour < 12 ? `${displayHour}am` :
                    displayHour === 12 ? '12pm' :
                    `${displayHour - 12}pm`

      const inSlot: { name: string; role: string; rate: number }[] = []

      scheduledShifts.forEach(shift => {
        const [startH] = shift.startTime.split(':').map(Number)
        let [endH] = shift.endTime.split(':').map(Number)
        // Handle overnight shifts
        if (endH <= startH) endH += 24

        if (h >= startH && h < endH) {
          const empName = shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`
          inSlot.push({
            name: empName,
            role: shift.role?.name || 'Staff',
            rate: Number(shift.employee.hourlyRate) || 0,
          })
        }
      })

      hours.push({
        hour: displayHour,
        label,
        employeeCount: inSlot.length,
        employees: inSlot.map(e => ({ name: e.name, role: e.role })),
        estimatedCost: Math.round(inSlot.reduce((s, e) => s + e.rate, 0) * 100) / 100,
      })
    }

    // Total estimated labor cost for the day
    let totalEstimatedCost = 0
    scheduledShifts.forEach(shift => {
      const [startH, startM] = shift.startTime.split(':').map(Number)
      let [endH, endM] = shift.endTime.split(':').map(Number)
      let minutes = (endH * 60 + endM) - (startH * 60 + startM)
      if (minutes < 0) minutes += 24 * 60
      const hours = (minutes - shift.breakMinutes) / 60
      totalEstimatedCost += hours * (Number(shift.employee.hourlyRate) || 0)
    })

    return NextResponse.json({ data: {
      date: targetDate.toISOString().split('T')[0],
      hours: hours.filter(h => h.employeeCount > 0),
      summary: {
        totalScheduledEmployees: scheduledShifts.length,
        peakEmployees: Math.max(...hours.map(h => h.employeeCount), 0),
        peakHour: hours.reduce((max, h) => h.employeeCount > max.employeeCount ? h : max, hours[0])?.label || 'N/A',
        totalEstimatedCost: Math.round(totalEstimatedCost * 100) / 100,
      },
    } })
  } catch (error) {
    console.error('Failed to generate labor forecast:', error)
    return NextResponse.json({ error: 'Failed to generate labor forecast' }, { status: 500 })
  }
})

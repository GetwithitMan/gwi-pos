import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// I-5: Break compliance — flag shifts missing required breaks
// Default rules: >6h requires 30min break, >8h requires 60min break
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || employeeId

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

    const where: Record<string, unknown> = {
      locationId,
      clockIn: { gte: start, lte: end },
      clockOut: { not: null },
    }
    if (employeeId) where.employeeId = employeeId

    const entries = await db.timeClockEntry.findMany({
      where,
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
      orderBy: { clockIn: 'desc' },
    })

    // Configurable thresholds (could come from settings, using sensible defaults)
    const rules = [
      { minHours: 8, requiredBreakMinutes: 60 },
      { minHours: 6, requiredBreakMinutes: 30 },
    ]

    type Violation = {
      entryId: string
      employeeId: string
      employeeName: string
      date: string
      clockIn: string
      clockOut: string
      hoursWorked: number
      breakMinutes: number
      requiredBreakMinutes: number
      shortfall: number
    }

    const violations: Violation[] = []

    entries.forEach(entry => {
      const hoursWorked = Number(entry.regularHours || 0) + Number(entry.overtimeHours || 0)
      const breakTaken = entry.breakMinutes || 0
      const empName = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`

      // Find the most restrictive rule that applies
      for (const rule of rules) {
        if (hoursWorked >= rule.minHours && breakTaken < rule.requiredBreakMinutes) {
          violations.push({
            entryId: entry.id,
            employeeId: entry.employeeId,
            employeeName: empName,
            date: entry.clockIn.toISOString().split('T')[0],
            clockIn: entry.clockIn.toISOString(),
            clockOut: entry.clockOut!.toISOString(),
            hoursWorked: Math.round(hoursWorked * 100) / 100,
            breakMinutes: breakTaken,
            requiredBreakMinutes: rule.requiredBreakMinutes,
            shortfall: rule.requiredBreakMinutes - breakTaken,
          })
          break // Only report the most restrictive violation
        }
      }
    })

    return NextResponse.json({ data: {
      violations,
      summary: {
        totalEntries: entries.length,
        violationCount: violations.length,
        complianceRate: entries.length > 0
          ? Math.round(((entries.length - violations.length) / entries.length) * 10000) / 100
          : 100,
      },
      rules,
      filters: { startDate: start.toISOString(), endDate: end.toISOString(), employeeId },
    } })
  } catch (error) {
    console.error('Failed to generate break compliance report:', error)
    return NextResponse.json({ error: 'Failed to generate break compliance report' }, { status: 500 })
  }
})

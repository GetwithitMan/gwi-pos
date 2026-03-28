import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange } from '@/lib/business-day'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

// GET /api/reports/server-banking — Per-server cash bank report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const requestingEmployeeId =
      searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.REPORTS_VIEW
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build date range — default to current business day if no range specified
    const locSettings = await getLocationSettings(locationId) as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'

    let dateFilter: { gte: Date; lte: Date }
    if (dateFrom && dateTo) {
      dateFilter = {
        gte: new Date(dateFrom),
        lte: new Date(new Date(dateTo).setHours(23, 59, 59, 999)),
      }
    } else if (dateFrom) {
      dateFilter = {
        gte: new Date(dateFrom),
        lte: new Date(new Date(dateFrom).setHours(23, 59, 59, 999)),
      }
    } else {
      // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
      const timezone = await getLocationTimezone(locationId)
      const today = new Date().toISOString().split('T')[0]
      const range = getBusinessDayRange(today, dayStartTime, timezone)
      dateFilter = { gte: range.start, lte: range.end }
    }

    // Fetch all closed shifts in the date range for this location
    // Server banking uses purse mode (cashHandlingMode = 'purse')
    const shifts = await db.shift.findMany({
      where: {
        locationId,
        startedAt: { gte: dateFilter.gte, lte: dateFilter.lte },
        status: 'closed',
      },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
    })

    // Aggregate per employee
    const employeeMap = new Map<string, {
      employeeId: string
      employeeName: string
      shiftsWorked: number
      totalBuyIns: number
      totalExpected: number
      totalActual: number
      netOverShort: number
      shifts: {
        shiftId: string
        startedAt: string
        endedAt: string | null
        startingCash: number
        expectedCash: number
        actualCash: number
        variance: number
      }[]
    }>()

    let locationTotalOver = 0
    let locationTotalShort = 0
    let locationNetVariance = 0

    for (const shift of shifts) {
      const empId = shift.employeeId
      const empName = shift.employee?.displayName
        || `${shift.employee?.firstName || ''} ${shift.employee?.lastName || ''}`.trim()
        || 'Unknown'

      const startingCash = Number(shift.startingCash) || 0
      const expectedCash = Number(shift.expectedCash) || 0
      const actualCash = Number(shift.actualCash) || 0
      const variance = Number(shift.variance) || 0

      if (!employeeMap.has(empId)) {
        employeeMap.set(empId, {
          employeeId: empId,
          employeeName: empName,
          shiftsWorked: 0,
          totalBuyIns: 0,
          totalExpected: 0,
          totalActual: 0,
          netOverShort: 0,
          shifts: [],
        })
      }

      const emp = employeeMap.get(empId)!
      emp.shiftsWorked += 1
      emp.totalBuyIns += startingCash
      emp.totalExpected += expectedCash
      emp.totalActual += actualCash
      emp.netOverShort += variance
      emp.shifts.push({
        shiftId: shift.id,
        startedAt: shift.startedAt.toISOString(),
        endedAt: shift.endedAt?.toISOString() || null,
        startingCash,
        expectedCash,
        actualCash,
        variance,
      })

      if (variance > 0) locationTotalOver += variance
      if (variance < 0) locationTotalShort += variance
      locationNetVariance += variance
    }

    const employees = Array.from(employeeMap.values())
      .sort((a, b) => b.shiftsWorked - a.shiftsWorked)

    return ok({
        dateRange: {
          from: dateFilter.gte.toISOString(),
          to: dateFilter.lte.toISOString(),
        },
        summary: {
          totalShifts: shifts.length,
          totalEmployees: employees.length,
          totalOver: locationTotalOver,
          totalShort: locationTotalShort,
          netVariance: locationNetVariance,
        },
        employees,
      })
  } catch (error) {
    console.error('Failed to generate server banking report:', error)
    return err('Failed to generate server banking report', 500)
  }
})

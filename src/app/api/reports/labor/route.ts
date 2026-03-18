import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { REVENUE_ORDER_STATUSES, calculateLaborCost, roundMoney } from '@/lib/domain/reports'

// GET labor report - hours worked, costs, overtime
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter (B17 fix: explicit date objects, no spread operator)
    const clockInFilter: Record<string, Date> = {}
    if (startDate) clockInFilter.gte = new Date(startDate)
    if (endDate) clockInFilter.lte = new Date(endDate + 'T23:59:59')
    const dateFilter = Object.keys(clockInFilter).length > 0 ? { clockIn: clockInFilter } : {}

    // Build employee filter
    const employeeFilter = employeeId ? { employeeId } : {}

    // Fetch time entries and employees in parallel (independent queries)
    const [entries, employees] = await Promise.all([
      // Time clock entries
      db.timeClockEntry.findMany({
        where: {
          locationId,
          ...dateFilter,
          ...employeeFilter,
          clockOut: { not: null }, // Only completed shifts
        },
        include: {
          employee: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              hourlyRate: true,
              role: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { clockIn: 'desc' },
      }),
      // All active employees (including those with no entries)
      adminDb.employee.findMany({
        where: {
          locationId,
          isActive: true,
        },
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
          hourlyRate: true,
          role: {
            select: { name: true },
          },
        },
      }),
    ])

    // Initialize summary stats
    let totalRegularHours = 0
    let totalOvertimeHours = 0
    let totalBreakMinutes = 0
    let totalLaborCost = 0
    let totalShifts = 0

    // Group by employee
    const employeeStats: Record<string, {
      id: string
      name: string
      role: string
      hourlyRate: number
      shifts: number
      regularHours: number
      overtimeHours: number
      totalHours: number
      breakMinutes: number
      laborCost: number
      entries: {
        date: string
        clockIn: string
        clockOut: string
        regularHours: number
        overtimeHours: number
        breakMinutes: number
        cost: number
      }[]
    }> = {}

    // Group by day
    const dailyStats: Record<string, {
      date: string
      shifts: number
      regularHours: number
      overtimeHours: number
      breakMinutes: number
      laborCost: number
      employeeCount: number
    }> = {}

    // Group by role
    const roleStats: Record<string, {
      role: string
      employees: number
      shifts: number
      totalHours: number
      laborCost: number
    }> = {}

    entries.forEach(entry => {
      const empId = entry.employeeId
      const empName = entry.employee.displayName ||
        `${entry.employee.firstName} ${entry.employee.lastName}`
      const empRole = entry.employee.role?.name || 'Unknown'
      const hourlyRate = Number(entry.employee.hourlyRate) || 0

      // Calculate hours for this entry
      const regularHours = Number(entry.regularHours) || 0
      const overtimeHours = Number(entry.overtimeHours) || 0
      const breakMins = entry.breakMinutes || 0
      const totalHours = regularHours + overtimeHours

      // Calculate cost (overtime is 1.5x via domain module)
      const entryCost = calculateLaborCost(regularHours, overtimeHours, hourlyRate)

      // Update totals
      totalRegularHours += regularHours
      totalOvertimeHours += overtimeHours
      totalBreakMinutes += breakMins
      totalLaborCost += entryCost
      totalShifts += 1

      // Employee stats
      if (!employeeStats[empId]) {
        employeeStats[empId] = {
          id: empId,
          name: empName,
          role: empRole,
          hourlyRate,
          shifts: 0,
          regularHours: 0,
          overtimeHours: 0,
          totalHours: 0,
          breakMinutes: 0,
          laborCost: 0,
          entries: [],
        }
      }
      employeeStats[empId].shifts += 1
      employeeStats[empId].regularHours += regularHours
      employeeStats[empId].overtimeHours += overtimeHours
      employeeStats[empId].totalHours += totalHours
      employeeStats[empId].breakMinutes += breakMins
      employeeStats[empId].laborCost += entryCost
      const tz = process.env.TIMEZONE || process.env.TZ
      employeeStats[empId].entries.push({
        date: tz ? entry.clockIn.toLocaleDateString('en-CA', { timeZone: tz }) : entry.clockIn.toISOString().split('T')[0],
        clockIn: entry.clockIn.toISOString(),
        clockOut: entry.clockOut!.toISOString(),
        regularHours,
        overtimeHours,
        breakMinutes: breakMins,
        cost: roundMoney(entryCost),
      })

      // Daily stats
      const dateKey = tz ? entry.clockIn.toLocaleDateString('en-CA', { timeZone: tz }) : entry.clockIn.toISOString().split('T')[0]
      if (!dailyStats[dateKey]) {
        dailyStats[dateKey] = {
          date: dateKey,
          shifts: 0,
          regularHours: 0,
          overtimeHours: 0,
          breakMinutes: 0,
          laborCost: 0,
          employeeCount: 0,
        }
      }
      dailyStats[dateKey].shifts += 1
      dailyStats[dateKey].regularHours += regularHours
      dailyStats[dateKey].overtimeHours += overtimeHours
      dailyStats[dateKey].breakMinutes += breakMins
      dailyStats[dateKey].laborCost += entryCost

      // Role stats
      if (!roleStats[empRole]) {
        roleStats[empRole] = {
          role: empRole,
          employees: 0,
          shifts: 0,
          totalHours: 0,
          laborCost: 0,
        }
      }
      roleStats[empRole].shifts += 1
      roleStats[empRole].totalHours += totalHours
      roleStats[empRole].laborCost += entryCost
    })

    // Count unique employees per day
    const dailyEmployees: Record<string, Set<string>> = {}
    const tz2 = process.env.TIMEZONE || process.env.TZ
    entries.forEach(entry => {
      const dateKey = tz2 ? entry.clockIn.toLocaleDateString('en-CA', { timeZone: tz2 }) : entry.clockIn.toISOString().split('T')[0]
      if (!dailyEmployees[dateKey]) {
        dailyEmployees[dateKey] = new Set()
      }
      dailyEmployees[dateKey].add(entry.employeeId)
    })
    Object.entries(dailyEmployees).forEach(([date, empSet]) => {
      if (dailyStats[date]) {
        dailyStats[date].employeeCount = empSet.size
      }
    })

    // Count unique employees per role
    const roleEmployees: Record<string, Set<string>> = {}
    entries.forEach(entry => {
      const role = entry.employee.role?.name || 'Unknown'
      if (!roleEmployees[role]) {
        roleEmployees[role] = new Set()
      }
      roleEmployees[role].add(entry.employeeId)
    })
    Object.entries(roleEmployees).forEach(([role, empSet]) => {
      if (roleStats[role]) {
        roleStats[role].employees = empSet.size
      }
    })

    // Format reports
    const employeeReport = Object.values(employeeStats)
      .map(emp => ({
        ...emp,
        regularHours: roundMoney(emp.regularHours),
        overtimeHours: roundMoney(emp.overtimeHours),
        totalHours: roundMoney(emp.totalHours),
        laborCost: roundMoney(emp.laborCost),
        avgHoursPerShift: emp.shifts > 0
          ? roundMoney(emp.totalHours / emp.shifts)
          : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours)

    const dailyReport = Object.values(dailyStats)
      .map(day => ({
        ...day,
        regularHours: roundMoney(day.regularHours),
        overtimeHours: roundMoney(day.overtimeHours),
        totalHours: roundMoney(day.regularHours + day.overtimeHours),
        laborCost: roundMoney(day.laborCost),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    const roleReport = Object.values(roleStats)
      .map(role => ({
        ...role,
        totalHours: roundMoney(role.totalHours),
        laborCost: roundMoney(role.laborCost),
        avgHoursPerShift: role.shifts > 0
          ? roundMoney(role.totalHours / role.shifts)
          : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours)

    // Calculate labor cost as percentage of sales (if we have sales data)
    let laborCostPercent = null
    try {
      const salesFilter: Record<string, unknown> = { locationId, status: { in: [...REVENUE_ORDER_STATUSES] }, deletedAt: null }
      if (startDate || endDate) {
        const dateRange: Record<string, Date> = {}
        if (startDate) dateRange.gte = new Date(startDate)
        if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')
        salesFilter.OR = [
          { businessDayDate: dateRange },
          { businessDayDate: null, createdAt: dateRange },
        ]
      }
      const salesAgg = await db.orderSnapshot.aggregate({
        where: salesFilter,
        _sum: { subtotalCents: true },
      })
      const totalSales = (salesAgg._sum.subtotalCents || 0) / 100
      if (totalSales > 0) {
        laborCostPercent = Math.round((totalLaborCost / totalSales) * 10000) / 100
      }
    } catch {
      // Ignore sales calculation errors
    }

    return NextResponse.json({ data: {
      summary: {
        totalShifts,
        totalRegularHours: roundMoney(totalRegularHours),
        totalOvertimeHours: roundMoney(totalOvertimeHours),
        totalHours: roundMoney(totalRegularHours + totalOvertimeHours),
        totalBreakMinutes,
        totalBreakHours: roundMoney(totalBreakMinutes / 60),
        totalLaborCost: roundMoney(totalLaborCost),
        laborCostPercent,
        avgHoursPerShift: totalShifts > 0
          ? roundMoney((totalRegularHours + totalOvertimeHours) / totalShifts)
          : 0,
        avgCostPerHour: (totalRegularHours + totalOvertimeHours) > 0
          ? roundMoney(totalLaborCost / (totalRegularHours + totalOvertimeHours))
          : 0,
      },
      byEmployee: employeeReport,
      byDay: dailyReport,
      byRole: roleReport,
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
      },
    } })
  } catch (error) {
    console.error('Failed to generate labor report:', error)
    return NextResponse.json(
      { error: 'Failed to generate labor report' },
      { status: 500 }
    )
  }
})

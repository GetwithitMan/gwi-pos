import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

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

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter
    const dateFilter: { clockIn?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.clockIn = { ...dateFilter.clockIn, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.clockIn = { ...dateFilter.clockIn, lte: new Date(endDate + 'T23:59:59') }
    }

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
      db.employee.findMany({
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

      // Calculate cost (overtime is 1.5x)
      const regularCost = regularHours * hourlyRate
      const overtimeCost = overtimeHours * hourlyRate * 1.5
      const entryCost = regularCost + overtimeCost

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
      employeeStats[empId].entries.push({
        date: entry.clockIn.toISOString().split('T')[0],
        clockIn: entry.clockIn.toISOString(),
        clockOut: entry.clockOut!.toISOString(),
        regularHours,
        overtimeHours,
        breakMinutes: breakMins,
        cost: Math.round(entryCost * 100) / 100,
      })

      // Daily stats
      const dateKey = entry.clockIn.toISOString().split('T')[0]
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
    entries.forEach(entry => {
      const dateKey = entry.clockIn.toISOString().split('T')[0]
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
        regularHours: Math.round(emp.regularHours * 100) / 100,
        overtimeHours: Math.round(emp.overtimeHours * 100) / 100,
        totalHours: Math.round(emp.totalHours * 100) / 100,
        laborCost: Math.round(emp.laborCost * 100) / 100,
        avgHoursPerShift: emp.shifts > 0
          ? Math.round((emp.totalHours / emp.shifts) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours)

    const dailyReport = Object.values(dailyStats)
      .map(day => ({
        ...day,
        regularHours: Math.round(day.regularHours * 100) / 100,
        overtimeHours: Math.round(day.overtimeHours * 100) / 100,
        totalHours: Math.round((day.regularHours + day.overtimeHours) * 100) / 100,
        laborCost: Math.round(day.laborCost * 100) / 100,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))

    const roleReport = Object.values(roleStats)
      .map(role => ({
        ...role,
        totalHours: Math.round(role.totalHours * 100) / 100,
        laborCost: Math.round(role.laborCost * 100) / 100,
        avgHoursPerShift: role.shifts > 0
          ? Math.round((role.totalHours / role.shifts) * 100) / 100
          : 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours)

    // Calculate labor cost as percentage of sales (if we have sales data)
    let laborCostPercent = null
    try {
      const salesFilter: Record<string, unknown> = { locationId, status: { in: ['completed', 'paid'] } }
      if (startDate || endDate) {
        salesFilter.createdAt = {}
        if (startDate) (salesFilter.createdAt as Record<string, Date>).gte = new Date(startDate)
        if (endDate) (salesFilter.createdAt as Record<string, Date>).lte = new Date(endDate + 'T23:59:59')
      }
      const salesAgg = await db.order.aggregate({
        where: salesFilter,
        _sum: { subtotal: true },
      })
      const totalSales = Number(salesAgg._sum.subtotal) || 0
      if (totalSales > 0) {
        laborCostPercent = Math.round((totalLaborCost / totalSales) * 10000) / 100
      }
    } catch {
      // Ignore sales calculation errors
    }

    return NextResponse.json({
      summary: {
        totalShifts,
        totalRegularHours: Math.round(totalRegularHours * 100) / 100,
        totalOvertimeHours: Math.round(totalOvertimeHours * 100) / 100,
        totalHours: Math.round((totalRegularHours + totalOvertimeHours) * 100) / 100,
        totalBreakMinutes,
        totalBreakHours: Math.round((totalBreakMinutes / 60) * 100) / 100,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        laborCostPercent,
        avgHoursPerShift: totalShifts > 0
          ? Math.round(((totalRegularHours + totalOvertimeHours) / totalShifts) * 100) / 100
          : 0,
        avgCostPerHour: (totalRegularHours + totalOvertimeHours) > 0
          ? Math.round((totalLaborCost / (totalRegularHours + totalOvertimeHours)) * 100) / 100
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
    })
  } catch (error) {
    console.error('Failed to generate labor report:', error)
    return NextResponse.json(
      { error: 'Failed to generate labor report' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET /api/reports/employee-meals — Employee meals report with date range
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VOIDS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0))
    const end = endDate ? new Date(endDate) : new Date()
    end.setHours(23, 59, 59, 999)

    // Get location settings for payroll tracking flag
    const location = await db.location.findFirst({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const trackForPayroll = settings.employeeMeals?.trackForPayroll ?? false

    // Query employee meal logs
    const mealLogs = await db.voidLog.findMany({
      where: {
        order: { locationId },
        createdAt: { gte: start, lte: end },
        reason: { in: ['Employee Meal', 'employee_meal', 'Employee meal', 'Emp Meal'] },
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
        order: {
          select: { orderNumber: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Get shifts worked in the same period to calculate per-shift ratio
    const employeeIds = [...new Set(mealLogs.map(l => l.employeeId))]
    const shifts = employeeIds.length > 0
      ? await db.shift.findMany({
          where: {
            locationId,
            employeeId: { in: employeeIds },
            startedAt: { gte: start, lte: end },
            deletedAt: null,
          },
          select: { employeeId: true },
        })
      : []

    const shiftsPerEmployee: Record<string, number> = {}
    for (const s of shifts) {
      shiftsPerEmployee[s.employeeId] = (shiftsPerEmployee[s.employeeId] || 0) + 1
    }

    // Build per-employee breakdown
    const employeeData: Record<string, {
      name: string
      mealCount: number
      totalValue: number
      values: number[]
      shiftsWorked: number
    }> = {}

    let grandTotalMeals = 0
    let grandTotalValue = 0

    for (const log of mealLogs) {
      const amount = Number(log.amount)
      const empName = log.employee.displayName ||
        `${log.employee.firstName} ${log.employee.lastName}`

      grandTotalMeals++
      grandTotalValue += amount

      if (!employeeData[log.employeeId]) {
        employeeData[log.employeeId] = {
          name: empName,
          mealCount: 0,
          totalValue: 0,
          values: [],
          shiftsWorked: shiftsPerEmployee[log.employeeId] || 0,
        }
      }
      employeeData[log.employeeId].mealCount++
      employeeData[log.employeeId].totalValue += amount
      employeeData[log.employeeId].values.push(amount)
    }

    const perEmployee = Object.entries(employeeData).map(([id, data]) => ({
      employeeId: id,
      employeeName: data.name,
      mealCount: data.mealCount,
      totalValue: Math.round(data.totalValue * 100) / 100,
      averageValue: data.values.length > 0
        ? Math.round((data.totalValue / data.values.length) * 100) / 100
        : 0,
      shiftsWorked: data.shiftsWorked,
      mealsPerShift: data.shiftsWorked > 0
        ? Math.round((data.mealCount / data.shiftsWorked) * 100) / 100
        : data.mealCount,
      ...(trackForPayroll ? {
        payrollDeduction: Math.round(data.totalValue * 100) / 100,
      } : {}),
    }))

    // Sort by total value descending
    perEmployee.sort((a, b) => b.totalValue - a.totalValue)

    // Individual meal entries for detail view
    const meals = mealLogs.map(log => ({
      id: log.id,
      employeeId: log.employeeId,
      employeeName: log.employee.displayName || `${log.employee.firstName} ${log.employee.lastName}`,
      orderId: log.orderId,
      orderNumber: log.order.orderNumber,
      amount: Number(log.amount),
      approvedById: log.approvedById,
      createdAt: log.createdAt.toISOString(),
    }))

    return NextResponse.json({
      data: {
        summary: {
          totalMeals: grandTotalMeals,
          totalValue: Math.round(grandTotalValue * 100) / 100,
          averageValue: grandTotalMeals > 0
            ? Math.round((grandTotalValue / grandTotalMeals) * 100) / 100
            : 0,
          uniqueEmployees: perEmployee.length,
          trackForPayroll,
          ...(trackForPayroll ? {
            totalPayrollDeduction: Math.round(grandTotalValue * 100) / 100,
          } : {}),
        },
        perEmployee,
        meals,
        dateRange: { start: start.toISOString(), end: end.toISOString() },
      },
    })
  } catch (error) {
    console.error('Failed to generate employee meals report:', error)
    return NextResponse.json({ error: 'Failed to generate employee meals report' }, { status: 500 })
  }
})

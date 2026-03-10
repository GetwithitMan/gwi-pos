import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET /api/employee-meals — List employee meals with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || employeeId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Require reports permission to view employee meals
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VOIDS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0))
    const end = endDate ? new Date(endDate) : new Date()
    end.setHours(23, 59, 59, 999)

    // Query VoidLog entries where reason matches employee meal patterns
    // Employee meals are tracked through comps with specific reasons
    const where: Record<string, unknown> = {
      order: { locationId },
      createdAt: { gte: start, lte: end },
      reason: {
        in: ['Employee Meal', 'employee_meal', 'Employee meal', 'Emp Meal'],
      },
    }
    if (employeeId) {
      where.employeeId = employeeId
    }

    const mealLogs = await db.voidLog.findMany({
      where,
      include: {
        order: {
          select: {
            orderNumber: true,
            orderType: true,
            tabName: true,
          },
        },
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get item names
    const itemIds = mealLogs.filter(l => l.itemId).map(l => l.itemId as string)
    const items = itemIds.length > 0
      ? await db.orderItem.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, name: true },
        })
      : []
    const itemMap = new Map(items.map(i => [i.id, i.name]))

    // Build summary
    const perEmployee: Record<string, {
      name: string
      mealCount: number
      totalValue: number
    }> = {}

    let totalMeals = 0
    let totalValue = 0

    const meals = mealLogs.map(log => {
      const amount = Number(log.amount)
      const employeeName = log.employee.displayName ||
        `${log.employee.firstName} ${log.employee.lastName}`

      totalMeals++
      totalValue += amount

      if (!perEmployee[log.employeeId]) {
        perEmployee[log.employeeId] = { name: employeeName, mealCount: 0, totalValue: 0 }
      }
      perEmployee[log.employeeId].mealCount++
      perEmployee[log.employeeId].totalValue += amount

      return {
        id: log.id,
        orderId: log.orderId,
        orderNumber: log.order.orderNumber,
        employeeId: log.employeeId,
        employeeName,
        amount,
        itemName: log.itemId ? itemMap.get(log.itemId) : null,
        createdAt: log.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      data: {
        meals,
        summary: {
          totalMeals,
          totalValue: Math.round(totalValue * 100) / 100,
          perEmployee: Object.entries(perEmployee).map(([id, data]) => ({
            employeeId: id,
            ...data,
            totalValue: Math.round(data.totalValue * 100) / 100,
          })),
        },
        dateRange: { start: start.toISOString(), end: end.toISOString() },
      },
    })
  } catch (error) {
    console.error('Failed to fetch employee meals:', error)
    return NextResponse.json({ error: 'Failed to fetch employee meals' }, { status: 500 })
  }
})

// POST /api/employee-meals — Record an employee meal (comp with tracking)
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, orderId, amount, items, managerId, locationId } = body as {
      employeeId: string
      orderId: string
      amount: number
      items?: string[]
      managerId?: string
      locationId?: string
    }

    if (!employeeId || !orderId || amount == null) {
      return NextResponse.json(
        { error: 'employeeId, orderId, and amount are required' },
        { status: 400 },
      )
    }

    // Resolve locationId from order if not provided
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { locationId: true, location: { select: { settings: true } } },
    })
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locId = locationId || order.locationId
    const settings = parseSettings(order.location.settings)
    const mealSettings = settings.employeeMeals

    if (!mealSettings?.enabled) {
      return NextResponse.json(
        { error: 'Employee meal tracking is not enabled' },
        { status: 400 },
      )
    }

    // Auth check
    const auth = await requirePermission(employeeId, locId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Validate employee is clocked in
    const activeClockEntry = await db.timeClockEntry.findFirst({
      where: { employeeId, clockOut: null, deletedAt: null },
      select: { id: true, clockIn: true },
    })
    if (!activeClockEntry) {
      return NextResponse.json(
        { error: 'Employee must be clocked in to record a meal' },
        { status: 400 },
      )
    }

    // Check meal allowance for current shift
    const shiftStart = activeClockEntry.clockIn
    const existingMeals = await db.voidLog.count({
      where: {
        employeeId,
        reason: { in: ['Employee Meal', 'employee_meal', 'Employee meal', 'Emp Meal'] },
        createdAt: { gte: shiftStart },
        order: { locationId: locId },
      },
    })

    if (existingMeals >= mealSettings.mealAllowancePerShift) {
      return NextResponse.json(
        { error: `Employee has already used ${mealSettings.mealAllowancePerShift} meal(s) this shift` },
        { status: 400 },
      )
    }

    // Check if manager approval is needed
    if (mealSettings.requireManagerApproval && amount > mealSettings.maxMealValue) {
      if (!managerId) {
        return NextResponse.json(
          { error: `Manager approval required for meals over $${mealSettings.maxMealValue.toFixed(2)}`, requiresApproval: true },
          { status: 403 },
        )
      }
      // Validate manager has permission
      const mgrAuth = await requirePermission(managerId, locId, PERMISSIONS.MGR_VOID_ITEMS)
      if (!mgrAuth.authorized) {
        return NextResponse.json(
          { error: 'Manager does not have approval permission' },
          { status: 403 },
        )
      }
    }

    // Record the employee meal via VoidLog (consistent with comp tracking)
    const mealLog = await db.voidLog.create({
      data: {
        locationId: locId,
        orderId,
        employeeId,
        voidType: 'item',
        amount,
        reason: 'Employee Meal',
        wasMade: true,
        approvedById: managerId || null,
        approvedAt: managerId ? new Date() : null,
      },
    })

    // Also create audit log entry
    void db.auditLog.create({
      data: {
        locationId: locId,
        employeeId,
        action: 'employee_meal',
        entityType: 'order',
        entityId: orderId,
        details: {
          amount,
          items: items || [],
          shiftStart: shiftStart.toISOString(),
          mealsThisShift: existingMeals + 1,
          maxAllowed: mealSettings.mealAllowancePerShift,
          approvedBy: managerId || null,
        },
      },
    }).catch(console.error)

    return NextResponse.json({
      data: {
        id: mealLog.id,
        employeeId,
        orderId,
        amount,
        mealsUsedThisShift: existingMeals + 1,
        maxMealsPerShift: mealSettings.mealAllowancePerShift,
      },
    })
  } catch (error) {
    console.error('Failed to record employee meal:', error)
    return NextResponse.json({ error: 'Failed to record employee meal' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'

/**
 * GET /api/reports/waste
 *
 * Returns waste analytics for a date range, aggregated by reason, item, employee, and day.
 *
 * Query params:
 *   - locationId (required)
 *   - startDate / endDate (YYYY-MM-DD, defaults to current month)
 *   - requestingEmployeeId (for auth + rate-limiting)
 */
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

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Resolve timezone for date range conversion
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    // Default to current month
    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const range = dateRangeToUTC(startDate || defaultStart, endDate || defaultEnd, timezone)
    const dateFilter = { gte: range.start, lte: range.end }

    // Fetch WasteLog entries for the location and date range
    const wasteLogs = await db.wasteLog.findMany({
      where: {
        locationId,
        businessDate: dateFilter,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            category: true,
            department: true,
          },
        },
      },
      orderBy: { businessDate: 'desc' },
    })

    // Fetch employee names for recordedById values
    const employeeIds = [...new Set(wasteLogs.map(w => w.recordedById).filter(Boolean))]
    const employees = employeeIds.length > 0
      ? await db.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, displayName: true, firstName: true, lastName: true },
        })
      : []
    const employeeMap = new Map(employees.map(e => [
      e.id,
      e.displayName || `${e.firstName} ${e.lastName || ''}`.trim(),
    ]))

    // Aggregate totals
    let totalWasteCost = 0
    let totalWasteQuantity = 0

    const byReasonMap = new Map<string, { cost: number; quantity: number; count: number }>()
    const byItemMap = new Map<string, { itemName: string; category: string; cost: number; quantity: number; count: number }>()
    const byEmployeeMap = new Map<string, { employeeName: string; cost: number; quantity: number; count: number }>()
    const byDayMap = new Map<string, { date: string; cost: number; quantity: number; count: number }>()

    for (const log of wasteLogs) {
      const cost = Number(log.cost)
      const quantity = Number(log.quantity)

      totalWasteCost += cost
      totalWasteQuantity += quantity

      // By reason
      const reason = log.reason
      if (byReasonMap.has(reason)) {
        const entry = byReasonMap.get(reason)!
        entry.cost += cost
        entry.quantity += quantity
        entry.count++
      } else {
        byReasonMap.set(reason, { cost, quantity, count: 1 })
      }

      // By item
      const itemName = log.inventoryItem?.name || 'Unknown Item'
      const itemCategory = log.inventoryItem?.category || 'Uncategorized'
      const itemKey = log.inventoryItemId || itemName
      if (byItemMap.has(itemKey)) {
        const entry = byItemMap.get(itemKey)!
        entry.cost += cost
        entry.quantity += quantity
        entry.count++
      } else {
        byItemMap.set(itemKey, { itemName, category: itemCategory, cost, quantity, count: 1 })
      }

      // By employee
      const empId = log.recordedById
      const empName = employeeMap.get(empId) || 'Unknown'
      if (byEmployeeMap.has(empId)) {
        const entry = byEmployeeMap.get(empId)!
        entry.cost += cost
        entry.quantity += quantity
        entry.count++
      } else {
        byEmployeeMap.set(empId, { employeeName: empName, cost, quantity, count: 1 })
      }

      // By day (for trend chart)
      const dayKey = log.businessDate.toISOString().split('T')[0]
      if (byDayMap.has(dayKey)) {
        const entry = byDayMap.get(dayKey)!
        entry.cost += cost
        entry.quantity += quantity
        entry.count++
      } else {
        byDayMap.set(dayKey, { date: dayKey, cost, quantity, count: 1 })
      }
    }

    // Build sorted aggregation arrays
    const byReason = Array.from(byReasonMap.entries())
      .map(([reason, data]) => ({ reason, ...data }))
      .sort((a, b) => b.cost - a.cost)

    const byItem = Array.from(byItemMap.values())
      .sort((a, b) => b.cost - a.cost)

    const byEmployee = Array.from(byEmployeeMap.values())
      .sort((a, b) => b.cost - a.cost)

    const byDay = Array.from(byDayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))

    // Build detail log entries
    const logs = wasteLogs.map(log => ({
      id: log.id,
      itemName: log.inventoryItem?.name || 'Unknown Item',
      category: log.inventoryItem?.category || 'Uncategorized',
      quantity: Number(log.quantity),
      unit: log.unit,
      cost: Number(log.cost),
      reason: log.reason,
      notes: log.notes,
      employeeName: employeeMap.get(log.recordedById) || 'Unknown',
      businessDate: log.businessDate.toISOString(),
      createdAt: log.createdAt.toISOString(),
    }))

    // Determine top waste reason
    const topReason = byReason.length > 0 ? byReason[0].reason : null

    return NextResponse.json({
      data: {
        summary: {
          totalWasteCost,
          totalWasteQuantity,
          totalEntries: wasteLogs.length,
          topReason,
        },
        byReason,
        byItem,
        byEmployee,
        byDay,
        logs,
        dateRange: { start: range.start.toISOString(), end: range.end.toISOString() },
      },
    })
  } catch (error) {
    console.error('Failed to generate waste report:', error)
    return NextResponse.json({ error: 'Failed to generate waste report' }, { status: 500 })
  }
})

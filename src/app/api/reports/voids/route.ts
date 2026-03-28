import { NextRequest } from 'next/server'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { getVoidLogsDetailed, getOrderItemNames } from '@/lib/query-services'
import { err, ok } from '@/lib/api-response'

// GET - Get void/comp report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const voidType = searchParams.get('type') // 'item' or 'order'
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VOIDS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build date range using business day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay?.dayStartTime || '04:00'
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    let start: Date
    let end: Date
    if (startDate) {
      const range = getBusinessDayRange(startDate, dayStartTime, timezone)
      start = range.start
      end = endDate ? getBusinessDayRange(endDate, dayStartTime, timezone).end : range.end
    } else {
      const current = getCurrentBusinessDay(dayStartTime, timezone)
      start = current.start
      end = current.end
    }

    // Get void logs via query service
    const voidLogs = await getVoidLogsDetailed(
      locationId,
      { start, end },
      { employeeId: employeeId || undefined, voidType: voidType || undefined },
    )

    // Get item names for item voids via query service
    const itemIds = voidLogs
      .filter(log => log.itemId)
      .map(log => log.itemId as string)

    const itemMap = await getOrderItemNames(itemIds)

    // Calculate summary
    const summary = {
      totalVoids: 0,
      totalComps: 0,
      voidAmount: 0,
      compAmount: 0,
      byEmployee: {} as Record<string, { name: string; voids: number; comps: number; amount: number }>,
      byReason: {} as Record<string, { count: number; amount: number }>,
    }

    const logs = voidLogs.map(log => {
      const employeeName = log.employee.displayName ||
        `${log.employee.firstName} ${log.employee.lastName}`

      // Determine if this is a comp or void based on the item status
      // For simplicity, we'll check the reason - comps usually mention "comp", "free", etc.
      const isComp = log.reason.toLowerCase().includes('comp') ||
        log.reason.toLowerCase().includes('free') ||
        log.reason.toLowerCase().includes('employee') ||
        log.reason.toLowerCase().includes('birthday') ||
        log.reason.toLowerCase().includes('vip') ||
        log.reason.toLowerCase().includes('quality')

      const amount = Number(log.amount)

      if (isComp) {
        summary.totalComps++
        summary.compAmount += amount
      } else {
        summary.totalVoids++
        summary.voidAmount += amount
      }

      // By employee
      if (!summary.byEmployee[log.employeeId]) {
        summary.byEmployee[log.employeeId] = {
          name: employeeName,
          voids: 0,
          comps: 0,
          amount: 0,
        }
      }
      if (isComp) {
        summary.byEmployee[log.employeeId].comps++
      } else {
        summary.byEmployee[log.employeeId].voids++
      }
      summary.byEmployee[log.employeeId].amount += amount

      // By reason
      if (!summary.byReason[log.reason]) {
        summary.byReason[log.reason] = { count: 0, amount: 0 }
      }
      summary.byReason[log.reason].count++
      summary.byReason[log.reason].amount += amount

      return {
        id: log.id,
        orderId: log.orderId,
        orderNumber: log.order.orderNumber,
        orderType: log.order.orderType,
        tabName: log.order.tabName,
        voidType: log.voidType,
        itemId: log.itemId,
        itemName: log.itemId ? itemMap.get(log.itemId) : null,
        amount,
        reason: log.reason,
        isComp,
        employeeId: log.employeeId,
        employeeName,
        approvedById: log.approvedById,
        approvedAt: log.approvedAt?.toISOString() || null,
        createdAt: log.createdAt.toISOString(),
      }
    })

    return ok({
      logs,
      summary: {
        ...summary,
        byEmployee: Object.values(summary.byEmployee),
        byReason: Object.entries(summary.byReason).map(([reason, data]) => ({
          reason,
          ...data,
        })),
      },
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    })
  } catch (error) {
    console.error('Failed to fetch void report:', error)
    return err('Failed to fetch void report', 500)
  }
})

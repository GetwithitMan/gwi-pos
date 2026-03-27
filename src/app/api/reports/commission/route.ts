import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

// GET commission report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Auth: require report viewing permission
    const authEmployeeId = requestingEmployeeId || employeeId
    if (!authEmployeeId) {
      return NextResponse.json(
        { error: 'requestingEmployeeId or employeeId is required' },
        { status: 401 }
      )
    }
    // Self-access: employees can always view their own commission report
    const isSelfAccess = employeeId && requestingEmployeeId && employeeId === requestingEmployeeId
    if (!isSelfAccess) {
      const auth = await requirePermission(authEmployeeId, locationId, PERMISSIONS.REPORTS_COMMISSION)
      if (!auth.authorized) {
        return NextResponse.json({ error: auth.error }, { status: auth.status })
      }
    }

    // Get business day settings from cache for proper date boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    // Build date filter with businessDayDate OR-fallback
    const dateFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      const dateRange: { gte?: Date; lte?: Date } = {}
      if (startDate) {
        const startRange = getBusinessDayRange(startDate, dayStartTime, timezone)
        dateRange.gte = startRange.start
      }
      if (endDate) {
        const endRange = getBusinessDayRange(endDate, dayStartTime, timezone)
        dateRange.lte = endRange.end
      }
      dateFilter.OR = [
        { businessDayDate: dateRange },
        { businessDayDate: null, createdAt: dateRange },
      ]
    }

    // Build employee filter
    const employeeFilter = employeeId ? { employeeId } : {}

    // Paginated fetch: process orders in batches of 500 to avoid memory blowout on large date ranges.
    // Cursor-based pagination avoids OFFSET performance degradation.
    const BATCH_SIZE = 500
    const baseWhere = {
      locationId,
      deletedAt: null,
      isTraining: { not: true as const },
      ...dateFilter,
      ...employeeFilter,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      parentOrderId: null,
    }

    const employeeCommissions: Record<string, {
      employeeId: string
      employeeName: string
      orderCount: number
      totalCommission: number
      orders: {
        orderId: string
        orderNumber: string
        date: string
        commission: number
        items: { name: string; quantity: number; price: number; commissionRate: number | null; commissionType: string | null; commission: number }[]
      }[]
    }> = {}

    let cursor: string | undefined = undefined
    let hasMore = true

    const orderInclude = {
      employee: {
        select: { id: true, displayName: true, firstName: true, lastName: true },
      },
      items: {
        where: { status: 'active' as const, deletedAt: null },
        select: {
          quantity: true,
          itemTotal: true,
          commissionAmount: true,
          menuItem: { select: { id: true, name: true, commissionType: true, commissionValue: true } },
        },
      },
    }
    const orderBy = { id: 'asc' as const }

    // Helper to fetch a batch — separate function breaks TS circular inference from cursor reuse
    const fetchBatch = (cursorId: string | undefined) =>
      cursorId
        ? db.order.findMany({ where: baseWhere, include: orderInclude, orderBy, take: BATCH_SIZE, skip: 1, cursor: { id: cursorId } })
        : db.order.findMany({ where: baseWhere, include: orderInclude, orderBy, take: BATCH_SIZE })

    while (hasMore) {
      const batch = await fetchBatch(cursor)

      if (batch.length < BATCH_SIZE) {
        hasMore = false
      }
      if (batch.length > 0) {
        cursor = batch[batch.length - 1].id
      } else {
        break
      }

      // Process each order in the batch — aggregate into employeeCommissions
      for (const order of batch) {
        // Filter to orders that have commission (either on order or items)
        const orderCommissionRaw = Number(order.commissionTotal) || 0
        const itemCommissionSum = order.items.reduce((sum: number, item: any) => {
          return sum + (Number(item.commissionAmount) || 0)
        }, 0)
        if (orderCommissionRaw <= 0 && itemCommissionSum <= 0) continue

        if (!order.employee) continue

        const empId = order.employee.id
        if (!employeeCommissions[empId]) {
          employeeCommissions[empId] = {
            employeeId: empId,
            employeeName: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
            orderCount: 0,
            totalCommission: 0,
            orders: [],
          }
        }

        // Calculate commission from items if order.commissionTotal is 0
        let orderCommission = orderCommissionRaw

        // Get commission details per item
        const items = order.items
          .filter((item: any) => {
            const itemCommission = Number(item.commissionAmount) || 0
            const menuItemHasCommission = item.menuItem.commissionType && item.menuItem.commissionValue
            return itemCommission > 0 || menuItemHasCommission
          })
          .map((item: any) => {
            let commission = Number(item.commissionAmount) || 0
            if (commission === 0 && item.menuItem.commissionType && item.menuItem.commissionValue) {
              const value = Number(item.menuItem.commissionValue)
              if (item.menuItem.commissionType === 'percent') {
                commission = (Number(item.itemTotal) * value) / 100
              } else {
                commission = value * item.quantity
              }
            }
            return {
              name: item.menuItem.name,
              quantity: item.quantity,
              price: Number(item.itemTotal ?? 0),
              commissionRate: item.menuItem.commissionType === 'percent'
                ? Number(item.menuItem.commissionValue)
                : null,
              commissionType: item.menuItem.commissionType,
              commission,
            }
          })
          .filter((item: { commission: number }) => item.commission > 0)

        // If order commission is 0 but items have commission, sum them up
        if (orderCommission === 0 && items.length > 0) {
          orderCommission = items.reduce((sum: number, item: { commission: number }) => sum + item.commission, 0)
        }

        if (orderCommission > 0) {
          employeeCommissions[empId].orderCount += 1
          employeeCommissions[empId].totalCommission += orderCommission

          employeeCommissions[empId].orders.push({
            orderId: order.id,
            orderNumber: String(order.orderNumber),
            date: order.createdAt.toISOString(),
            commission: orderCommission,
            items,
          })
        }
      }
    }

    // Convert to array and sort by total commission descending
    const report = Object.values(employeeCommissions)
      .sort((a, b) => b.totalCommission - a.totalCommission)
      .map(emp => ({
        ...emp,
        totalCommission: Math.round(emp.totalCommission * 100) / 100,
        orders: emp.orders.map(o => ({
          ...o,
          commission: Math.round(o.commission * 100) / 100,
        })),
      }))

    // Calculate grand total
    const grandTotal = report.reduce((sum, emp) => sum + emp.totalCommission, 0)

    return NextResponse.json({ data: {
      report,
      summary: {
        totalEmployees: report.length,
        totalOrders: report.reduce((sum, emp) => sum + emp.orderCount, 0),
        grandTotalCommission: Math.round(grandTotal * 100) / 100,
      },
      filters: {
        startDate,
        endDate,
        employeeId,
        locationId,
      },
    } })
  } catch (error) {
    console.error('Failed to generate commission report:', error)
    return NextResponse.json(
      { error: 'Failed to generate commission report' },
      { status: 500 }
    )
  }
})

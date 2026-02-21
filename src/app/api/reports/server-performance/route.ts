import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/reports/server-performance
// Query params: startDate, endDate, locationId, requestingEmployeeId
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId =
      searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter on paidAt
    const paidAtFilter: { gte?: Date; lte?: Date } = {}
    if (startDate) {
      paidAtFilter.gte = new Date(startDate)
    }
    if (endDate) {
      paidAtFilter.lte = new Date(endDate + 'T23:59:59')
    }

    // Fetch all paid orders in the date range
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: 'paid',
        deletedAt: null,
        ...(Object.keys(paidAtFilter).length > 0 && { paidAt: paidAtFilter }),
      },
      select: {
        id: true,
        employeeId: true,
        tableId: true,
        total: true,
        tipTotal: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
      },
    })

    // Aggregate in JS — group by employeeId
    const serverMap: Record<
      string,
      {
        employeeId: string
        name: string
        totalSales: number
        totalTips: number
        orderCount: number
        tableIds: Set<string>
      }
    > = {}

    for (const order of orders) {
      const empId = order.employeeId
      const emp = order.employee

      if (!serverMap[empId]) {
        const name =
          emp.displayName ||
          `${emp.firstName} ${emp.lastName}`.trim()

        serverMap[empId] = {
          employeeId: empId,
          name,
          totalSales: 0,
          totalTips: 0,
          orderCount: 0,
          tableIds: new Set(),
        }
      }

      serverMap[empId].totalSales += Number(order.total) || 0
      serverMap[empId].totalTips += Number(order.tipTotal) || 0
      serverMap[empId].orderCount += 1

      if (order.tableId) {
        serverMap[empId].tableIds.add(order.tableId)
      }
    }

    // Build sorted server array
    const servers = Object.values(serverMap)
      .map((s) => {
        const avgCheckSize =
          s.orderCount > 0
            ? Math.round((s.totalSales / s.orderCount) * 100) / 100
            : 0
        const tableCount = s.tableIds.size

        return {
          employeeId: s.employeeId,
          name: s.name,
          totalSales: Math.round(s.totalSales * 100) / 100,
          totalTips: Math.round(s.totalTips * 100) / 100,
          orderCount: s.orderCount,
          avgCheckSize,
          tableCount,
          tableTurns: tableCount,
        }
      })
      .sort((a, b) => b.totalSales - a.totalSales)

    // Summary totals
    const totalRevenue = Math.round(
      servers.reduce((sum, s) => sum + s.totalSales, 0) * 100
    ) / 100
    const totalTips = Math.round(
      servers.reduce((sum, s) => sum + s.totalTips, 0) * 100
    ) / 100
    const totalOrders = servers.reduce((sum, s) => sum + s.orderCount, 0)
    const topServer = servers.length > 0 ? servers[0].name : null

    return NextResponse.json({
      data: {
        servers,
        summary: {
          totalRevenue,
          totalTips,
          totalOrders,
          topServer,
        },
        filters: {
          startDate,
          endDate,
          locationId,
        },
      },
    })
  } catch (error) {
    console.error('Failed to generate server performance report:', error)
    return NextResponse.json(
      { error: 'Failed to generate server performance report' },
      { status: 500 }
    )
  }
})

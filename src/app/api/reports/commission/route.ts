import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET commission report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')

    // Build date filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // Build employee filter
    const employeeFilter = employeeId ? { employeeId } : {}

    // Get orders with commission data
    const orders = await db.order.findMany({
      where: {
        ...dateFilter,
        ...employeeFilter,
        status: { in: ['completed', 'paid'] },
        commissionTotal: { gt: 0 },
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          where: { commissionAmount: { not: null } },
          include: {
            menuItem: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Aggregate by employee
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
        items: { name: string; commission: number }[]
      }[]
    }> = {}

    orders.forEach(order => {
      if (!order.employee) return

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

      const orderCommission = Number(order.commissionTotal)
      employeeCommissions[empId].orderCount += 1
      employeeCommissions[empId].totalCommission += orderCommission

      // Get commission details per item
      const items = order.items
        .filter(item => item.commissionAmount && Number(item.commissionAmount) > 0)
        .map(item => ({
          name: item.menuItem.name,
          commission: Number(item.commissionAmount),
        }))

      employeeCommissions[empId].orders.push({
        orderId: order.id,
        orderNumber: String(order.orderNumber),
        date: order.createdAt.toISOString(),
        commission: orderCommission,
        items,
      })
    })

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

    return NextResponse.json({
      report,
      summary: {
        totalEmployees: report.length,
        totalOrders: orders.length,
        grandTotalCommission: Math.round(grandTotal * 100) / 100,
      },
      filters: {
        startDate,
        endDate,
        employeeId,
      },
    })
  } catch (error) {
    console.error('Failed to generate commission report:', error)
    return NextResponse.json(
      { error: 'Failed to generate commission report' },
      { status: 500 }
    )
  }
}

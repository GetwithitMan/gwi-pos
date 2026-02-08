import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET commission report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const employeeId = searchParams.get('employeeId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')
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
    const auth = await requirePermission(authEmployeeId, locationId, PERMISSIONS.REPORTS_COMMISSION)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

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

    // Get orders with commission data (include all completed orders, filter by commission later)
    const orders = await db.order.findMany({
      where: {
        locationId,
        ...dateFilter,
        ...employeeFilter,
        status: { in: ['completed', 'paid'] },
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            menuItem: { select: { id: true, name: true, commissionType: true, commissionValue: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Filter to orders that have commission (either on order or items)
    const ordersWithCommission = orders.filter(order => {
      const orderCommission = Number(order.commissionTotal) || 0
      const itemCommission = order.items.reduce((sum, item) => {
        return sum + (Number(item.commissionAmount) || 0)
      }, 0)
      return orderCommission > 0 || itemCommission > 0
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

    ordersWithCommission.forEach(order => {
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

      // Calculate commission from items if order.commissionTotal is 0
      let orderCommission = Number(order.commissionTotal) || 0

      // Get commission details per item
      const items = order.items
        .filter(item => {
          const itemCommission = Number(item.commissionAmount) || 0
          // Also check if the menu item has commission configured
          const menuItemHasCommission = item.menuItem.commissionType && item.menuItem.commissionValue
          return itemCommission > 0 || menuItemHasCommission
        })
        .map(item => {
          let commission = Number(item.commissionAmount) || 0
          // If no commission on item but menu item has commission, calculate it
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
            commission,
          }
        })
        .filter(item => item.commission > 0)

      // If order commission is 0 but items have commission, sum them up
      if (orderCommission === 0 && items.length > 0) {
        orderCommission = items.reduce((sum, item) => sum + item.commission, 0)
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
        totalOrders: report.reduce((sum, emp) => sum + emp.orderCount, 0),
        grandTotalCommission: Math.round(grandTotal * 100) / 100,
      },
      filters: {
        startDate,
        endDate,
        employeeId,
        locationId,
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

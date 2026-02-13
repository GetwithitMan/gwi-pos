import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET employee performance report
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

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES_BY_EMPLOYEE, { soft: true })
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

    // Get all active employees
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
        ...(employeeId ? { id: employeeId } : {}),
      },
      include: {
        role: { select: { name: true } },
      },
    })

    // Get orders for the period
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['completed', 'paid'] },
        ...dateFilter,
        ...(employeeId ? { employeeId } : {}),
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        payments: {
          where: { status: 'completed' },
        },
        items: {
          select: { quantity: true, itemTotal: true, commissionAmount: true },
        },
      },
    })

    // Get time clock entries for the period
    const timeEntries = await db.timeClockEntry.findMany({
      where: {
        locationId,
        ...dateFilter,
        ...(employeeId ? { employeeId } : {}),
      },
    })

    // Initialize summary totals
    let totalSales = 0
    let totalTips = 0
    let totalOrders = 0
    let totalCommission = 0

    // Employee stats
    const employeeStats: Record<string, {
      id: string
      name: string
      role: string
      orders: number
      sales: number
      tips: number
      cashTips: number
      cardTips: number
      commission: number
      avgTicket: number
      itemsSold: number
      hoursWorked: number
      salesPerHour: number
      // Payment breakdown
      cashPayments: number
      cashAmount: number
      cardPayments: number
      cardAmount: number
      // Purse tracking (cash received vs owed)
      cashReceived: number
      cashOwed: number
      purseBalance: number
    }> = {}

    // Initialize all employees
    employees.forEach(emp => {
      const name = emp.displayName || `${emp.firstName} ${emp.lastName}`
      employeeStats[emp.id] = {
        id: emp.id,
        name,
        role: emp.role.name,
        orders: 0,
        sales: 0,
        tips: 0,
        cashTips: 0,
        cardTips: 0,
        commission: 0,
        avgTicket: 0,
        itemsSold: 0,
        hoursWorked: 0,
        salesPerHour: 0,
        cashPayments: 0,
        cashAmount: 0,
        cardPayments: 0,
        cardAmount: 0,
        cashReceived: 0,
        cashOwed: 0,
        purseBalance: 0,
      }
    })

    // Process orders
    orders.forEach(order => {
      const empId = order.employeeId
      if (!employeeStats[empId]) return

      const orderSubtotal = Number(order.subtotal)
      const orderTip = Number(order.tipTotal)
      const orderCommission = Number(order.commissionTotal)
      const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0)

      totalSales += orderSubtotal
      totalTips += orderTip
      totalOrders += 1
      totalCommission += orderCommission

      employeeStats[empId].orders += 1
      employeeStats[empId].sales += orderSubtotal
      employeeStats[empId].tips += orderTip
      employeeStats[empId].commission += orderCommission
      employeeStats[empId].itemsSold += itemCount

      // Process payments for this order
      order.payments.forEach(payment => {
        const paymentAmount = Number(payment.amount)
        const tipAmount = Number(payment.tipAmount)
        const totalAmount = Number(payment.totalAmount)
        const method = payment.paymentMethod.toLowerCase()

        if (method === 'cash') {
          employeeStats[empId].cashPayments += 1
          employeeStats[empId].cashAmount += paymentAmount
          employeeStats[empId].cashTips += tipAmount
          employeeStats[empId].cashReceived += totalAmount
        } else if (method === 'card' || method === 'credit' || method === 'debit') {
          employeeStats[empId].cardPayments += 1
          employeeStats[empId].cardAmount += paymentAmount
          employeeStats[empId].cardTips += tipAmount
        }
      })
    })

    // Process time entries
    timeEntries.forEach(entry => {
      const empId = entry.employeeId
      if (!employeeStats[empId]) return

      if (entry.clockOut) {
        const regularHours = Number(entry.regularHours) || 0
        const overtimeHours = Number(entry.overtimeHours) || 0
        employeeStats[empId].hoursWorked += regularHours + overtimeHours
      }
    })

    // Calculate derived metrics
    Object.values(employeeStats).forEach(emp => {
      if (emp.orders > 0) {
        emp.avgTicket = emp.sales / emp.orders
      }
      if (emp.hoursWorked > 0) {
        emp.salesPerHour = emp.sales / emp.hoursWorked
      }

      // Purse calculation: cash received - (cash sales + cash tips they keep)
      // Assuming employee keeps cash tips, they owe back the sales portion
      emp.cashOwed = emp.cashAmount // Sales portion they owe back
      emp.purseBalance = emp.cashReceived - emp.cashOwed // Should equal cash tips if correct
    })

    // Hourly breakdown
    const hourlyStats: Record<number, {
      hour: number
      sales: number
      orders: number
      tips: number
    }> = {}

    orders.forEach(order => {
      const hour = order.createdAt.getHours()
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { hour, sales: 0, orders: 0, tips: 0 }
      }
      hourlyStats[hour].sales += Number(order.subtotal)
      hourlyStats[hour].orders += 1
      hourlyStats[hour].tips += Number(order.tipTotal)
    })

    // Daily breakdown per employee
    const dailyStats: Record<string, Record<string, {
      date: string
      employeeId: string
      employeeName: string
      orders: number
      sales: number
      tips: number
    }>> = {}

    orders.forEach(order => {
      const dateKey = order.createdAt.toISOString().split('T')[0]
      const empId = order.employeeId
      const empName = employeeStats[empId]?.name || 'Unknown'
      const key = `${dateKey}-${empId}`

      if (!dailyStats[dateKey]) {
        dailyStats[dateKey] = {}
      }
      if (!dailyStats[dateKey][empId]) {
        dailyStats[dateKey][empId] = {
          date: dateKey,
          employeeId: empId,
          employeeName: empName,
          orders: 0,
          sales: 0,
          tips: 0,
        }
      }

      dailyStats[dateKey][empId].orders += 1
      dailyStats[dateKey][empId].sales += Number(order.subtotal)
      dailyStats[dateKey][empId].tips += Number(order.tipTotal)
    })

    // Format reports
    const employeeReport = Object.values(employeeStats)
      .map(emp => ({
        ...emp,
        sales: Math.round(emp.sales * 100) / 100,
        tips: Math.round(emp.tips * 100) / 100,
        cashTips: Math.round(emp.cashTips * 100) / 100,
        cardTips: Math.round(emp.cardTips * 100) / 100,
        commission: Math.round(emp.commission * 100) / 100,
        avgTicket: Math.round(emp.avgTicket * 100) / 100,
        hoursWorked: Math.round(emp.hoursWorked * 100) / 100,
        salesPerHour: Math.round(emp.salesPerHour * 100) / 100,
        cashAmount: Math.round(emp.cashAmount * 100) / 100,
        cardAmount: Math.round(emp.cardAmount * 100) / 100,
        cashReceived: Math.round(emp.cashReceived * 100) / 100,
        cashOwed: Math.round(emp.cashOwed * 100) / 100,
        purseBalance: Math.round(emp.purseBalance * 100) / 100,
      }))
      .filter(emp => emp.orders > 0 || emp.hoursWorked > 0)
      .sort((a, b) => b.sales - a.sales)

    const hourlyReport = Object.values(hourlyStats)
      .map(h => ({
        ...h,
        label: `${h.hour.toString().padStart(2, '0')}:00`,
        sales: Math.round(h.sales * 100) / 100,
        tips: Math.round(h.tips * 100) / 100,
        avgTicket: h.orders > 0 ? Math.round((h.sales / h.orders) * 100) / 100 : 0,
      }))
      .sort((a, b) => a.hour - b.hour)

    const dailyReport = Object.entries(dailyStats)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, employees]) => ({
        date,
        employees: Object.values(employees)
          .map(e => ({
            ...e,
            sales: Math.round(e.sales * 100) / 100,
            tips: Math.round(e.tips * 100) / 100,
          }))
          .sort((a, b) => b.sales - a.sales),
        totalSales: Object.values(employees).reduce((sum, e) => sum + e.sales, 0),
        totalTips: Object.values(employees).reduce((sum, e) => sum + e.tips, 0),
        totalOrders: Object.values(employees).reduce((sum, e) => sum + e.orders, 0),
      }))

    return NextResponse.json({
      summary: {
        totalEmployees: employeeReport.length,
        totalOrders,
        totalSales: Math.round(totalSales * 100) / 100,
        totalTips: Math.round(totalTips * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        avgTicket: totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : 0,
        avgTipPercent: totalSales > 0 ? Math.round((totalTips / totalSales) * 10000) / 100 : 0,
      },
      byEmployee: employeeReport,
      byHour: hourlyReport,
      byDay: dailyReport,
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
      },
    })
  } catch (error) {
    console.error('Failed to generate employee report:', error)
    return NextResponse.json(
      { error: 'Failed to generate employee report' },
      { status: 500 }
    )
  }
})

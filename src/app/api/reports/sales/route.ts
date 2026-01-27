import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET sales report
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const groupBy = searchParams.get('groupBy') || 'day' // day, category, item, employee, paymentMethod

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Build date filter
    const dateFilter: { createdAt?: { gte?: Date; lte?: Date } } = {}
    if (startDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, gte: new Date(startDate) }
    }
    if (endDate) {
      dateFilter.createdAt = { ...dateFilter.createdAt, lte: new Date(endDate + 'T23:59:59') }
    }

    // Get completed/paid orders
    const orders = await db.order.findMany({
      where: {
        locationId,
        ...dateFilter,
        status: { in: ['completed', 'paid'] },
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            menuItem: {
              select: { id: true, name: true, categoryId: true },
            },
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get categories for grouping
    const categories = await db.category.findMany({
      where: { locationId },
      select: { id: true, name: true },
    })
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    // Calculate summary stats
    let totalGrossSales = 0
    let totalTax = 0
    let totalDiscounts = 0
    let totalTips = 0
    let cashSales = 0
    let cardSales = 0
    let orderCount = 0
    let itemCount = 0

    // Grouping data structures
    const dailySales: Record<string, { date: string; orders: number; gross: number; net: number; tax: number; tips: number }> = {}
    const categorySales: Record<string, { name: string; quantity: number; gross: number }> = {}
    const itemSales: Record<string, { name: string; quantity: number; gross: number; category: string }> = {}
    const employeeSales: Record<string, { name: string; orders: number; gross: number }> = {}
    const hourlySales: Record<number, { hour: number; orders: number; gross: number }> = {}

    orders.forEach(order => {
      orderCount += 1
      const orderTotal = Number(order.total)
      const orderTax = Number(order.taxTotal)
      const orderDiscount = Number(order.discountTotal)

      totalGrossSales += Number(order.subtotal)
      totalTax += orderTax
      totalDiscounts += orderDiscount

      // Payment method breakdown
      order.payments.forEach(payment => {
        const amount = Number(payment.amount)
        const tip = Number(payment.tipAmount) || 0
        totalTips += tip

        if (payment.paymentMethod === 'cash') {
          cashSales += amount
        } else {
          cardSales += amount
        }
      })

      // Daily grouping
      const dateKey = order.createdAt.toISOString().split('T')[0]
      if (!dailySales[dateKey]) {
        dailySales[dateKey] = { date: dateKey, orders: 0, gross: 0, net: 0, tax: 0, tips: 0 }
      }
      dailySales[dateKey].orders += 1
      dailySales[dateKey].gross += Number(order.subtotal)
      dailySales[dateKey].net += orderTotal
      dailySales[dateKey].tax += orderTax
      order.payments.forEach(p => {
        dailySales[dateKey].tips += Number(p.tipAmount) || 0
      })

      // Hourly grouping
      const hour = order.createdAt.getHours()
      if (!hourlySales[hour]) {
        hourlySales[hour] = { hour, orders: 0, gross: 0 }
      }
      hourlySales[hour].orders += 1
      hourlySales[hour].gross += Number(order.subtotal)

      // Employee grouping
      if (order.employee) {
        const empId = order.employee.id
        const empName = order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`
        if (!employeeSales[empId]) {
          employeeSales[empId] = { name: empName, orders: 0, gross: 0 }
        }
        employeeSales[empId].orders += 1
        employeeSales[empId].gross += Number(order.subtotal)
      }

      // Item and category grouping
      order.items.forEach(item => {
        itemCount += item.quantity

        const itemId = item.menuItemId
        const itemName = item.menuItem.name
        const categoryId = item.menuItem.categoryId
        const categoryName = categoryMap.get(categoryId) || 'Unknown'
        const itemTotal = Number(item.itemTotal)

        // Category sales
        if (!categorySales[categoryId]) {
          categorySales[categoryId] = { name: categoryName, quantity: 0, gross: 0 }
        }
        categorySales[categoryId].quantity += item.quantity
        categorySales[categoryId].gross += itemTotal

        // Item sales
        if (!itemSales[itemId]) {
          itemSales[itemId] = { name: itemName, quantity: 0, gross: 0, category: categoryName }
        }
        itemSales[itemId].quantity += item.quantity
        itemSales[itemId].gross += itemTotal
      })
    })

    // Sort and format grouped data
    const dailyReport = Object.values(dailySales)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => ({
        ...d,
        gross: Math.round(d.gross * 100) / 100,
        net: Math.round(d.net * 100) / 100,
        tax: Math.round(d.tax * 100) / 100,
        tips: Math.round(d.tips * 100) / 100,
      }))

    const hourlyReport = Object.values(hourlySales)
      .sort((a, b) => a.hour - b.hour)
      .map(h => ({
        ...h,
        label: `${h.hour.toString().padStart(2, '0')}:00`,
        gross: Math.round(h.gross * 100) / 100,
      }))

    const categoryReport = Object.entries(categorySales)
      .map(([id, data]) => ({ id, ...data, gross: Math.round(data.gross * 100) / 100 }))
      .sort((a, b) => b.gross - a.gross)

    const itemReport = Object.entries(itemSales)
      .map(([id, data]) => ({ id, ...data, gross: Math.round(data.gross * 100) / 100 }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 20) // Top 20 items

    const employeeReport = Object.entries(employeeSales)
      .map(([id, data]) => ({ id, ...data, gross: Math.round(data.gross * 100) / 100 }))
      .sort((a, b) => b.gross - a.gross)

    return NextResponse.json({
      summary: {
        orderCount,
        itemCount,
        grossSales: Math.round(totalGrossSales * 100) / 100,
        discounts: Math.round(totalDiscounts * 100) / 100,
        netSales: Math.round((totalGrossSales - totalDiscounts) * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        tips: Math.round(totalTips * 100) / 100,
        total: Math.round((totalGrossSales - totalDiscounts + totalTax) * 100) / 100,
        cashSales: Math.round(cashSales * 100) / 100,
        cardSales: Math.round(cardSales * 100) / 100,
        averageOrderValue: orderCount > 0 ? Math.round((totalGrossSales / orderCount) * 100) / 100 : 0,
      },
      byDay: dailyReport,
      byHour: hourlyReport,
      byCategory: categoryReport,
      byItem: itemReport,
      byEmployee: employeeReport,
      filters: {
        startDate,
        endDate,
        locationId,
      },
    })
  } catch (error) {
    console.error('Failed to generate sales report:', error)
    return NextResponse.json(
      { error: 'Failed to generate sales report' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET sales report with comprehensive groupings
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType')
    const tableId = searchParams.get('tableId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || employeeId

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES, { soft: true })
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

    // Build additional filters
    const additionalFilters: Record<string, unknown> = {}
    if (employeeId) additionalFilters.employeeId = employeeId
    if (orderType) additionalFilters.orderType = orderType
    if (tableId) additionalFilters.tableId = tableId

    // Get completed/paid orders with all related data
    const orders = await db.order.findMany({
      where: {
        locationId,
        ...dateFilter,
        ...additionalFilters,
        status: { in: ['completed', 'paid'] },
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        table: {
          select: { id: true, name: true, sectionId: true },
        },
        items: {
          include: {
            menuItem: {
              select: { id: true, name: true, categoryId: true },
            },
            modifiers: {
              select: { id: true, name: true, price: true, modifierId: true },
            },
          },
        },
        payments: true,
        discounts: {
          include: {
            discountRule: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Get categories and tables for grouping
    const categories = await db.category.findMany({
      where: { locationId },
      select: { id: true, name: true },
    })
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    const tables = await db.table.findMany({
      where: { locationId },
      select: { id: true, name: true, sectionId: true },
    })
    const tableMap = new Map(tables.map(t => [t.id, t.name]))

    const sections = await db.section.findMany({
      where: { locationId },
      select: { id: true, name: true },
    })
    const sectionMap = new Map(sections.map(s => [s.id, s.name]))

    // Initialize summary stats
    let totalGrossSales = 0
    let totalTax = 0
    let totalTaxFromInclusive = 0
    let totalTaxFromExclusive = 0
    let totalDiscounts = 0
    let totalTips = 0
    let cashSales = 0
    let cardSales = 0
    let orderCount = 0
    let itemCount = 0
    let guestCount = 0

    // Grouping data structures
    const dailySales: Record<string, { date: string; orders: number; gross: number; net: number; tax: number; tips: number; guests: number }> = {}
    const hourlySales: Record<number, { hour: number; orders: number; gross: number }> = {}
    const categorySales: Record<string, { name: string; quantity: number; gross: number }> = {}
    const itemSales: Record<string, { name: string; quantity: number; gross: number; category: string }> = {}
    const employeeSales: Record<string, { name: string; orders: number; gross: number; tips: number; itemCount: number }> = {}
    const tableSales: Record<string, { name: string; orders: number; gross: number; guests: number; avgTicket: number; turnTime: number[]; avgTurnTimeMinutes?: number }> = {}
    const seatSales: Record<number, { seat: number; itemCount: number; gross: number }> = {}
    const orderTypeSales: Record<string, { type: string; orders: number; gross: number; avgTicket: number }> = {}
    const modifierSales: Record<string, { name: string; quantity: number; gross: number }> = {}
    const paymentMethodSales: Record<string, { method: string; count: number; amount: number; tips: number }> = {}

    orders.forEach(order => {
      orderCount += 1
      guestCount += order.guestCount
      const orderSubtotal = Number(order.subtotal)
      const orderTax = Number(order.taxTotal)
      const orderDiscount = Number(order.discountTotal)

      totalGrossSales += orderSubtotal
      totalTax += orderTax
      totalTaxFromInclusive += Number(order.taxFromInclusive) || 0
      totalTaxFromExclusive += Number(order.taxFromExclusive) || 0
      totalDiscounts += orderDiscount

      // Payment method breakdown
      order.payments.forEach(payment => {
        const amount = Number(payment.amount)
        const tip = Number(payment.tipAmount) || 0
        totalTips += tip

        const method = payment.paymentMethod
        if (!paymentMethodSales[method]) {
          paymentMethodSales[method] = { method, count: 0, amount: 0, tips: 0 }
        }
        paymentMethodSales[method].count += 1
        paymentMethodSales[method].amount += amount
        paymentMethodSales[method].tips += tip

        if (payment.paymentMethod === 'cash') {
          cashSales += amount
        } else {
          cardSales += amount
        }
      })

      // Daily grouping
      const dateKey = order.createdAt.toISOString().split('T')[0]
      if (!dailySales[dateKey]) {
        dailySales[dateKey] = { date: dateKey, orders: 0, gross: 0, net: 0, tax: 0, tips: 0, guests: 0 }
      }
      dailySales[dateKey].orders += 1
      dailySales[dateKey].gross += orderSubtotal
      dailySales[dateKey].net += Number(order.total)
      dailySales[dateKey].tax += orderTax
      dailySales[dateKey].guests += order.guestCount
      order.payments.forEach(p => {
        dailySales[dateKey].tips += Number(p.tipAmount) || 0
      })

      // Hourly grouping
      const hour = order.createdAt.getHours()
      if (!hourlySales[hour]) {
        hourlySales[hour] = { hour, orders: 0, gross: 0 }
      }
      hourlySales[hour].orders += 1
      hourlySales[hour].gross += orderSubtotal

      // Employee grouping
      if (order.employee) {
        const empId = order.employee.id
        const empName = order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`
        if (!employeeSales[empId]) {
          employeeSales[empId] = { name: empName, orders: 0, gross: 0, tips: 0, itemCount: 0 }
        }
        employeeSales[empId].orders += 1
        employeeSales[empId].gross += orderSubtotal
        order.payments.forEach(p => {
          employeeSales[empId].tips += Number(p.tipAmount) || 0
        })
        employeeSales[empId].itemCount += order.items.reduce((sum, i) => sum + i.quantity, 0)
      }

      // Table grouping
      if (order.tableId && order.table) {
        const tblId = order.tableId
        const tblName = order.table.name
        if (!tableSales[tblId]) {
          tableSales[tblId] = { name: tblName, orders: 0, gross: 0, guests: 0, avgTicket: 0, turnTime: [] }
        }
        tableSales[tblId].orders += 1
        tableSales[tblId].gross += orderSubtotal
        tableSales[tblId].guests += order.guestCount

        // Calculate turn time if order has paidAt
        if (order.paidAt) {
          const turnTimeMinutes = (order.paidAt.getTime() - order.createdAt.getTime()) / (1000 * 60)
          tableSales[tblId].turnTime.push(turnTimeMinutes)
        }
      }

      // Order type grouping
      const oType = order.orderType
      if (!orderTypeSales[oType]) {
        orderTypeSales[oType] = { type: oType, orders: 0, gross: 0, avgTicket: 0 }
      }
      orderTypeSales[oType].orders += 1
      orderTypeSales[oType].gross += orderSubtotal

      // Item, category, seat, and modifier grouping
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

        // Seat sales
        if (item.seatNumber !== null && item.seatNumber !== undefined) {
          const seat = item.seatNumber
          if (!seatSales[seat]) {
            seatSales[seat] = { seat, itemCount: 0, gross: 0 }
          }
          seatSales[seat].itemCount += item.quantity
          seatSales[seat].gross += itemTotal
        }

        // Modifier sales
        item.modifiers.forEach(mod => {
          const modKey = mod.modifierId || mod.name
          if (!modifierSales[modKey]) {
            modifierSales[modKey] = { name: mod.name, quantity: 0, gross: 0 }
          }
          modifierSales[modKey].quantity += 1
          modifierSales[modKey].gross += Number(mod.price)
        })
      })
    })

    // Calculate averages for table sales
    Object.values(tableSales).forEach(table => {
      table.avgTicket = table.orders > 0 ? table.gross / table.orders : 0
      // Calculate average turn time
      if (table.turnTime.length > 0) {
        const avgTurn = table.turnTime.reduce((a, b) => a + b, 0) / table.turnTime.length
        table.avgTurnTimeMinutes = Math.round(avgTurn)
      }
    })

    // Calculate averages for order type sales
    Object.values(orderTypeSales).forEach(ot => {
      ot.avgTicket = ot.orders > 0 ? ot.gross / ot.orders : 0
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
      .slice(0, 50) // Top 50 items

    const employeeReport = Object.entries(employeeSales)
      .map(([id, data]) => ({
        id,
        ...data,
        gross: Math.round(data.gross * 100) / 100,
        tips: Math.round(data.tips * 100) / 100,
      }))
      .sort((a, b) => b.gross - a.gross)

    const tableReport = Object.entries(tableSales)
      .map(([id, data]) => ({
        id,
        name: data.name,
        orders: data.orders,
        guests: data.guests,
        gross: Math.round(data.gross * 100) / 100,
        avgTicket: Math.round(data.avgTicket * 100) / 100,
        avgTurnTimeMinutes: (data as Record<string, unknown>).avgTurnTimeMinutes || null,
      }))
      .sort((a, b) => b.gross - a.gross)

    const seatReport = Object.values(seatSales)
      .map(s => ({
        ...s,
        gross: Math.round(s.gross * 100) / 100,
      }))
      .sort((a, b) => a.seat - b.seat)

    const orderTypeReport = Object.values(orderTypeSales)
      .map(ot => ({
        ...ot,
        gross: Math.round(ot.gross * 100) / 100,
        avgTicket: Math.round(ot.avgTicket * 100) / 100,
      }))
      .sort((a, b) => b.gross - a.gross)

    const modifierReport = Object.entries(modifierSales)
      .map(([id, data]) => ({ id, ...data, gross: Math.round(data.gross * 100) / 100 }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 30) // Top 30 modifiers

    const paymentMethodReport = Object.values(paymentMethodSales)
      .map(pm => ({
        ...pm,
        amount: Math.round(pm.amount * 100) / 100,
        tips: Math.round(pm.tips * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount)

    return NextResponse.json({
      summary: {
        orderCount,
        itemCount,
        guestCount,
        // Back out hidden tax from inclusive items for accurate gross sales
        grossSales: Math.round((totalGrossSales - totalTaxFromInclusive) * 100) / 100,
        discounts: Math.round(totalDiscounts * 100) / 100,
        netSales: Math.round((totalGrossSales - totalTaxFromInclusive - totalDiscounts) * 100) / 100,
        tax: Math.round(totalTax * 100) / 100,
        taxFromInclusive: Math.round(totalTaxFromInclusive * 100) / 100,
        taxFromExclusive: Math.round(totalTaxFromExclusive * 100) / 100,
        tips: Math.round(totalTips * 100) / 100,
        total: Math.round((totalGrossSales - totalTaxFromInclusive - totalDiscounts + totalTax) * 100) / 100,
        cashSales: Math.round(cashSales * 100) / 100,
        cardSales: Math.round(cardSales * 100) / 100,
        averageOrderValue: orderCount > 0 ? Math.round(((totalGrossSales - totalTaxFromInclusive) / orderCount) * 100) / 100 : 0,
        averageGuestSpend: guestCount > 0 ? Math.round(((totalGrossSales - totalTaxFromInclusive) / guestCount) * 100) / 100 : 0,
      },
      byDay: dailyReport,
      byHour: hourlyReport,
      byCategory: categoryReport,
      byItem: itemReport,
      byEmployee: employeeReport,
      byTable: tableReport,
      bySeat: seatReport,
      byOrderType: orderTypeReport,
      byModifier: modifierReport,
      byPaymentMethod: paymentMethodReport,
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
        orderType,
        tableId,
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

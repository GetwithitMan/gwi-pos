import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, getPricingProgram } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { getBusinessDayRange } from '@/lib/business-day'
import { getHourInTimezone } from '@/lib/timezone'
import { REVENUE_ORDER_STATUSES, calculateSurchargeAmount, roundMoney } from '@/lib/domain/reports'

// GET sales report with comprehensive groupings
export const GET = withVenue(async function GET(request: NextRequest) {
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

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Build date filter with businessDayDate OR-fallback
    // Fetch dayStartTime from location settings for business day range calculation
    const reportLocationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = reportLocationSettings.businessDay?.dayStartTime || '04:00'

    const dateFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      // For businessDayDate (stored as a date): simple date range comparison
      const dateRange: { gte?: Date; lte?: Date } = {}
      if (startDate) dateRange.gte = new Date(startDate)
      if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')

      // For createdAt fallback (orders without businessDayDate): use business day time ranges
      const createdAtRange: { gte?: Date; lte?: Date } = {}
      if (startDate) {
        createdAtRange.gte = getBusinessDayRange(startDate, dayStartTime).start
      }
      if (endDate) {
        createdAtRange.lte = getBusinessDayRange(endDate, dayStartTime).end
      }

      dateFilter.OR = [
        { businessDayDate: dateRange },
        { businessDayDate: null, createdAt: createdAtRange },
      ]
    }

    // Build additional filters
    const additionalFilters: Record<string, unknown> = {}
    if (employeeId) additionalFilters.employeeId = employeeId
    if (orderType) additionalFilters.orderType = orderType
    if (tableId) additionalFilters.tableId = tableId

    // Fetch orders and reference data in parallel (all independent)
    const [orders, categories, tables, sections] = await Promise.all([
      // Completed/paid orders with all related data
      // Exclude split parents to prevent double-counting when pay-all-splits
      // marks the parent as 'paid' alongside its children.
      db.order.findMany({
        where: {
          locationId,
          deletedAt: null,
          ...dateFilter,
          ...additionalFilters,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          NOT: { splitOrders: { some: {} } },
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
                select: { id: true, name: true, categoryId: true, itemType: true },
              },
              modifiers: {
                where: { deletedAt: null },
                select: { id: true, name: true, price: true, modifierId: true },
              },
            },
          },
          payments: {
            where: { status: 'completed' },
          },
          discounts: {
            include: {
              discountRule: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      // Categories for grouping
      db.category.findMany({
        where: { locationId },
        select: { id: true, name: true },
      }),
      // Tables for grouping
      db.table.findMany({
        where: { locationId },
        select: { id: true, name: true, sectionId: true },
      }),
      // Sections for grouping
      db.section.findMany({
        where: { locationId },
        select: { id: true, name: true },
      }),
    ])

    const categoryMap = new Map(categories.map(c => [c.id, c.name]))
    const tableMap = new Map(tables.map(t => [t.id, t.name]))
    const sectionMap = new Map(sections.map(s => [s.id, s.name]))

    // Fetch location settings for surcharge pricing
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const pricingProgram = getPricingProgram(locationSettings)

    // Initialize summary stats
    let totalGrossSales = 0
    let totalTax = 0
    let totalTaxFromInclusive = 0
    let totalTaxFromExclusive = 0
    let totalDiscounts = 0
    let totalTips = 0
    let totalSurcharge = 0
    let cashSales = 0
    let cardSales = 0
    let orderCount = 0
    let itemCount = 0
    let guestCount = 0

    // Grouping data structures
    const dailySales: Record<string, { date: string; orders: number; gross: number; net: number; tax: number; tips: number; guests: number }> = {}
    const hourlySales: Record<number, { hour: number; orders: number; gross: number }> = {}
    const categorySales: Record<string, { name: string; quantity: number; gross: number }> = {}
    const itemSales: Record<string, { name: string; pricingOptionLabel: string | null; quantity: number; gross: number; category: string; soldByWeight: boolean; totalWeight: number; weightUnit: string | null }> = {}
    const employeeSales: Record<string, { name: string; orders: number; gross: number; tips: number; itemCount: number }> = {}
    const tableSales: Record<string, { name: string; orders: number; gross: number; guests: number; avgTicket: number; turnTime: number[]; avgTurnTimeMinutes?: number }> = {}
    const seatSales: Record<number, { seat: number; itemCount: number; gross: number }> = {}
    const orderTypeSales: Record<string, { type: string; orders: number; gross: number; avgTicket: number }> = {}
    const modifierSales: Record<string, { name: string; quantity: number; gross: number }> = {}
    const paymentMethodSales: Record<string, { method: string; count: number; amount: number; tips: number }> = {}
    const pricingTierSales: Record<string, { tier: string; count: number; total: number }> = {}

    // Entertainment tracking
    let entertainmentRevenue = 0
    let entertainmentSessions = 0
    let entertainmentTotalMinutes = 0
    const entertainmentByItem: Record<string, { name: string; sessions: number; revenue: number; totalMinutes: number }> = {}

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

        // Pricing tier tracking
        const tier = (payment as any).appliedPricingTier || (payment.paymentMethod === 'cash' ? 'cash' : 'credit')
        if (!pricingTierSales[tier]) {
          pricingTierSales[tier] = { tier, count: 0, total: 0 }
        }
        pricingTierSales[tier].count += 1
        pricingTierSales[tier].total += amount
      })

      // Surcharge calculation (dual pricing: surcharge on card-paid orders)
      if (pricingProgram.model === 'surcharge' && pricingProgram.enabled && pricingProgram.surchargePercent) {
        const hasCardPayment = order.payments.some(p => {
          const method = (p.paymentMethod || '').toLowerCase()
          return method === 'credit' || method === 'card'
        })
        if (hasCardPayment) {
          totalSurcharge += calculateSurchargeAmount(orderSubtotal, pricingProgram.surchargePercent)
        }
      }

      // Daily grouping — use businessDayDate when available, with timezone-aware formatting
      const tz = process.env.TIMEZONE || process.env.TZ
      const dateKey = order.businessDayDate
        ? (tz ? order.businessDayDate.toLocaleDateString('en-CA', { timeZone: tz }) : order.businessDayDate.toISOString().split('T')[0])
        : (tz ? order.createdAt.toLocaleDateString('en-CA', { timeZone: tz }) : order.createdAt.toISOString().split('T')[0])
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

      // Hourly grouping — timezone-aware
      const tz2 = process.env.TIMEZONE || process.env.TZ
      const hour = tz2 ? getHourInTimezone(order.createdAt, tz2) : order.createdAt.getHours()
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
      // Skip voided and comped items — they should not count toward category/item revenue
      order.items.filter(item => item.status !== 'voided' && item.status !== 'comped').forEach(item => {
        itemCount += item.quantity

        const itemId = item.pricingOptionLabel
          ? `${item.menuItemId}::${item.pricingOptionLabel}`
          : item.menuItemId
        const itemName = item.pricingOptionLabel
          ? `${item.menuItem.name} (${item.pricingOptionLabel})`
          : item.menuItem.name
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
        const isByWeight = item.soldByWeight === true
        const itemWeight = isByWeight && item.weight ? Number(item.weight) * item.quantity : 0
        if (!itemSales[itemId]) {
          itemSales[itemId] = { name: itemName, pricingOptionLabel: item.pricingOptionLabel || null, quantity: 0, gross: 0, category: categoryName, soldByWeight: isByWeight, totalWeight: 0, weightUnit: isByWeight ? (item.weightUnit || 'lb') : null }
        }
        itemSales[itemId].quantity += item.quantity
        itemSales[itemId].gross += itemTotal
        if (isByWeight) itemSales[itemId].totalWeight += itemWeight

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

        // Entertainment tracking — timed rental items with block time
        if (item.menuItem.itemType === 'timed_rental' && item.blockTimeStartedAt) {
          entertainmentRevenue += itemTotal
          entertainmentSessions += item.quantity
          const blockMin = item.blockTimeMinutes || 0
          entertainmentTotalMinutes += blockMin * item.quantity

          const entItemId = item.menuItemId
          if (!entertainmentByItem[entItemId]) {
            entertainmentByItem[entItemId] = { name: item.menuItem.name, sessions: 0, revenue: 0, totalMinutes: 0 }
          }
          entertainmentByItem[entItemId].sessions += item.quantity
          entertainmentByItem[entItemId].revenue += itemTotal
          entertainmentByItem[entItemId].totalMinutes += blockMin * item.quantity
        }
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
        gross: roundMoney(d.gross),
        net: roundMoney(d.net),
        tax: roundMoney(d.tax),
        tips: roundMoney(d.tips),
      }))

    const hourlyReport = Object.values(hourlySales)
      .sort((a, b) => a.hour - b.hour)
      .map(h => ({
        ...h,
        label: `${h.hour.toString().padStart(2, '0')}:00`,
        gross: roundMoney(h.gross),
      }))

    const categoryReport = Object.entries(categorySales)
      .map(([id, data]) => ({ id, ...data, gross: roundMoney(data.gross) }))
      .sort((a, b) => b.gross - a.gross)

    const itemReport = Object.entries(itemSales)
      .map(([id, data]) => ({
        id,
        ...data,
        gross: roundMoney(data.gross),
        totalWeight: roundMoney(data.totalWeight),
      }))
      .sort((a, b) => b.gross - a.gross)
      .slice(0, 50) // Top 50 items

    const employeeReport = Object.entries(employeeSales)
      .map(([id, data]) => ({
        id,
        ...data,
        gross: roundMoney(data.gross),
        tips: roundMoney(data.tips),
      }))
      .sort((a, b) => b.gross - a.gross)

    const tableReport = Object.entries(tableSales)
      .map(([id, data]) => ({
        id,
        name: data.name,
        orders: data.orders,
        guests: data.guests,
        gross: roundMoney(data.gross),
        avgTicket: roundMoney(data.avgTicket),
        avgTurnTimeMinutes: (data as Record<string, unknown>).avgTurnTimeMinutes || null,
      }))
      .sort((a, b) => b.gross - a.gross)

    const seatReport = Object.values(seatSales)
      .map(s => ({
        ...s,
        gross: roundMoney(s.gross),
      }))
      .sort((a, b) => a.seat - b.seat)

    const orderTypeReport = Object.values(orderTypeSales)
      .map(ot => ({
        ...ot,
        gross: roundMoney(ot.gross),
        avgTicket: roundMoney(ot.avgTicket),
      }))
      .sort((a, b) => b.gross - a.gross)

    const modifierReport = Object.entries(modifierSales)
      .map(([id, data]) => ({ id, ...data, gross: roundMoney(data.gross) }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 30) // Top 30 modifiers

    const paymentMethodReport = Object.values(paymentMethodSales)
      .map(pm => ({
        ...pm,
        amount: roundMoney(pm.amount),
        tips: roundMoney(pm.tips),
      }))
      .sort((a, b) => b.amount - a.amount)

    return NextResponse.json({ data: {
      summary: {
        orderCount,
        itemCount,
        guestCount,
        // Back out hidden tax from inclusive items for accurate gross sales
        grossSales: roundMoney(totalGrossSales - totalTaxFromInclusive),
        discounts: roundMoney(totalDiscounts),
        netSales: roundMoney(totalGrossSales - totalTaxFromInclusive - totalDiscounts),
        tax: roundMoney(totalTax),
        taxFromInclusive: roundMoney(totalTaxFromInclusive),
        taxFromExclusive: roundMoney(totalTaxFromExclusive),
        surcharge: roundMoney(totalSurcharge),
        tips: roundMoney(totalTips),
        total: roundMoney(totalGrossSales - totalTaxFromInclusive - totalDiscounts + totalTax + totalSurcharge),
        cashSales: roundMoney(cashSales),
        cardSales: roundMoney(cardSales),
        averageOrderValue: orderCount > 0 ? roundMoney((totalGrossSales - totalTaxFromInclusive) / orderCount) : 0,
        averageGuestSpend: guestCount > 0 ? roundMoney((totalGrossSales - totalTaxFromInclusive) / guestCount) : 0,
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
      pricingTierSummary: Object.values(pricingTierSales)
        .map(pt => ({ ...pt, total: roundMoney(pt.total) }))
        .sort((a, b) => b.total - a.total),
      entertainment: entertainmentSessions > 0 ? {
        revenue: roundMoney(entertainmentRevenue),
        sessions: entertainmentSessions,
        averageSessionMinutes: entertainmentSessions > 0 ? Math.round(entertainmentTotalMinutes / entertainmentSessions) : 0,
        topItem: Object.values(entertainmentByItem).sort((a, b) => b.revenue - a.revenue)[0]?.name || null,
      } : null,
      filters: {
        startDate,
        endDate,
        locationId,
        employeeId,
        orderType,
        tableId,
      },
    } })
  } catch (error) {
    console.error('Failed to generate sales report:', error)
    return NextResponse.json(
      { error: 'Failed to generate sales report' },
      { status: 500 }
    )
  }
})

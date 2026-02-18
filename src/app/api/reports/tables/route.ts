import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET table performance report
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const locationId = searchParams.get('locationId')
    const sectionId = searchParams.get('sectionId')
    const tableId = searchParams.get('tableId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
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

    // Get tables with their sections
    const tables = await db.table.findMany({
      where: {
        locationId,
        ...(sectionId ? { sectionId } : {}),
        ...(tableId ? { id: tableId } : {}),
      },
      include: {
        section: {
          select: { id: true, name: true, color: true },
        },
      },
    })

    // Get sections
    const sections = await db.section.findMany({
      where: { locationId },
      select: { id: true, name: true, color: true },
    })

    // Get orders for dine-in with table assignments
    const orders = await db.order.findMany({
      where: {
        locationId,
        tableId: { not: null },
        orderType: 'dine_in',
        status: { in: ['completed', 'paid'] },
        ...dateFilter,
        ...(tableId ? { tableId } : {}),
      },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            capacity: true,
            sectionId: true,
          },
        },
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        items: {
          select: { quantity: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Initialize summary
    let totalOrders = 0
    let totalGuests = 0
    let totalSales = 0
    let totalItems = 0
    const turnTimes: number[] = []

    // Group by table
    const tableStats: Record<string, {
      id: string
      name: string
      capacity: number
      sectionId: string | null
      sectionName: string | null
      orders: number
      guests: number
      sales: number
      itemsSold: number
      avgTicket: number
      avgGuests: number
      turnTimes: number[]
      avgTurnTimeMinutes: number | null
      utilizationRate: number
      salesPerSeat: number
    }> = {}

    // Group by section
    const sectionStats: Record<string, {
      id: string
      name: string
      color: string | null
      tableCount: number
      orders: number
      guests: number
      sales: number
      avgTicket: number
      avgTurnTimeMinutes: number | null
    }> = {}

    // Group by server
    const serverStats: Record<string, {
      id: string
      name: string
      orders: number
      guests: number
      sales: number
      avgTicket: number
      tablesServed: Set<string>
    }> = {}

    // Group by hour
    const hourlyStats: Record<number, {
      hour: number
      orders: number
      guests: number
      sales: number
    }> = {}

    // Initialize table stats from all tables
    tables.forEach(table => {
      tableStats[table.id] = {
        id: table.id,
        name: table.name,
        capacity: table.capacity,
        sectionId: table.sectionId,
        sectionName: table.section?.name || null,
        orders: 0,
        guests: 0,
        sales: 0,
        itemsSold: 0,
        avgTicket: 0,
        avgGuests: 0,
        turnTimes: [],
        avgTurnTimeMinutes: null,
        utilizationRate: 0,
        salesPerSeat: 0,
      }
    })

    // Initialize section stats
    sections.forEach(section => {
      sectionStats[section.id] = {
        id: section.id,
        name: section.name,
        color: section.color,
        tableCount: tables.filter(t => t.sectionId === section.id).length,
        orders: 0,
        guests: 0,
        sales: 0,
        avgTicket: 0,
        avgTurnTimeMinutes: null,
      }
    })

    // Process orders
    orders.forEach(order => {
      if (!order.tableId || !order.table) return

      const tableId = order.tableId
      const sectionId = order.table.sectionId
      const subtotal = Number(order.subtotal)
      const guests = order.guestCount
      const itemCount = order.items.reduce((sum, i) => sum + i.quantity, 0)

      totalOrders += 1
      totalGuests += guests
      totalSales += subtotal
      totalItems += itemCount

      // Calculate turn time if order has paidAt
      let turnTimeMinutes: number | null = null
      if (order.paidAt) {
        turnTimeMinutes = (order.paidAt.getTime() - order.createdAt.getTime()) / (1000 * 60)
        turnTimes.push(turnTimeMinutes)
      }

      // Table stats
      if (tableStats[tableId]) {
        tableStats[tableId].orders += 1
        tableStats[tableId].guests += guests
        tableStats[tableId].sales += subtotal
        tableStats[tableId].itemsSold += itemCount
        if (turnTimeMinutes !== null) {
          tableStats[tableId].turnTimes.push(turnTimeMinutes)
        }
      }

      // Section stats
      if (sectionId && sectionStats[sectionId]) {
        sectionStats[sectionId].orders += 1
        sectionStats[sectionId].guests += guests
        sectionStats[sectionId].sales += subtotal
      }

      // Server stats
      const serverId = order.employee.id
      const serverName = order.employee.displayName ||
        `${order.employee.firstName} ${order.employee.lastName}`
      if (!serverStats[serverId]) {
        serverStats[serverId] = {
          id: serverId,
          name: serverName,
          orders: 0,
          guests: 0,
          sales: 0,
          avgTicket: 0,
          tablesServed: new Set(),
        }
      }
      serverStats[serverId].orders += 1
      serverStats[serverId].guests += guests
      serverStats[serverId].sales += subtotal
      serverStats[serverId].tablesServed.add(tableId)

      // Hourly stats
      const hour = order.createdAt.getHours()
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { hour, orders: 0, guests: 0, sales: 0 }
      }
      hourlyStats[hour].orders += 1
      hourlyStats[hour].guests += guests
      hourlyStats[hour].sales += subtotal
    })

    // Calculate table averages and metrics
    Object.values(tableStats).forEach(table => {
      if (table.orders > 0) {
        table.avgTicket = table.sales / table.orders
        table.avgGuests = table.guests / table.orders
        table.salesPerSeat = table.sales / (table.capacity * table.orders)
      }
      if (table.turnTimes.length > 0) {
        table.avgTurnTimeMinutes = table.turnTimes.reduce((a, b) => a + b, 0) / table.turnTimes.length
      }
      // Calculate utilization rate (orders per day per capacity)
      // Simplified: orders relative to capacity
      if (table.capacity > 0 && totalOrders > 0) {
        table.utilizationRate = (table.orders / totalOrders) * 100
      }
    })

    // Calculate section averages
    const sectionTurnTimes: Record<string, number[]> = {}
    orders.forEach(order => {
      if (order.table?.sectionId && order.paidAt) {
        const turnTime = (order.paidAt.getTime() - order.createdAt.getTime()) / (1000 * 60)
        if (!sectionTurnTimes[order.table.sectionId]) {
          sectionTurnTimes[order.table.sectionId] = []
        }
        sectionTurnTimes[order.table.sectionId].push(turnTime)
      }
    })

    Object.values(sectionStats).forEach(section => {
      if (section.orders > 0) {
        section.avgTicket = section.sales / section.orders
      }
      const times = sectionTurnTimes[section.id]
      if (times && times.length > 0) {
        section.avgTurnTimeMinutes = times.reduce((a, b) => a + b, 0) / times.length
      }
    })

    // Calculate server averages
    Object.values(serverStats).forEach(server => {
      if (server.orders > 0) {
        server.avgTicket = server.sales / server.orders
      }
    })

    // Format reports
    const tableReport = Object.values(tableStats)
      .map(t => ({
        id: t.id,
        name: t.name,
        capacity: t.capacity,
        sectionName: t.sectionName,
        orders: t.orders,
        guests: t.guests,
        sales: Math.round(t.sales * 100) / 100,
        itemsSold: t.itemsSold,
        avgTicket: Math.round(t.avgTicket * 100) / 100,
        avgGuests: Math.round(t.avgGuests * 100) / 100,
        avgTurnTimeMinutes: t.avgTurnTimeMinutes ? Math.round(t.avgTurnTimeMinutes) : null,
        utilizationRate: Math.round(t.utilizationRate * 100) / 100,
        salesPerSeat: Math.round(t.salesPerSeat * 100) / 100,
      }))
      .sort((a, b) => b.sales - a.sales)

    const sectionReport = Object.values(sectionStats)
      .map(s => ({
        ...s,
        sales: Math.round(s.sales * 100) / 100,
        avgTicket: Math.round(s.avgTicket * 100) / 100,
        avgTurnTimeMinutes: s.avgTurnTimeMinutes ? Math.round(s.avgTurnTimeMinutes) : null,
      }))
      .sort((a, b) => b.sales - a.sales)

    const serverReport = Object.values(serverStats)
      .map(s => ({
        id: s.id,
        name: s.name,
        orders: s.orders,
        guests: s.guests,
        sales: Math.round(s.sales * 100) / 100,
        avgTicket: Math.round(s.avgTicket * 100) / 100,
        tablesServed: s.tablesServed.size,
      }))
      .sort((a, b) => b.sales - a.sales)

    const hourlyReport = Object.values(hourlyStats)
      .sort((a, b) => a.hour - b.hour)
      .map(h => ({
        ...h,
        label: `${h.hour.toString().padStart(2, '0')}:00`,
        sales: Math.round(h.sales * 100) / 100,
      }))

    // Calculate overall averages
    const avgTurnTime = turnTimes.length > 0
      ? Math.round(turnTimes.reduce((a, b) => a + b, 0) / turnTimes.length)
      : null

    return NextResponse.json({ data: {
      summary: {
        totalOrders,
        totalGuests,
        totalSales: Math.round(totalSales * 100) / 100,
        totalItems,
        avgTicket: totalOrders > 0 ? Math.round((totalSales / totalOrders) * 100) / 100 : 0,
        avgGuestsPerOrder: totalOrders > 0 ? Math.round((totalGuests / totalOrders) * 100) / 100 : 0,
        avgTurnTimeMinutes: avgTurnTime,
        totalTables: tables.length,
        tablesUsed: Object.values(tableStats).filter(t => t.orders > 0).length,
      },
      byTable: tableReport,
      bySection: sectionReport,
      byServer: serverReport,
      byHour: hourlyReport,
      filters: {
        startDate,
        endDate,
        locationId,
        sectionId,
        tableId,
      },
    } })
  } catch (error) {
    console.error('Failed to generate table report:', error)
    return NextResponse.json(
      { error: 'Failed to generate table report' },
      { status: 500 }
    )
  }
})

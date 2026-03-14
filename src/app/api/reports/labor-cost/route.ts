import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'

// I-2: Labor cost report — hours, wages, labor% by date/role/employee vs sales
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const groupBy = searchParams.get('groupBy') || 'date' // date|role|employee
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Default to last 7 days
    const end = endDate ? new Date(endDate + 'T23:59:59') : new Date()
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000)

    // Fetch time clock entries and sales in parallel
    const [entries, salesAgg] = await Promise.all([
      db.timeClockEntry.findMany({
        where: {
          locationId,
          clockIn: { gte: start, lte: end },
          clockOut: { not: null },
        },
        include: {
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
              hourlyRate: true,
              role: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { clockIn: 'asc' },
      }),
      db.orderSnapshot.aggregate({
        where: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          deletedAt: null,
          parentOrderId: null,
          OR: [
            { businessDayDate: { gte: start, lte: end } },
            { businessDayDate: null, createdAt: { gte: start, lte: end } },
          ],
        },
        _sum: { subtotalCents: true },
      }),
    ])

    const totalSales = (salesAgg._sum.subtotalCents || 0) / 100

    // Build grouped rows
    type Row = {
      key: string
      label: string
      hours: number
      wages: number
      sales: number
      laborPercent: number | null
    }

    const rowMap: Record<string, { label: string; hours: number; wages: number }> = {}

    entries.forEach(entry => {
      const rate = Number(entry.employee.hourlyRate) || 0
      const regular = Number(entry.regularHours) || 0
      const overtime = Number(entry.overtimeHours) || 0
      const totalHours = regular + overtime
      const cost = (regular * rate) + (overtime * rate * 1.5)

      let key: string
      let label: string

      switch (groupBy) {
        case 'role':
          key = entry.employee.role?.id || 'unknown'
          label = entry.employee.role?.name || 'Unknown'
          break
        case 'employee':
          key = entry.employeeId
          label = entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`
          break
        default: { // date
          const tz = process.env.TIMEZONE || process.env.TZ
          key = tz ? entry.clockIn.toLocaleDateString('en-CA', { timeZone: tz }) : entry.clockIn.toISOString().split('T')[0]
        }
          label = key
      }

      if (!rowMap[key]) {
        rowMap[key] = { label, hours: 0, wages: 0 }
      }
      rowMap[key].hours += totalHours
      rowMap[key].wages += cost
    })

    // For date grouping, get per-day sales
    let dailySales: Record<string, number> = {}
    if (groupBy === 'date') {
      const dailyOrders = await db.orderSnapshot.groupBy({
        by: ['businessDayDate'],
        where: {
          locationId,
          status: { in: [...REVENUE_ORDER_STATUSES] },
          deletedAt: null,
          parentOrderId: null,
          OR: [
            { businessDayDate: { gte: start, lte: end } },
            { businessDayDate: null, createdAt: { gte: start, lte: end } },
          ],
        },
        _sum: { subtotalCents: true },
      })
      const tzLc = process.env.TIMEZONE || process.env.TZ
      dailyOrders.forEach(d => {
        if (d.businessDayDate) {
          const key = tzLc ? d.businessDayDate.toLocaleDateString('en-CA', { timeZone: tzLc }) : d.businessDayDate.toISOString().split('T')[0]
          dailySales[key] = (d._sum.subtotalCents || 0) / 100
        }
      })
    }

    const rows: Row[] = Object.entries(rowMap).map(([key, val]) => {
      const sales = groupBy === 'date' ? (dailySales[key] || 0) : totalSales
      return {
        key,
        label: val.label,
        hours: Math.round(val.hours * 100) / 100,
        wages: Math.round(val.wages * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        laborPercent: sales > 0 ? Math.round((val.wages / sales) * 10000) / 100 : null,
      }
    }).sort((a, b) => groupBy === 'date' ? b.key.localeCompare(a.key) : b.wages - a.wages)

    const totalWages = rows.reduce((s, r) => s + r.wages, 0)
    const totalHours = rows.reduce((s, r) => s + r.hours, 0)

    return NextResponse.json({ data: {
      rows,
      summary: {
        totalHours: Math.round(totalHours * 100) / 100,
        totalWages: Math.round(totalWages * 100) / 100,
        totalSales: Math.round(totalSales * 100) / 100,
        laborPercent: totalSales > 0 ? Math.round((totalWages / totalSales) * 10000) / 100 : null,
      },
      filters: { startDate: start.toISOString(), endDate: end.toISOString(), groupBy },
    } })
  } catch (error) {
    console.error('Failed to generate labor cost report:', error)
    return NextResponse.json({ error: 'Failed to generate labor cost report' }, { status: 500 })
  }
})

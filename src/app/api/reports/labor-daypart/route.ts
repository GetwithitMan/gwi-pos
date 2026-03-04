import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// I-8: Day-part labor analysis — labor cost vs sales by daypart
const DAYPARTS = [
  { name: 'Breakfast', startHour: 6, endHour: 11 },
  { name: 'Lunch', startHour: 11, endHour: 15 },
  { name: 'Dinner', startHour: 15, endHour: 21 },
  { name: 'Late Night', startHour: 21, endHour: 26 }, // 26 = 2am next day
]

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const dateStr = searchParams.get('date')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_LABOR)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const targetDate = dateStr ? new Date(dateStr) : new Date()
    const dayStart = new Date(targetDate)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(targetDate)
    dayEnd.setHours(23, 59, 59, 999)
    // Extend to 2am next day for "Late Night"
    const extendedEnd = new Date(dayEnd)
    extendedEnd.setDate(extendedEnd.getDate() + 1)
    extendedEnd.setHours(2, 0, 0, 0)

    // Fetch time entries and orders for the day
    const [entries, orders] = await Promise.all([
      db.timeClockEntry.findMany({
        where: {
          locationId,
          clockIn: { lte: extendedEnd },
          OR: [
            { clockOut: { gte: dayStart } },
            { clockOut: null },
          ],
        },
        include: {
          employee: {
            select: { hourlyRate: true },
          },
        },
      }),
      db.orderSnapshot.findMany({
        where: {
          locationId,
          status: { in: ['completed', 'paid'] },
          deletedAt: null,
          OR: [
            { businessDayDate: { gte: dayStart, lte: dayEnd } },
            { businessDayDate: null, createdAt: { gte: dayStart, lte: extendedEnd } },
          ],
        },
        select: {
          subtotalCents: true,
          createdAt: true,
          businessDayDate: true,
        },
      }),
    ])

    // Allocate labor and sales to dayparts
    const daypartResults = DAYPARTS.map(dp => {
      // Calculate labor cost for this daypart
      let laborCost = 0
      entries.forEach(entry => {
        const rate = Number(entry.employee.hourlyRate) || 0
        if (rate === 0) return

        const clockIn = entry.clockIn
        const clockOut = entry.clockOut || new Date()

        // Calculate overlap with daypart
        const dpStart = new Date(dayStart)
        dpStart.setHours(dp.startHour % 24, 0, 0, 0)
        if (dp.startHour >= 24) dpStart.setDate(dpStart.getDate() + 1)

        const dpEnd = new Date(dayStart)
        dpEnd.setHours(dp.endHour % 24, 0, 0, 0)
        if (dp.endHour >= 24) dpEnd.setDate(dpEnd.getDate() + 1)

        const overlapStart = Math.max(clockIn.getTime(), dpStart.getTime())
        const overlapEnd = Math.min(clockOut.getTime(), dpEnd.getTime())

        if (overlapEnd > overlapStart) {
          const overlapHours = (overlapEnd - overlapStart) / (1000 * 60 * 60)
          laborCost += overlapHours * rate
        }
      })

      // Calculate sales for this daypart
      let sales = 0
      orders.forEach(order => {
        const orderTime = order.createdAt
        const hour = orderTime.getHours() + (orderTime.getHours() < 6 ? 24 : 0)
        if (hour >= dp.startHour && hour < dp.endHour) {
          sales += (order.subtotalCents || 0) / 100
        }
      })

      return {
        name: dp.name,
        hours: `${dp.startHour % 24}:00 - ${dp.endHour % 24}:00`,
        laborCost: Math.round(laborCost * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        laborPercent: sales > 0 ? Math.round((laborCost / sales) * 10000) / 100 : null,
      }
    })

    const totalLabor = daypartResults.reduce((s, d) => s + d.laborCost, 0)
    const totalSales = daypartResults.reduce((s, d) => s + d.sales, 0)

    return NextResponse.json({ data: {
      date: targetDate.toISOString().split('T')[0],
      dayparts: daypartResults,
      summary: {
        totalLaborCost: Math.round(totalLabor * 100) / 100,
        totalSales: Math.round(totalSales * 100) / 100,
        laborPercent: totalSales > 0 ? Math.round((totalLabor / totalSales) * 10000) / 100 : null,
      },
    } })
  } catch (error) {
    console.error('Failed to generate day-part labor analysis:', error)
    return NextResponse.json({ error: 'Failed to generate day-part labor analysis' }, { status: 500 })
  }
})

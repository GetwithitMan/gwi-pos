import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter
    const dateFilter: Record<string, unknown> = { locationId }
    if (startDate || endDate) {
      dateFilter.reservationDate = {}
      if (startDate) {
        (dateFilter.reservationDate as Record<string, Date>).gte = new Date(startDate)
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        ;(dateFilter.reservationDate as Record<string, Date>).lte = end
      }
    }

    // Get all reservations in period
    const reservations = await prisma.reservation.findMany({
      where: dateFilter,
      include: {
        table: {
          select: { id: true, name: true, capacity: true },
        },
      },
      orderBy: [{ reservationDate: 'desc' }, { reservationTime: 'desc' }],
    })

    // Get order data for reservations that have orderId
    const orderIds = reservations.filter(r => r.orderId).map(r => r.orderId as string)
    const orders = await prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNumber: true, total: true },
    })
    const orderMap = Object.fromEntries(orders.map(o => [o.id, o]))

    // Calculate summary stats
    const totalReservations = reservations.length
    const totalCovers = reservations.reduce((sum, r) => sum + r.partySize, 0)
    const statusCounts = reservations.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    }, {} as Record<string, number>)

    const completedReservations = reservations.filter(r => r.status === 'completed')
    const noShowReservations = reservations.filter(r => r.status === 'no_show')
    const cancelledReservations = reservations.filter(r => r.status === 'cancelled')

    const noShowRate = totalReservations > 0 ? (noShowReservations.length / totalReservations) * 100 : 0
    const cancellationRate = totalReservations > 0 ? (cancelledReservations.length / totalReservations) * 100 : 0
    const completionRate = totalReservations > 0 ? (completedReservations.length / totalReservations) * 100 : 0

    // Revenue from completed reservations
    const totalRevenue = completedReservations.reduce((sum, r) => {
      const order = r.orderId ? orderMap[r.orderId] : null
      return sum + (order ? Number(order.total) : 0)
    }, 0)
    const avgRevenuePerReservation = completedReservations.length > 0
      ? totalRevenue / completedReservations.length
      : 0
    const avgPartySize = totalReservations > 0 ? totalCovers / totalReservations : 0

    // By day of week
    const byDayOfWeek = reservations.reduce((acc, r) => {
      const day = new Date(r.reservationDate).getDay()
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
      const dayName = dayNames[day]
      if (!acc[dayName]) {
        acc[dayName] = { day: dayName, dayNum: day, count: 0, covers: 0, noShows: 0 }
      }
      acc[dayName].count++
      acc[dayName].covers += r.partySize
      if (r.status === 'no_show') acc[dayName].noShows++
      return acc
    }, {} as Record<string, { day: string; dayNum: number; count: number; covers: number; noShows: number }>)

    // By time slot (hour)
    const byTimeSlot = reservations.reduce((acc, r) => {
      const hour = parseInt(r.reservationTime.split(':')[0])
      const slot = `${hour}:00`
      if (!acc[slot]) {
        acc[slot] = { time: slot, hour, count: 0, covers: 0 }
      }
      acc[slot].count++
      acc[slot].covers += r.partySize
      return acc
    }, {} as Record<string, { time: string; hour: number; count: number; covers: number }>)

    // By table
    const byTable = reservations.reduce((acc, r) => {
      const tableName = r.table?.name || 'Unassigned'
      if (!acc[tableName]) {
        acc[tableName] = { table: tableName, count: 0, covers: 0, completed: 0, noShows: 0 }
      }
      acc[tableName].count++
      acc[tableName].covers += r.partySize
      if (r.status === 'completed') acc[tableName].completed++
      if (r.status === 'no_show') acc[tableName].noShows++
      return acc
    }, {} as Record<string, { table: string; count: number; covers: number; completed: number; noShows: number }>)

    // Daily trend
    const dailyTrend = reservations.reduce((acc, r) => {
      const date = new Date(r.reservationDate).toISOString().split('T')[0]
      if (!acc[date]) {
        acc[date] = { date, count: 0, covers: 0, completed: 0, noShows: 0, cancelled: 0 }
      }
      acc[date].count++
      acc[date].covers += r.partySize
      if (r.status === 'completed') acc[date].completed++
      if (r.status === 'no_show') acc[date].noShows++
      if (r.status === 'cancelled') acc[date].cancelled++
      return acc
    }, {} as Record<string, { date: string; count: number; covers: number; completed: number; noShows: number; cancelled: number }>)

    // Party size distribution
    const partySizeDistribution = reservations.reduce((acc, r) => {
      const size = r.partySize
      const bucket = size <= 2 ? '1-2' : size <= 4 ? '3-4' : size <= 6 ? '5-6' : '7+'
      if (!acc[bucket]) {
        acc[bucket] = { size: bucket, count: 0 }
      }
      acc[bucket].count++
      return acc
    }, {} as Record<string, { size: string; count: number }>)

    return NextResponse.json({
      summary: {
        totalReservations,
        totalCovers,
        avgPartySize: Math.round(avgPartySize * 10) / 10,
        completedCount: completedReservations.length,
        noShowCount: noShowReservations.length,
        cancelledCount: cancelledReservations.length,
        completionRate: Math.round(completionRate * 10) / 10,
        noShowRate: Math.round(noShowRate * 10) / 10,
        cancellationRate: Math.round(cancellationRate * 10) / 10,
        totalRevenue,
        avgRevenuePerReservation: Math.round(avgRevenuePerReservation * 100) / 100,
      },
      statusBreakdown: Object.entries(statusCounts).map(([status, count]) => ({
        status,
        count,
        percentage: Math.round((count / totalReservations) * 100),
      })),
      byDayOfWeek: Object.values(byDayOfWeek).sort((a, b) => a.dayNum - b.dayNum),
      byTimeSlot: Object.values(byTimeSlot).sort((a, b) => a.hour - b.hour),
      byTable: Object.values(byTable).sort((a, b) => b.count - a.count),
      dailyTrend: Object.values(dailyTrend).sort((a, b) => a.date.localeCompare(b.date)),
      partySizeDistribution: Object.values(partySizeDistribution).sort((a, b) =>
        ['1-2', '3-4', '5-6', '7+'].indexOf(a.size) - ['1-2', '3-4', '5-6', '7+'].indexOf(b.size)
      ),
      recentReservations: reservations.slice(0, 50).map(r => {
        const order = r.orderId ? orderMap[r.orderId] : null
        return {
          id: r.id,
          guestName: r.guestName,
          partySize: r.partySize,
          date: r.reservationDate,
          time: r.reservationTime,
          status: r.status,
          table: r.table?.name,
          orderTotal: order ? Number(order.total) : null,
        }
      }),
    })
  } catch (error) {
    console.error('Reservation report error:', error)
    return NextResponse.json({ error: 'Failed to generate reservation report' }, { status: 500 })
  }
})

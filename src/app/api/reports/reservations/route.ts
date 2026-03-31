import { NextRequest } from 'next/server'
import { db as prisma } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'
// Prisma imported via prisma instance for $queryRaw tagged template

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return err('Location ID required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
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

    // Build SQL date params
    const sqlStartDate = startDate ? new Date(startDate) : new Date('2000-01-01')
    const sqlEndDate = endDate ? (() => { const e = new Date(endDate); e.setHours(23, 59, 59, 999); return e })() : new Date('2099-12-31')

    // ---- Enhanced report queries (all run in parallel) ----
    const [
      bySourceRows,
      tableUtilizationRows,
      repeatCustomerRows,
      cancellationReasonRows,
      peakHeatmapRows,
      depositRevenueRows,
    ] = await Promise.all([
      // (a) No-show rate by source
      prisma.$queryRaw<Array<{ source: string | null; total: bigint; no_shows: bigint; no_show_rate: number | null }>>`
        SELECT source, COUNT(*) as total,
          SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) as no_shows,
          ROUND(SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END)::decimal / NULLIF(COUNT(*), 0) * 100, 1) as no_show_rate
        FROM "Reservation"
        WHERE "locationId" = ${locationId} AND "reservationDate" BETWEEN ${sqlStartDate} AND ${sqlEndDate} AND "deletedAt" IS NULL
        GROUP BY source ORDER BY total DESC`,

      // (b) Table utilization
      prisma.$queryRaw<Array<{ id: string; name: string; capacity: number; reservation_count: bigint; total_minutes_booked: bigint | null }>>`
        SELECT t.id, t.name, t.capacity, COUNT(r.id) as reservation_count,
          SUM(r.duration) as total_minutes_booked
        FROM "Table" t
        LEFT JOIN "Reservation" r ON r."tableId" = t.id
          AND r."reservationDate" BETWEEN ${sqlStartDate} AND ${sqlEndDate}
          AND r.status NOT IN ('cancelled') AND r."deletedAt" IS NULL
        WHERE t."locationId" = ${locationId} AND t."isReservable" = true AND t."deletedAt" IS NULL
        GROUP BY t.id, t.name, t.capacity
        ORDER BY reservation_count DESC`,

      // (c) Repeat customers (top 10)
      prisma.$queryRaw<Array<{ id: string; firstName: string; lastName: string; phone: string | null; reservation_count: bigint; last_reservation: Date; noShowCount: number }>>`
        SELECT c.id, c."firstName", c."lastName", c.phone, COUNT(r.id) as reservation_count,
          MAX(r."reservationDate") as last_reservation, c."noShowCount"
        FROM "Customer" c
        JOIN "Reservation" r ON r."customerId" = c.id
        WHERE r."locationId" = ${locationId} AND r."reservationDate" BETWEEN ${sqlStartDate} AND ${sqlEndDate} AND r."deletedAt" IS NULL
        GROUP BY c.id, c."firstName", c."lastName", c.phone, c."noShowCount"
        HAVING COUNT(r.id) >= 2
        ORDER BY reservation_count DESC
        LIMIT 10`,

      // (d) Cancellation reasons
      prisma.$queryRaw<Array<{ cancelReason: string; count: bigint }>>`
        SELECT "cancelReason", COUNT(*) as count
        FROM "Reservation"
        WHERE "locationId" = ${locationId} AND status = 'cancelled'
          AND "reservationDate" BETWEEN ${sqlStartDate} AND ${sqlEndDate} AND "deletedAt" IS NULL AND "cancelReason" IS NOT NULL
        GROUP BY "cancelReason" ORDER BY count DESC LIMIT 20`,

      // (e) Peak time heatmap data (day-of-week x hour)
      prisma.$queryRaw<Array<{ day_of_week: number; hour: number; count: bigint }>>`
        SELECT EXTRACT(DOW FROM "reservationDate")::int as day_of_week,
          SUBSTRING("reservationTime" FROM 1 FOR 2)::int as hour,
          COUNT(*) as count
        FROM "Reservation"
        WHERE "locationId" = ${locationId} AND "reservationDate" BETWEEN ${sqlStartDate} AND ${sqlEndDate}
          AND "deletedAt" IS NULL AND status NOT IN ('cancelled')
        GROUP BY day_of_week, hour ORDER BY day_of_week, hour`,

      // (f) Deposit revenue summary
      prisma.$queryRaw<Array<{ total_collected: number | null; total_refunded: number | null; reservations_with_deposits: bigint }>>`
        SELECT
          SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as total_collected,
          SUM(CASE WHEN "refundedAmount" > 0 THEN "refundedAmount" ELSE 0 END) as total_refunded,
          COUNT(DISTINCT "reservationId") as reservations_with_deposits
        FROM "ReservationDeposit"
        WHERE "locationId" = ${locationId} AND "createdAt" BETWEEN ${sqlStartDate} AND ${sqlEndDate} AND "deletedAt" IS NULL`,
    ])

    // Format enhanced data
    const bySource = bySourceRows.map(r => ({
      source: r.source || 'unknown',
      total: Number(r.total),
      noShows: Number(r.no_shows),
      noShowRate: r.no_show_rate !== null ? Number(r.no_show_rate) : 0,
    }))

    const tableUtilization = tableUtilizationRows.map(r => ({
      id: r.id,
      name: r.name,
      capacity: r.capacity,
      reservationCount: Number(r.reservation_count),
      totalMinutesBooked: Number(r.total_minutes_booked ?? 0),
    }))

    const repeatCustomers = repeatCustomerRows.map(r => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      phone: r.phone,
      reservationCount: Number(r.reservation_count),
      lastReservation: r.last_reservation,
      noShowCount: r.noShowCount,
    }))

    const cancellationReasons = cancellationReasonRows.map(r => ({
      reason: r.cancelReason,
      count: Number(r.count),
    }))

    const peakHeatmap = peakHeatmapRows.map(r => ({
      dayOfWeek: Number(r.day_of_week),
      hour: Number(r.hour),
      count: Number(r.count),
    }))

    const depositRow = depositRevenueRows[0]
    const depositRevenue = {
      totalCollected: depositRow ? Number(depositRow.total_collected ?? 0) : 0,
      totalRefunded: depositRow ? Number(depositRow.total_refunded ?? 0) : 0,
      reservationsWithDeposits: depositRow ? Number(depositRow.reservations_with_deposits) : 0,
    }

    return ok({
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
      // Enhanced report sections
      bySource,
      tableUtilization,
      repeatCustomers,
      cancellationReasons,
      peakHeatmap,
      depositRevenue,
    })
  } catch (error) {
    console.error('Reservation report error:', error)
    return err('Failed to generate reservation report', 500)
  }
})

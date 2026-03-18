import { NextRequest, NextResponse } from 'next/server'
import { db as prisma } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { Prisma } from '@/generated/prisma/client'

/**
 * GET /api/dashboard/reservations
 * Returns upcoming reservations (next 2 hours) and today's stats for the dashboard widget.
 * No special permission required — dashboard is visible to all staff.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const now = new Date()
    const twoHoursFromNow = new Date(now.getTime() + 2 * 60 * 60 * 1000)

    // Today's date range (midnight to midnight)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    // Get today's reservations for stats
    const todayReservations = await prisma.reservation.findMany({
      where: {
        locationId,
        reservationDate: { gte: todayStart, lte: todayEnd },
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        depositStatus: true,
      },
    })

    // Calculate today's stats
    const todayStats = {
      total: todayReservations.length,
      confirmed: 0,
      checkedIn: 0,
      seated: 0,
      completed: 0,
      noShows: 0,
      cancelled: 0,
      pendingDeposits: 0,
    }

    for (const r of todayReservations) {
      switch (r.status) {
        case 'confirmed': todayStats.confirmed++; break
        case 'checked_in': todayStats.checkedIn++; break
        case 'seated': todayStats.seated++; break
        case 'completed': todayStats.completed++; break
        case 'no_show': todayStats.noShows++; break
        case 'cancelled': todayStats.cancelled++; break
      }
      if (r.depositStatus === 'pending' || r.depositStatus === 'required') {
        todayStats.pendingDeposits++
      }
    }

    // Format current time as HH:MM for comparison
    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const twoHoursHHMM = `${String(twoHoursFromNow.getHours()).padStart(2, '0')}:${String(twoHoursFromNow.getMinutes()).padStart(2, '0')}`

    // Handle cross-midnight edge case
    const crossesMidnight = twoHoursFromNow.getDate() !== now.getDate()

    // Excluded statuses for upcoming
    const excludedStatuses: ['cancelled', 'completed', 'no_show'] = ['cancelled', 'completed', 'no_show']

    // Build time filter for upcoming reservations
    let upcomingWhere: Prisma.ReservationWhereInput
    if (crossesMidnight) {
      // If 2 hours from now crosses midnight, get rest of today + start of tomorrow
      upcomingWhere = {
        locationId,
        deletedAt: null,
        status: { notIn: excludedStatuses },
        OR: [
          {
            reservationDate: { gte: todayStart, lte: todayEnd },
            reservationTime: { gte: currentHHMM },
          },
          {
            reservationDate: {
              gte: new Date(twoHoursFromNow.getFullYear(), twoHoursFromNow.getMonth(), twoHoursFromNow.getDate()),
              lte: new Date(twoHoursFromNow.getFullYear(), twoHoursFromNow.getMonth(), twoHoursFromNow.getDate(), 23, 59, 59, 999),
            },
            reservationTime: { lte: twoHoursHHMM },
          },
        ],
      }
    } else {
      upcomingWhere = {
        locationId,
        reservationDate: { gte: todayStart, lte: todayEnd },
        reservationTime: { gte: currentHHMM, lte: twoHoursHHMM },
        deletedAt: null,
        status: { notIn: excludedStatuses },
      }
    }

    const upcomingReservations = await prisma.reservation.findMany({
      where: upcomingWhere,
      include: {
        table: { select: { name: true } },
        deposits: {
          where: { deletedAt: null },
          select: { status: true },
          take: 1,
        },
      },
      orderBy: [{ reservationDate: 'asc' }, { reservationTime: 'asc' }],
    })

    const upcoming = upcomingReservations.map(r => ({
      id: r.id,
      guestName: r.guestName,
      partySize: r.partySize,
      time: r.reservationTime,
      status: r.status,
      depositStatus: r.depositStatus || (r.deposits.length > 0 ? r.deposits[0].status : 'not_required'),
      tableName: r.table?.name || null,
      checkedIn: r.checkedInAt !== null,
    }))

    return NextResponse.json({
      data: {
        upcoming,
        todayStats,
      },
    })
  } catch (error) {
    console.error('Dashboard reservations error:', error)
    return NextResponse.json({ error: 'Failed to load reservation dashboard data' }, { status: 500 })
  }
})

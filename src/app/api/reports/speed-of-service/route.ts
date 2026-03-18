import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { withVenue } from '@/lib/with-venue'
import { parseSettings, DEFAULT_SPEED_OF_SERVICE } from '@/lib/settings'

interface TimingMetrics {
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  orderCount: number
}

interface BumpMetrics {
  avgBumpSeconds: number | null
  medianBumpSeconds: number | null
  minBumpSeconds: number | null
  maxBumpSeconds: number | null
  itemCount: number
}

function avgMinutes(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((s, v) => s + v, 0)
  return Math.round((sum / values.length / 60000) * 10) / 10 // ms → minutes, 1 decimal
}

function computeBumpMetrics(secondsArr: number[]): BumpMetrics {
  if (secondsArr.length === 0) {
    return { avgBumpSeconds: null, medianBumpSeconds: null, minBumpSeconds: null, maxBumpSeconds: null, itemCount: 0 }
  }
  const sorted = [...secondsArr].sort((a, b) => a - b)
  const sum = sorted.reduce((s, v) => s + v, 0)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid]

  return {
    avgBumpSeconds: Math.round(sum / sorted.length),
    medianBumpSeconds: median,
    minBumpSeconds: sorted[0],
    maxBumpSeconds: sorted[sorted.length - 1],
    itemCount: sorted.length,
  }
}

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const filterEmployeeId = searchParams.get('employeeId') || null
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    if (!locationId || !startDate || !endDate) {
      return NextResponse.json(
        { error: 'locationId, startDate, and endDate are required' },
        { status: 400 }
      )
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_VIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const start = new Date(startDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    // Fetch orders with timing data
    const orderWhere: Record<string, unknown> = {
      locationId,
      status: { in: [...REVENUE_ORDER_STATUSES] },
      createdAt: { gte: start, lte: end },
    }
    if (filterEmployeeId && filterEmployeeId !== requestingEmployeeId) {
      orderWhere.employeeId = filterEmployeeId
    }

    const orders = await adminDb.order.findMany({
      where: orderWhere,
      select: {
        id: true,
        createdAt: true,
        sentAt: true,
        paidAt: true,
        orderType: true,
        employeeId: true,
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        items: {
          where: { deletedAt: null },
          select: {
            id: true,
            kitchenSentAt: true,
            completedAt: true,
            menuItem: {
              select: {
                id: true,
                prepStationId: true,
                category: {
                  select: {
                    id: true,
                    prepStationId: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    // Calculate overall order-level metrics (existing)
    const orderToSendTimes: number[] = []
    const sendToCompleteTimes: number[] = []
    const seatToPayTimes: number[] = []

    // Group data
    const byDayMap = new Map<string, { orderToSend: number[]; sendToComplete: number[]; seatToPay: number[] }>()
    const byEmployeeMap = new Map<string, {
      id: string
      name: string
      orderToSend: number[]
      sendToComplete: number[]
      seatToPay: number[]
    }>()
    const byOrderTypeMap = new Map<string, { orderToSend: number[]; sendToComplete: number[]; seatToPay: number[] }>()

    // KDS bump speed-of-service: item-level kitchenSentAt → completedAt
    const allBumpSeconds: number[] = []
    const bumpByStationMap = new Map<string, number[]>()
    const bumpByHourMap = new Map<number, number[]>()
    const bumpByDayMap = new Map<string, number[]>()

    for (const order of orders) {
      const created = order.createdAt.getTime()
      const sent = order.sentAt?.getTime()
      const paid = order.paidAt?.getTime()
      const tzSos = process.env.TIMEZONE || process.env.TZ
      const dayKey = tzSos ? order.createdAt.toLocaleDateString('en-CA', { timeZone: tzSos }) : order.createdAt.toISOString().split('T')[0]
      const orderType = order.orderType || 'Unknown'
      const empId = order.employeeId || 'unknown'
      const empName = order.employee
        ? (order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`)
        : 'Unknown'

      // Ensure day/employee/type buckets exist
      if (!byDayMap.has(dayKey)) byDayMap.set(dayKey, { orderToSend: [], sendToComplete: [], seatToPay: [] })
      if (!byEmployeeMap.has(empId)) byEmployeeMap.set(empId, { id: empId, name: empName, orderToSend: [], sendToComplete: [], seatToPay: [] })
      if (!byOrderTypeMap.has(orderType)) byOrderTypeMap.set(orderType, { orderToSend: [], sendToComplete: [], seatToPay: [] })

      const dayBucket = byDayMap.get(dayKey)!
      const empBucket = byEmployeeMap.get(empId)!
      const typeBucket = byOrderTypeMap.get(orderType)!

      // Order → Send time
      if (sent && sent > created) {
        const diff = sent - created
        orderToSendTimes.push(diff)
        dayBucket.orderToSend.push(diff)
        empBucket.orderToSend.push(diff)
        typeBucket.orderToSend.push(diff)
      }

      // Send → Complete time (avg across items that have completedAt)
      if (sent) {
        for (const item of order.items) {
          if (item.completedAt) {
            const diff = item.completedAt.getTime() - sent
            if (diff > 0) {
              sendToCompleteTimes.push(diff)
              dayBucket.sendToComplete.push(diff)
              empBucket.sendToComplete.push(diff)
              typeBucket.sendToComplete.push(diff)
            }
          }
        }
      }

      // Seat → Pay time
      if (paid && paid > created) {
        const diff = paid - created
        seatToPayTimes.push(diff)
        dayBucket.seatToPay.push(diff)
        empBucket.seatToPay.push(diff)
        typeBucket.seatToPay.push(diff)
      }

      // KDS bump speed-of-service: per-item kitchenSentAt → completedAt
      for (const item of order.items) {
        if (item.kitchenSentAt && item.completedAt) {
          const seconds = Math.round((item.completedAt.getTime() - item.kitchenSentAt.getTime()) / 1000)
          if (seconds > 0 && seconds < 86400) { // Sanity: ignore > 24h
            allBumpSeconds.push(seconds)

            // Group by station
            const stationId = item.menuItem?.prepStationId || item.menuItem?.category?.prepStationId || 'unassigned'
            if (!bumpByStationMap.has(stationId)) bumpByStationMap.set(stationId, [])
            bumpByStationMap.get(stationId)!.push(seconds)

            // Group by hour (of kitchenSentAt)
            const hour = item.kitchenSentAt.getHours()
            if (!bumpByHourMap.has(hour)) bumpByHourMap.set(hour, [])
            bumpByHourMap.get(hour)!.push(seconds)

            // Group by day
            const itemDayKey = tzSos ? item.kitchenSentAt.toLocaleDateString('en-CA', { timeZone: tzSos }) : item.kitchenSentAt.toISOString().split('T')[0]
            if (!bumpByDayMap.has(itemDayKey)) bumpByDayMap.set(itemDayKey, [])
            bumpByDayMap.get(itemDayKey)!.push(seconds)
          }
        }
      }
    }

    const overall: TimingMetrics = {
      avgOrderToSend: avgMinutes(orderToSendTimes),
      avgSendToComplete: avgMinutes(sendToCompleteTimes),
      avgSeatToPay: avgMinutes(seatToPayTimes),
      orderCount: orders.length,
    }

    const byDay = Array.from(byDayMap.entries())
      .map(([date, b]) => ({
        date,
        avgOrderToSend: avgMinutes(b.orderToSend),
        avgSendToComplete: avgMinutes(b.sendToComplete),
        avgSeatToPay: avgMinutes(b.seatToPay),
        count: b.orderToSend.length + b.seatToPay.length > 0
          ? Math.max(b.orderToSend.length, b.seatToPay.length)
          : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    const byEmployee = Array.from(byEmployeeMap.values())
      .map((b) => ({
        employeeId: b.id,
        name: b.name,
        avgOrderToSend: avgMinutes(b.orderToSend),
        avgSendToComplete: avgMinutes(b.sendToComplete),
        avgSeatToPay: avgMinutes(b.seatToPay),
        count: Math.max(b.orderToSend.length, b.seatToPay.length),
      }))
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count)

    const byOrderType = Array.from(byOrderTypeMap.entries())
      .map(([type, b]) => ({
        type,
        avgOrderToSend: avgMinutes(b.orderToSend),
        avgSendToComplete: avgMinutes(b.sendToComplete),
        avgSeatToPay: avgMinutes(b.seatToPay),
        count: Math.max(b.orderToSend.length, b.seatToPay.length),
      }))
      .filter(b => b.count > 0)
      .sort((a, b) => b.count - a.count)

    // KDS bump speed-of-service metrics
    const bumpOverall = computeBumpMetrics(allBumpSeconds)

    // Resolve station names for groupBy=station
    const stationIds = Array.from(bumpByStationMap.keys()).filter(id => id !== 'unassigned')
    const stations = stationIds.length > 0
      ? await db.prepStation.findMany({
          where: { id: { in: stationIds } },
          select: { id: true, name: true, displayName: true },
        })
      : []
    const stationNameMap = new Map(stations.map(s => [s.id, s.displayName || s.name]))

    const bumpByStation = Array.from(bumpByStationMap.entries())
      .map(([stationId, seconds]) => ({
        stationId,
        stationName: stationNameMap.get(stationId) || (stationId === 'unassigned' ? 'Unassigned' : stationId),
        ...computeBumpMetrics(seconds),
      }))
      .sort((a, b) => (b.itemCount - a.itemCount))

    const bumpByHour = Array.from(bumpByHourMap.entries())
      .map(([hour, seconds]) => ({
        hour,
        label: `${hour.toString().padStart(2, '0')}:00`,
        ...computeBumpMetrics(seconds),
      }))
      .sort((a, b) => a.hour - b.hour)

    const bumpByDay = Array.from(bumpByDayMap.entries())
      .map(([date, seconds]) => ({
        date,
        ...computeBumpMetrics(seconds),
      }))
      .sort((a, b) => a.date.localeCompare(b.date))

    // Load speed-of-service goal settings
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const sos = settings.speedOfService ?? DEFAULT_SPEED_OF_SERVICE
    const goalSeconds = sos.goalMinutes * 60

    // Compute goal attainment: % of bumped items completed within goalMinutes
    const itemsMetGoal = allBumpSeconds.filter(s => s <= goalSeconds).length
    const goalAttainmentPercent = allBumpSeconds.length > 0
      ? Math.round((itemsMetGoal / allBumpSeconds.length) * 1000) / 10
      : null

    // Per-station goal attainment
    const bumpByStationWithGoal = bumpByStation.map(s => {
      const stationSeconds = bumpByStationMap.get(s.stationId) || []
      const met = stationSeconds.filter(sec => sec <= goalSeconds).length
      return {
        ...s,
        goalAttainmentPercent: stationSeconds.length > 0
          ? Math.round((met / stationSeconds.length) * 1000) / 10
          : null,
      }
    })

    // Per-hour goal attainment
    const bumpByHourWithGoal = bumpByHour.map(h => {
      const hourSeconds = bumpByHourMap.get(h.hour) || []
      const met = hourSeconds.filter(sec => sec <= goalSeconds).length
      return {
        ...h,
        goalAttainmentPercent: hourSeconds.length > 0
          ? Math.round((met / hourSeconds.length) * 1000) / 10
          : null,
      }
    })

    // Per-day goal attainment
    const bumpByDayWithGoal = bumpByDay.map(d => {
      const daySeconds = bumpByDayMap.get(d.date) || []
      const met = daySeconds.filter(sec => sec <= goalSeconds).length
      return {
        ...d,
        goalAttainmentPercent: daySeconds.length > 0
          ? Math.round((met / daySeconds.length) * 1000) / 10
          : null,
      }
    })

    return NextResponse.json({
      data: {
        overall,
        byDay,
        byEmployee,
        byOrderType,
        // KDS bump speed-of-service
        bump: {
          overall: bumpOverall,
          byStation: bumpByStationWithGoal,
          byHour: bumpByHourWithGoal,
          byDay: bumpByDayWithGoal,
          // Goal settings and attainment
          goalMinutes: sos.goalMinutes,
          warningMinutes: sos.warningMinutes,
          goalAttainmentPercent,
        },
      },
    })
  } catch (error) {
    console.error('Speed of service report error:', error)
    return NextResponse.json(
      { error: 'Failed to generate speed of service report' },
      { status: 500 }
    )
  }
})

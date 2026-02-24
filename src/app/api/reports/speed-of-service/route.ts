import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

interface TimingMetrics {
  avgOrderToSend: number | null
  avgSendToComplete: number | null
  avgSeatToPay: number | null
  orderCount: number
}

function avgMinutes(values: number[]): number | null {
  if (values.length === 0) return null
  const sum = values.reduce((s, v) => s + v, 0)
  return Math.round((sum / values.length / 60000) * 10) / 10 // ms → minutes, 1 decimal
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
      status: { in: ['completed', 'closed', 'paid'] },
      createdAt: { gte: start, lte: end },
    }
    if (filterEmployeeId && filterEmployeeId !== requestingEmployeeId) {
      orderWhere.employeeId = filterEmployeeId
    }

    const orders = await db.order.findMany({
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
          select: {
            completedAt: true,
          },
        },
      },
    })

    // Calculate overall metrics
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

    for (const order of orders) {
      const created = order.createdAt.getTime()
      const sent = order.sentAt?.getTime()
      const paid = order.paidAt?.getTime()
      const dayKey = order.createdAt.toISOString().split('T')[0]
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

    return NextResponse.json({
      data: {
        overall,
        byDay,
        byEmployee,
        byOrderType,
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

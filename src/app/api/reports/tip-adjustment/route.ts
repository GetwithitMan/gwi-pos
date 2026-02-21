import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET - Return today's paid card transactions for tip adjustment
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDateStr = searchParams.get('startDate')
    const endDateStr = searchParams.get('endDate')
    const requestingEmployeeId =
      searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS,
      { soft: true }
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Resolve business-day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime

    let startOfDay: Date
    let endOfDay: Date

    if (startDateStr && endDateStr) {
      const startRange = getBusinessDayRange(startDateStr, dayStartTime)
      const endRange = getBusinessDayRange(endDateStr, dayStartTime)
      startOfDay = startRange.start
      endOfDay = endRange.end
    } else if (startDateStr) {
      const range = getBusinessDayRange(startDateStr, dayStartTime)
      startOfDay = range.start
      endOfDay = range.end
    } else {
      const current = getCurrentBusinessDay(dayStartTime)
      startOfDay = current.start
      endOfDay = current.end
    }

    // Fetch completed/paid orders with card payments in the date window
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['completed', 'closed', 'paid'] },
        deletedAt: null,
        OR: [
          { businessDayDate: { gte: startOfDay, lte: endOfDay } },
          {
            businessDayDate: null,
            paidAt: { gte: startOfDay, lte: endOfDay },
          },
          {
            businessDayDate: null,
            paidAt: null,
            createdAt: { gte: startOfDay, lte: endOfDay },
          },
        ],
        payments: {
          some: {
            paymentMethod: { in: ['credit', 'card', 'debit'] },
            status: 'completed',
          },
        },
      },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
          },
        },
        payments: {
          where: {
            paymentMethod: { in: ['credit', 'card', 'debit'] },
            status: 'completed',
          },
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            tipAmount: true,
            totalAmount: true,
            cardBrand: true,
            cardLast4: true,
            datacapRecordNo: true,
            datacapRefNumber: true,
            paymentReaderId: true,
            entryMethod: true,
            createdAt: true,
          },
        },
      },
      orderBy: [
        { paidAt: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    // Build flattened per-payment rows so the UI can edit each card swipe independently
    const transactions = orders.flatMap(order => {
      const employeeName =
        order.employee?.displayName ||
        (order.employee
          ? `${order.employee.firstName} ${order.employee.lastName}`
          : 'Unknown')

      return order.payments.map(payment => ({
        // Payment identification
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,

        // Table / server context
        tableId: order.tableId ?? null,
        tableName: order.table?.name ?? null,
        employeeId: order.employeeId ?? null,
        employeeName,

        // Financial amounts
        subtotal: Number(order.subtotal),
        tipAmount: Number(payment.tipAmount),
        total: Number(payment.totalAmount),

        // Timing
        paidAt: (order.paidAt ?? order.createdAt).toISOString(),

        // Card details
        paymentMethod: payment.paymentMethod,
        cardBrand: payment.cardBrand ?? null,
        cardLast4: payment.cardLast4 ?? null,
        entryMethod: payment.entryMethod ?? null,

        // Datacap fields required by /api/datacap/adjust
        recordNo: payment.datacapRecordNo ?? null,
        readerId: payment.paymentReaderId ?? null,
        purchaseAmount: Number(payment.amount),
      }))
    })

    // Summary
    const totalTransactions = transactions.length
    const totalTips = transactions.reduce((sum, t) => sum + t.tipAmount, 0)
    const totalSubtotal = transactions.reduce((sum, t) => sum + t.subtotal, 0)
    const avgTipPct =
      totalSubtotal > 0 ? (totalTips / totalSubtotal) * 100 : 0

    return NextResponse.json({
      data: {
        transactions,
        summary: {
          totalTransactions,
          totalTips: round(totalTips),
          avgTipPct: round(avgTipPct),
        },
      },
    })
  } catch (error) {
    console.error('[tip-adjustment] Failed to load report:', error)
    return NextResponse.json(
      {
        error: 'Failed to load tip adjustment report',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { REVENUE_ORDER_STATUSES } from '@/lib/constants'
import { getBusinessDayRange, getCurrentBusinessDay } from '@/lib/business-day'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

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
      return err('locationId is required')
    }

    const auth = await requirePermission(
      requestingEmployeeId,
      locationId,
      PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS
    )
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Resolve business-day boundaries
    const locationSettings = parseSettings(await getLocationSettings(locationId))
    const dayStartTime = locationSettings.businessDay.dayStartTime
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct date boundaries
    const timezone = await getLocationTimezone(locationId)

    let startOfDay: Date
    let endOfDay: Date

    if (startDateStr && endDateStr) {
      const startRange = getBusinessDayRange(startDateStr, dayStartTime, timezone)
      const endRange = getBusinessDayRange(endDateStr, dayStartTime, timezone)
      startOfDay = startRange.start
      endOfDay = endRange.end
    } else if (startDateStr) {
      const range = getBusinessDayRange(startDateStr, dayStartTime, timezone)
      startOfDay = range.start
      endOfDay = range.end
    } else {
      const current = getCurrentBusinessDay(dayStartTime, timezone)
      startOfDay = current.start
      endOfDay = current.end
    }

    // Fetch completed/paid orders with card payments in the date window
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: [...REVENUE_ORDER_STATUSES] },
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

    return ok({
        transactions,
        summary: {
          totalTransactions,
          totalTips: round(totalTips),
          avgTipPct: round(avgTipPct),
        },
      })
  } catch (error) {
    console.error('[tip-adjustment] Failed to load report:', error)
    return err('Failed to load tip adjustment report', 500)
  }
})

function round(value: number): number {
  return Math.round(value * 100) / 100
}

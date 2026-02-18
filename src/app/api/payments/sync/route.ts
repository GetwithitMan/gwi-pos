import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * POST /api/payments/sync
 *
 * Syncs an offline-captured payment to the server.
 * These payments were authorized while online, but captured while offline.
 * They need special handling for reconciliation.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      intentId,
      orderId,
      localOrderId,
      amount,
      tipAmount = 0,
      paymentMethod,
      cardToken,
      cardBrand,
      cardLast4,
      gatewayTransactionId,
      authorizationCode,
      isOfflineCapture,
      offlineCapturedAt,
      terminalId,
      employeeId,
    } = body

    // Validate required fields
    if (!orderId && !localOrderId) {
      return NextResponse.json(
        { error: 'Order ID or Local Order ID is required' },
        { status: 400 }
      )
    }

    if (!amount || !employeeId) {
      return NextResponse.json(
        { error: 'Amount and employee ID are required' },
        { status: 400 }
      )
    }

    // Check for duplicate sync (idempotency via intentId)
    if (intentId) {
      const existingPayment = await db.payment.findFirst({
        where: {
          offlineIntentId: intentId,
        },
      })

      if (existingPayment) {
        return NextResponse.json(
          {
            message: 'Payment already synced',
            paymentId: existingPayment.id,
            payment: existingPayment,
          },
          { status: 409 }
        )
      }
    }

    // Resolve the order ID
    let resolvedOrderId = orderId

    // If we only have localOrderId, find the synced order
    if (!resolvedOrderId && localOrderId) {
      const syncedOrder = await db.order.findFirst({
        where: {
          offlineLocalId: localOrderId,
        },
      })

      if (!syncedOrder) {
        return NextResponse.json(
          { error: 'Order not found - please sync the order first' },
          { status: 400 }
        )
      }

      resolvedOrderId = syncedOrder.id
    }

    // Verify the order exists
    const order = await db.order.findUnique({
      where: { id: resolvedOrderId },
      include: {
        location: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 400 })
    }

    // Map payment method to schema format
    const paymentMethodString = paymentMethod === 'card' ? 'credit' : paymentMethod

    // Create the payment in a transaction
    const payment = await db.$transaction(async (tx) => {
      // Create the payment record
      const newPayment = await tx.payment.create({
        data: {
          locationId: order.locationId,
          orderId: resolvedOrderId,
          employeeId,
          paymentMethod: paymentMethodString,
          amount,
          tipAmount,
          totalAmount: amount, // Total includes tip
          status: 'completed',
          // Card details (if card payment)
          cardBrand: cardBrand || null,
          cardLast4: cardLast4 || null,
          authCode: authorizationCode || null,
          transactionId: gatewayTransactionId || null,
          // Offline tracking
          offlineIntentId: intentId || null,
          isOfflineCapture: isOfflineCapture || false,
          offlineCapturedAt: offlineCapturedAt ? new Date(offlineCapturedAt) : null,
          offlineTerminalId: terminalId || null,
          // Flag for reconciliation if offline
          needsReconciliation: isOfflineCapture || false,
        },
      })

      // Update order totals
      const orderPayments = await tx.payment.findMany({
        where: { orderId: resolvedOrderId, status: 'completed' },
      })

      const totalPaid = orderPayments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      )
      const totalTips = orderPayments.reduce(
        (sum, p) => sum + Number(p.tipAmount || 0),
        0
      )

      // Check if fully paid
      const orderTotal = Number(order.total)
      const isFullyPaid = totalPaid >= orderTotal

      await tx.order.update({
        where: { id: resolvedOrderId },
        data: {
          tipTotal: totalTips,
          status: isFullyPaid ? 'paid' : order.status,
          paidAt: isFullyPaid ? new Date() : order.paidAt,
        },
      })

      return newPayment
    })

    // Fetch complete payment with relations
    const completePayment = await db.payment.findUnique({
      where: { id: payment.id },
    })

    return NextResponse.json({
      success: true,
      paymentId: payment.id,
      payment: completePayment,
      isOfflineCapture,
      message: isOfflineCapture
        ? 'Offline payment synced successfully - flagged for reconciliation'
        : 'Payment synced successfully',
    })
  } catch (error) {
    console.error('Failed to sync payment:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync payment' },
      { status: 500 }
    )
  }
})

/**
 * GET /api/payments/sync
 *
 * Get payments that need reconciliation (offline-captured)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }
    const dateStr = searchParams.get('date') // YYYY-MM-DD format
    const needsReconciliation = searchParams.get('needsReconciliation') === 'true'

    // Build date filter
    let dateFilter = {}
    if (dateStr) {
      const date = new Date(dateStr)
      const nextDay = new Date(date)
      nextDay.setDate(nextDay.getDate() + 1)
      dateFilter = {
        createdAt: {
          gte: date,
          lt: nextDay,
        },
      }
    }

    // Query payments
    const payments = await db.payment.findMany({
      where: {
        locationId,
        isOfflineCapture: true,
        ...(needsReconciliation ? { needsReconciliation: true } : {}),
        ...dateFilter,
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            total: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Calculate summary
    const summary = {
      totalCount: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + Number(p.amount), 0),
      needingReconciliation: payments.filter((p) => p.needsReconciliation).length,
      reconciled: payments.filter((p) => !p.needsReconciliation).length,
    }

    return NextResponse.json({
      payments,
      summary,
    })
  } catch (error) {
    console.error('Failed to fetch offline payments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payments' },
      { status: 500 }
    )
  }
})

/**
 * PATCH /api/payments/sync
 *
 * Mark payments as reconciled
 */
export const PATCH = withVenue(async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { paymentIds, reconciledBy } = body

    if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
      return NextResponse.json(
        { error: 'Payment IDs are required' },
        { status: 400 }
      )
    }

    // Update all specified payments
    const result = await db.payment.updateMany({
      where: {
        id: { in: paymentIds },
      },
      data: {
        needsReconciliation: false,
        reconciledAt: new Date(),
        reconciledBy: reconciledBy || null,
      },
    })

    return NextResponse.json({
      success: true,
      count: result.count,
      message: `${result.count} payment(s) marked as reconciled`,
    })
  } catch (error) {
    console.error('Failed to reconcile payments:', error)
    return NextResponse.json(
      { error: 'Failed to reconcile payments' },
      { status: 500 }
    )
  }
})

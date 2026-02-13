import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { paymentId, newTipAmount, reason, managerId } = await request.json()

    // Validate inputs
    if (!paymentId || newTipAmount === undefined || !reason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (newTipAmount < 0) {
      return NextResponse.json(
        { error: 'Tip amount cannot be negative' },
        { status: 400 }
      )
    }

    // Get the order with payment
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          where: { id: paymentId, deletedAt: null },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const payment = order.payments[0]
    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    const oldTipAmount = Number(payment.tipAmount)

    // Calculate new total
    const newTotalAmount = Number(payment.amount) + newTipAmount

    // Update payment
    const updatedPayment = await db.payment.update({
      where: { id: paymentId },
      data: {
        tipAmount: newTipAmount,
        totalAmount: newTotalAmount,
      },
    })

    // Update order tip total
    const allPayments = await db.payment.findMany({
      where: {
        orderId,
        deletedAt: null,
        status: { not: 'voided' }, // Exclude voided payments
      },
    })

    const newOrderTipTotal = allPayments.reduce(
      (sum, p) => sum + Number(p.tipAmount),
      0
    )

    await db.order.update({
      where: { id: orderId },
      data: {
        tipTotal: newOrderTipTotal,
      },
    })

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: managerId,
        action: 'tip_adjusted',
        entityType: 'payment',
        entityId: paymentId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          paymentId,
          oldTipAmount,
          newTipAmount,
          difference: newTipAmount - oldTipAmount,
          reason,
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    return NextResponse.json({
      data: {
        payment: {
          id: updatedPayment.id,
          tipAmount: Number(updatedPayment.tipAmount),
          totalAmount: Number(updatedPayment.totalAmount),
        },
        oldTipAmount,
        newTipAmount,
      },
    })
  } catch (error) {
    console.error('Failed to adjust tip:', error)
    return NextResponse.json(
      { error: 'Failed to adjust tip' },
      { status: 500 }
    )
  }
})

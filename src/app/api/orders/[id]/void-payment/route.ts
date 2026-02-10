import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth-utils'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { paymentId, reason, notes, managerId } = await request.json()

    // Validate inputs
    if (!paymentId || !reason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify manager has permission
    const manager = await db.employee.findUnique({
      where: { id: managerId },
      include: { role: true },
    })
    if (!manager) {
      return NextResponse.json({ error: 'Manager not found' }, { status: 404 })
    }
    const permissions = Array.isArray(manager.role?.permissions) ? manager.role.permissions as string[] : []
    if (!hasPermission(permissions, 'manager.void_payments')) {
      return NextResponse.json({ error: 'Insufficient permissions to void payments' }, { status: 403 })
    }

    // Get the order with payment
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          where: { deletedAt: null },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const payment = order.payments.find((p) => p.id === paymentId)
    if (!payment) {
      return NextResponse.json(
        { error: 'Payment not found' },
        { status: 404 }
      )
    }

    if (payment.status === 'voided') {
      return NextResponse.json(
        { error: 'Payment is already voided' },
        { status: 400 }
      )
    }

    // Update payment to voided
    const voidedPayment = await db.payment.update({
      where: { id: paymentId },
      data: {
        status: 'voided',
        voidedAt: new Date(),
        voidedBy: managerId,
        voidReason: reason,
      },
    })

    // Check if there are other valid payments
    const activePayments = order.payments.filter(
      (p) => p.id !== paymentId && p.status !== 'voided'
    )

    // Update order status if needed
    let newOrderStatus = order.status
    if (activePayments.length === 0) {
      // No more active payments, mark order as voided
      newOrderStatus = 'voided'
    }

    await db.order.update({
      where: { id: orderId },
      data: {
        status: newOrderStatus,
      },
    })

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: managerId,
        action: 'payment_voided',
        entityType: 'payment',
        entityId: paymentId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          paymentId,
          amount: Number(payment.amount),
          tipAmount: Number(payment.tipAmount),
          totalAmount: Number(payment.totalAmount),
          paymentMethod: payment.paymentMethod,
          reason,
          notes: notes || null,
          oldOrderStatus: order.status,
          newOrderStatus,
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    // Reverse tip allocations for this voided payment (fire-and-forget)
    // The chargeback policy (BUSINESS_ABSORBS vs EMPLOYEE_CHARGEBACK) is
    // determined by location settings automatically.
    if (Number(payment.tipAmount) > 0) {
      handleTipChargeback({
        locationId: order.locationId,
        paymentId,
        memo: `Payment voided: ${reason}`,
      }).catch((err) => {
        // If no TipTransaction exists for this payment (e.g., cash payment with no
        // tip allocation, or legacy payment), this is expected. Log but don't fail.
        console.warn('[void-payment] Tip chargeback skipped or failed:', err.message)
      })
    }

    return NextResponse.json({
      data: {
        voidedPayment: {
          id: voidedPayment.id,
          status: voidedPayment.status,
          voidedAt: voidedPayment.voidedAt,
        },
        order: {
          id: order.id,
          status: newOrderStatus,
        },
        refundAmount: Number(payment.totalAmount),
      },
    })
  } catch (error) {
    console.error('Failed to void payment:', error)
    return NextResponse.json(
      { error: 'Failed to void payment' },
      { status: 500 }
    )
  }
}

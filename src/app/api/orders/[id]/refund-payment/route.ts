import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from '@/lib/auth-utils'
import { requireDatacapClient, validateReader } from '@/lib/datacap/helpers'
import { handleTipChargeback } from '@/lib/domain/tips/tip-chargebacks'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { paymentId, refundAmount, refundReason, notes, managerId, readerId, remoteApprovalCode, approvedById } =
      await request.json()

    // Validate required fields
    if (!paymentId || refundAmount === undefined || refundAmount === null || !refundReason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Fetch order
    const order = await db.order.findUnique({
      where: { id, deletedAt: null },
      select: { id: true, locationId: true, orderNumber: true, status: true, deletedAt: true },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Fetch payment
    const payment = await db.payment.findFirst({
      where: { id: paymentId, orderId: id, deletedAt: null },
    })

    if (!payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    }

    // Validate refund amount
    if (refundAmount <= 0) {
      return NextResponse.json(
        { error: 'Refund amount must be greater than 0' },
        { status: 400 }
      )
    }

    if (refundAmount > Number(payment.amount)) {
      return NextResponse.json(
        { error: 'Refund amount exceeds payment amount' },
        { status: 400 }
      )
    }

    if (payment.status === 'voided') {
      return NextResponse.json(
        { error: 'Cannot refund a voided payment' },
        { status: 400 }
      )
    }

    if (payment.status === 'refunded') {
      return NextResponse.json(
        { error: 'Payment has already been fully refunded' },
        { status: 400 }
      )
    }

    // Verify manager exists and has permission
    const manager = await db.employee.findUnique({
      where: { id: managerId, deletedAt: null },
      include: { role: true },
    })

    if (!manager) {
      return NextResponse.json({ error: 'Manager not found' }, { status: 404 })
    }

    const permissions = Array.isArray(manager.role?.permissions)
      ? (manager.role.permissions as string[])
      : []

    if (!hasPermission(permissions, 'manager.void_payments')) {
      return NextResponse.json(
        { error: 'Insufficient permissions to refund payments' },
        { status: 403 }
      )
    }

    // Check cumulative refunds don't exceed original payment amount
    const existingRefunds = await db.refundLog.aggregate({
      where: { paymentId },
      _sum: { refundAmount: true },
    })
    const totalAlreadyRefunded = Number(existingRefunds._sum.refundAmount ?? 0)
    if (totalAlreadyRefunded + refundAmount > Number(payment.amount)) {
      return NextResponse.json(
        { error: `Refund amount exceeds remaining refundable balance. Already refunded: $${totalAlreadyRefunded.toFixed(2)}, remaining: $${(Number(payment.amount) - totalAlreadyRefunded).toFixed(2)}` },
        { status: 400 }
      )
    }

    // W5-11: 2FA enforcement for large refunds
    const locationSettings = parseSettings(await getLocationSettings(order.locationId))
    const securitySettings = locationSettings.security
    if (securitySettings.require2FAForLargeRefunds && refundAmount > securitySettings.refund2FAThreshold) {
      if (!remoteApprovalCode && !approvedById) {
        return NextResponse.json(
          { error: `Manager approval required for refund over $${securitySettings.refund2FAThreshold}`, requiresApproval: true },
          { status: 403 }
        )
      }
    }

    // Process Datacap refund for card payments
    let datacapRefNo: string | null = null

    const isCardPayment =
      payment.paymentMethod === 'credit' || payment.paymentMethod === 'debit'

    if (isCardPayment && readerId && payment.datacapRecordNo) {
      await validateReader(readerId, order.locationId)
      const client = await requireDatacapClient(order.locationId)

      const response = await client.emvReturn(readerId, {
        recordNo: payment.datacapRecordNo,
        invoiceNo: order.orderNumber?.toString() ?? id,
        amount: refundAmount,
        cardPresent: false,
      })

      const approved = response.cmdStatus === 'Approved'

      if (!approved) {
        return NextResponse.json(
          { error: response.textResponse || 'Refund declined' },
          { status: 422 }
        )
      }

      datacapRefNo = response.refNo ?? null
    }

    // Database transaction
    const isPartial = refundAmount < Number(payment.amount)

    const [, refundLog] = await db.$transaction([
      // Update payment status
      db.payment.update({
        where: { id: paymentId },
        data: {
          status: isPartial ? 'completed' : 'refunded',
          refundedAt: new Date(),
          refundedAmount: totalAlreadyRefunded + refundAmount,
        },
      }),
      // Create RefundLog
      db.refundLog.create({
        data: {
          locationId: order.locationId,
          orderId: id,
          paymentId,
          employeeId: managerId,
          refundAmount,
          originalAmount: Number(payment.amount),
          refundReason,
          notes: notes ?? null,
          datacapRecordNo: payment.datacapRecordNo ?? null,
          datacapRefNo: datacapRefNo ?? null,
          approvedById: managerId,
          approvedAt: new Date(),
        },
      }),
      // Create AuditLog
      db.auditLog.create({
        data: {
          locationId: order.locationId,
          action: 'payment_refunded',
          employeeId: managerId,
          details: JSON.stringify({
            paymentId,
            refundAmount,
            originalAmount: Number(payment.amount),
            refundReason,
            isPartial,
          }),
        },
      }),
    ])

    // Bug 8: Proportional tip reduction on partial/full refund (fire-and-forget)
    const paymentTipAmount = Number(payment.tipAmount)
    const paymentOriginalAmount = Number(payment.amount)
    if (paymentTipAmount > 0 && paymentOriginalAmount > 0) {
      const tipReduction = Math.round(paymentTipAmount * (refundAmount / paymentOriginalAmount) * 100) / 100
      if (tipReduction > 0) {
        // Update Payment.tipAmount and Order.tipTotal proportionally
        const newTipAmount = Math.max(0, paymentTipAmount - tipReduction)
        void (async () => {
          try {
            await db.payment.update({
              where: { id: paymentId },
              data: { tipAmount: newTipAmount, totalAmount: Number(payment.amount) - (totalAlreadyRefunded + refundAmount) + newTipAmount },
            })
            // Update Order.tipTotal
            const allPayments = await db.payment.findMany({
              where: { orderId: id, deletedAt: null, status: { not: 'voided' } },
            })
            const newOrderTipTotal = allPayments.reduce((sum, p) => sum + Number(p.tipAmount), 0)
            await db.order.update({
              where: { id },
              data: { tipTotal: newOrderTipTotal },
            })
          } catch (err) {
            console.error('[refund-payment] Failed to adjust tip proportionally:', err)
          }
        })()

        // Trigger tip chargeback for the proportional amount
        void handleTipChargeback({
          locationId: order.locationId,
          paymentId,
          memo: `Partial refund ($${refundAmount.toFixed(2)}): proportional tip reduction of $${tipReduction.toFixed(2)}`,
        }).catch(err => {
          console.warn('[refund-payment] Tip chargeback skipped or failed:', err.message)
        })
      }
    }

    return NextResponse.json({
      data: {
        refundLog: {
          id: refundLog.id,
          refundAmount: Number(refundLog.refundAmount),
          refundReason: refundLog.refundReason,
          createdAt: refundLog.createdAt,
        },
        isPartial,
      },
    })
  } catch (error) {
    console.error('Failed to refund payment:', error)
    return NextResponse.json(
      { error: 'Failed to refund payment' },
      { status: 500 }
    )
  }
})

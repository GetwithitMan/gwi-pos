import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all payments for an order
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        payments: {
          orderBy: { processedAt: 'asc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const orderTotal = Number(order.total)
    const paidAmount = order.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    return NextResponse.json({
      orderId: order.id,
      orderTotal,
      paidAmount,
      remainingBalance: Math.max(0, orderTotal - paidAmount),
      isFullyPaid: paidAmount >= orderTotal - 0.01,
      payments: order.payments.map(p => ({
        id: p.id,
        method: p.paymentMethod,
        amount: Number(p.amount),
        tipAmount: Number(p.tipAmount),
        totalAmount: Number(p.totalAmount),
        amountTendered: p.amountTendered ? Number(p.amountTendered) : null,
        changeGiven: p.changeGiven ? Number(p.changeGiven) : null,
        roundingAdjustment: p.roundingAdjustment ? Number(p.roundingAdjustment) : null,
        cardBrand: p.cardBrand,
        cardLast4: p.cardLast4,
        authCode: p.authCode,
        transactionId: p.transactionId,
        status: p.status,
        refundedAmount: Number(p.refundedAmount),
        processedAt: p.processedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payments' },
      { status: 500 }
    )
  }
}

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { err, notFound, ok } from '@/lib/api-response'

// GET - List all payments for an order
export const GET = withVenue(async function GET(
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
      return notFound('Order not found')
    }

    const orderTotal = Number(order.total)
    const paidAmount = order.payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.totalAmount), 0)

    return ok({
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
        appliedPricingTier: p.appliedPricingTier,
        detectedCardType: p.detectedCardType ?? null,
        walletType: p.walletType ?? null,
        pricingProgramSnapshot: p.pricingProgramSnapshot ?? null,
        processedAt: p.processedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch payments:', error)
    return err('Failed to fetch payments', 500)
  }
})

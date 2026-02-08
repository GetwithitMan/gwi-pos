import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface TipAdjustment {
  orderId: string
  paymentId: string
  tipAmount: number
}

// POST - Batch adjust tips for multiple orders
export async function POST(request: NextRequest) {
  try {
    const { adjustments, employeeId } = await request.json() as {
      adjustments: TipAdjustment[]
      employeeId: string
    }

    if (!adjustments?.length || !employeeId) {
      return NextResponse.json(
        { error: 'Missing required fields: adjustments array and employeeId' },
        { status: 400 }
      )
    }

    if (adjustments.some(a => a.tipAmount < 0)) {
      return NextResponse.json(
        { error: 'Tip amounts cannot be negative' },
        { status: 400 }
      )
    }

    const results: { orderId: string; success: boolean; error?: string }[] = []
    let totalTips = 0

    // Process each adjustment in a transaction
    await db.$transaction(async (tx) => {
      for (const adj of adjustments) {
        const order = await tx.order.findUnique({
          where: { id: adj.orderId },
          include: {
            payments: {
              where: { id: adj.paymentId, deletedAt: null },
            },
          },
        })

        if (!order) {
          results.push({ orderId: adj.orderId, success: false, error: 'Order not found' })
          continue
        }

        const payment = order.payments[0]
        if (!payment) {
          results.push({ orderId: adj.orderId, success: false, error: 'Payment not found' })
          continue
        }

        const oldTipAmount = Number(payment.tipAmount)
        const newTotalAmount = Number(payment.amount) + adj.tipAmount

        // Update payment tip
        await tx.payment.update({
          where: { id: adj.paymentId },
          data: {
            tipAmount: adj.tipAmount,
            totalAmount: newTotalAmount,
          },
        })

        // Recalculate order tip total from all non-voided payments
        const allPayments = await tx.payment.findMany({
          where: {
            orderId: adj.orderId,
            deletedAt: null,
            status: { not: 'voided' },
          },
        })

        const newOrderTipTotal = allPayments.reduce(
          (sum, p) => sum + (p.id === adj.paymentId ? adj.tipAmount : Number(p.tipAmount)),
          0
        )

        await tx.order.update({
          where: { id: adj.orderId },
          data: { tipTotal: newOrderTipTotal },
        })

        // Audit log
        await tx.auditLog.create({
          data: {
            locationId: order.locationId,
            employeeId,
            action: 'tip_adjusted',
            entityType: 'payment',
            entityId: adj.paymentId,
            details: {
              orderId: adj.orderId,
              orderNumber: order.orderNumber,
              paymentId: adj.paymentId,
              oldTipAmount,
              newTipAmount: adj.tipAmount,
              difference: adj.tipAmount - oldTipAmount,
              reason: 'Batch tip adjustment',
              batchSize: adjustments.length,
            },
          },
        })

        totalTips += adj.tipAmount
        results.push({ orderId: adj.orderId, success: true })
      }
    })

    const adjusted = results.filter(r => r.success).length
    const errors = results.filter(r => !r.success)

    return NextResponse.json({
      data: {
        adjusted,
        totalTips,
        total: adjustments.length,
        errors,
      },
    })
  } catch (error) {
    console.error('Failed to batch adjust tips:', error)
    return NextResponse.json(
      { error: 'Failed to batch adjust tips' },
      { status: 500 }
    )
  }
}

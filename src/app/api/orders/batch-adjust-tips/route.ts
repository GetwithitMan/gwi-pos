import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'

interface TipAdjustment {
  orderId: string
  paymentId: string
  tipAmount: number
}

// POST - Batch adjust tips for multiple orders
export const POST = withVenue(async function POST(request: NextRequest) {
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
    const dispatchInfos: { locationId: string; orderId: string; subtotal: number; taxTotal: number; tipTotal: number; discountTotal: number; total: number; commissionTotal: number }[] = []
    const allocationInfos: { locationId: string; orderId: string; employeeId: string; paymentId: string; paymentMethod: string; tipAmount: number }[] = []

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

        // Recalculate Order.total to include new tip total (BUG #410 fix)
        const newOrderTotal = Number(order.subtotal) + Number(order.taxTotal) - Number(order.discountTotal) + newOrderTipTotal

        await tx.order.update({
          where: { id: adj.orderId },
          data: {
            tipTotal: newOrderTipTotal,
            total: newOrderTotal,
            version: { increment: 1 },
          },
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
        dispatchInfos.push({
          locationId: order.locationId,
          orderId: adj.orderId,
          subtotal: Number(order.subtotal),
          taxTotal: Number(order.taxTotal),
          tipTotal: newOrderTipTotal,
          discountTotal: Number(order.discountTotal),
          total: newOrderTotal,
          commissionTotal: Number(order.commissionTotal || 0),
        })

        // Collect info for tip allocation (BUG #412 fix)
        if (adj.tipAmount > 0 && order.employeeId) {
          allocationInfos.push({
            locationId: order.locationId,
            orderId: adj.orderId,
            employeeId: order.employeeId,
            paymentId: adj.paymentId,
            paymentMethod: payment.paymentMethod,
            tipAmount: adj.tipAmount,
          })
        }
      }
    })

    // Fire-and-forget tip allocations (BUG #412 fix — mirror single adjust-tip)
    for (const alloc of allocationInfos) {
      void (async () => {
        const settings = await getLocationSettings(alloc.locationId)
        const locSettings = parseSettings(settings)
        return allocateTipsForPayment({
          locationId: alloc.locationId,
          orderId: alloc.orderId,
          primaryEmployeeId: alloc.employeeId,
          createdPayments: [{ id: alloc.paymentId, paymentMethod: alloc.paymentMethod, tipAmount: alloc.tipAmount }],
          totalTipsDollars: alloc.tipAmount,
          tipBankSettings: locSettings.tipBank,
        })
      })().catch(err => {
        console.error('Background tip allocation failed (batch-adjust-tip):', err)
      })
    }

    // Fire-and-forget socket dispatches for cross-terminal sync
    for (const info of dispatchInfos) {
      void dispatchOrderTotalsUpdate(info.locationId, info.orderId, {
        subtotal: info.subtotal,
        taxTotal: info.taxTotal,
        tipTotal: info.tipTotal,
        discountTotal: info.discountTotal,
        total: info.total,
        commissionTotal: info.commissionTotal,
      }, { async: true }).catch(() => {})
    }

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
})

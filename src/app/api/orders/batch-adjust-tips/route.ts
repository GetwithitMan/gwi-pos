import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

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

    const firstOrder = await db.order.findUnique({
      where: { id: adjustments[0].orderId },
      select: { locationId: true },
    })
    if (!firstOrder) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }
    const authResult = await requirePermission(employeeId, firstOrder.locationId, PERMISSIONS.TIPS_PERFORM_ADJUSTMENTS)
    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 403 })
    }

    const results: { orderId: string; success: boolean; error?: string }[] = []
    let totalTips = 0
    const dispatchInfos: { locationId: string; orderId: string; subtotal: number; taxTotal: number; tipTotal: number; discountTotal: number; total: number; commissionTotal: number }[] = []
    const allocationInfos: { locationId: string; orderId: string; employeeId: string; paymentId: string; paymentMethod: string; tipAmount: number }[] = []

    // Phase 1: Pre-fetch orders and call Datacap for card payments (before DB transaction)
    // Datacap calls are network I/O to hardware — must happen outside the transaction.
    const datacapApproved = new Set<string>() // paymentIds that passed Datacap
    const datacapSkipped = new Set<string>()  // paymentIds that are non-card (no Datacap needed)
    const datacapFailed = new Map<string, string>() // paymentId → error message

    // Pre-fetch all orders+payments for validation and Datacap calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prefetched = new Map<string, { order: any; adj: TipAdjustment }>()

    for (const adj of adjustments) {
      const order = await db.order.findUnique({
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

      // Tip cap: newTipAmount must not exceed 100% of base amount
      const baseAmount = Number(payment.amount) - Number(payment.tipAmount)
      if (baseAmount > 0 && adj.tipAmount > baseAmount) {
        results.push({ orderId: adj.orderId, success: false, error: `Tip $${adj.tipAmount.toFixed(2)} exceeds 100% of base amount $${baseAmount.toFixed(2)}` })
        continue
      }

      prefetched.set(adj.paymentId, { order, adj })

      // Call Datacap for card payments
      if (payment.datacapRecordNo && payment.paymentReaderId) {
        try {
          const datacapClient = await requireDatacapClient(order.locationId)
          const datacapResponse = await datacapClient.adjustGratuity(payment.paymentReaderId, {
            recordNo: payment.datacapRecordNo,
            purchaseAmount: Number(payment.amount),
            gratuityAmount: adj.tipAmount,
          })
          const datacapError = parseError(datacapResponse)
          if (datacapError || datacapResponse.cmdStatus !== 'Approved') {
            datacapFailed.set(adj.paymentId, datacapError?.text ?? 'Datacap declined the tip adjustment')
            results.push({ orderId: adj.orderId, success: false, error: datacapError?.text ?? 'Datacap declined the tip adjustment' })
          } else {
            datacapApproved.add(adj.paymentId)
          }
        } catch (datacapErr) {
          console.error(`Datacap adjustGratuity failed for payment ${adj.paymentId}:`, datacapErr)
          datacapFailed.set(adj.paymentId, 'Could not reach card reader to adjust tip')
          results.push({ orderId: adj.orderId, success: false, error: 'Could not reach card reader to adjust tip' })
        }
      } else {
        // Non-card payment — no Datacap call needed
        datacapSkipped.add(adj.paymentId)
      }
    }

    // Phase 2: DB transaction — only update payments that passed Datacap (or don't need it)
    await db.$transaction(async (tx) => {
      for (const [paymentId, { order, adj }] of prefetched) {
        // Skip if Datacap failed for this payment
        if (datacapFailed.has(paymentId)) continue
        // Only proceed if Datacap approved or was not needed
        if (!datacapApproved.has(paymentId) && !datacapSkipped.has(paymentId)) continue

        const payment = order.payments[0]
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
              datacapAdjusted: datacapApproved.has(paymentId),
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

    // Fire-and-forget event emission per order
    for (const info of dispatchInfos) {
      void emitOrderEvent(info.locationId, info.orderId, 'ORDER_METADATA_UPDATED', {
        tipTotalCents: Math.round(info.tipTotal * 100),
        totalCents: Math.round(info.total * 100),
      }).catch(console.error)
    }

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

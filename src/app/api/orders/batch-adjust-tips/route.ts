import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'
import { allocateTipsForPayment } from '@/lib/domain/tips'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { roundToCents } from '@/lib/pricing'

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

    // Pre-fetch all orders + payments in batch to avoid N+1
    const allOrderIds = [...new Set(adjustments.map(a => a.orderId))]
    const allOrders = await db.order.findMany({
      where: { id: { in: allOrderIds } },
      include: { payments: { where: { deletedAt: null } } },
    })
    const orderMap = new Map(allOrders.map(o => [o.id, o]))

    for (const adj of adjustments) {
      const order = orderMap.get(adj.orderId)

      if (!order) {
        results.push({ orderId: adj.orderId, success: false, error: 'Order not found' })
        continue
      }

      const payment = order.payments.find(p => p.id === adj.paymentId)
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

      // Re-shape order to match the expected structure (single payment in array)
      const orderWithFilteredPayment = { ...order, payments: [payment] }
      prefetched.set(adj.paymentId, { order: orderWithFilteredPayment, adj })

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
    // Filter to eligible adjustments first to avoid repeated checks inside transaction
    const eligibleEntries = [...prefetched.entries()].filter(([paymentId]) =>
      !datacapFailed.has(paymentId) && (datacapApproved.has(paymentId) || datacapSkipped.has(paymentId))
    )

    if (eligibleEntries.length > 0) {
      await db.$transaction(async (tx) => {
        // Batch 1: Update all payment tips in parallel
        await Promise.all(
          eligibleEntries.map(([, { order, adj }]) => {
            const payment = order.payments[0]
            const newTotalAmount = Number(payment.amount) + adj.tipAmount
            return tx.payment.update({
              where: { id: adj.paymentId },
              data: {
                tipAmount: adj.tipAmount,
                totalAmount: newTotalAmount,
                lastMutatedBy: 'local',
              },
            })
          })
        )

        // Batch 2: Fetch all payments for affected orders in one query (avoid N+1 findMany per order)
        const affectedOrderIds = [...new Set(eligibleEntries.map(([, { adj }]) => adj.orderId))]
        const allOrderPayments = await tx.payment.findMany({
          where: {
            orderId: { in: affectedOrderIds },
            deletedAt: null,
            status: { not: 'voided' },
          },
        })

        // Group payments by orderId for tip recalculation
        const paymentsByOrder = new Map<string, typeof allOrderPayments>()
        for (const p of allOrderPayments) {
          const list = paymentsByOrder.get(p.orderId) ?? []
          list.push(p)
          paymentsByOrder.set(p.orderId, list)
        }

        // Build a map of paymentId → new tip amount from this batch
        const tipOverrides = new Map(eligibleEntries.map(([, { adj }]) => [adj.paymentId, adj.tipAmount]))

        // Batch 3: Update all order totals in parallel + create all audit logs in parallel
        const orderUpdates: Promise<unknown>[] = []
        const auditCreates: Promise<unknown>[] = []

        for (const [paymentId, { order, adj }] of eligibleEntries) {
          const payment = order.payments[0]
          const oldTipAmount = Number(payment.tipAmount)

          // Recalculate order tip total from all non-voided payments (using overrides for this batch)
          const orderPayments = paymentsByOrder.get(adj.orderId) ?? []
          const newOrderTipTotal = orderPayments.reduce(
            (sum, p) => sum + (tipOverrides.has(p.id) ? tipOverrides.get(p.id)! : Number(p.tipAmount)),
            0
          )

          // Recalculate Order.total to include new tip total (BUG #410 fix)
          const newOrderTotal = roundToCents(Number(order.subtotal) + Number(order.taxTotal) - Number(order.discountTotal) + newOrderTipTotal)

          orderUpdates.push(
            tx.order.update({
              where: { id: adj.orderId },
              data: {
                tipTotal: newOrderTipTotal,
                total: newOrderTotal,
                version: { increment: 1 },
                lastMutatedBy: 'local',
              },
            })
          )

          auditCreates.push(
            tx.auditLog.create({
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
          )

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

        // Execute order updates and audit log creates in parallel
        await Promise.all([...orderUpdates, ...auditCreates])
      })
    }

    // Queue outage writes if in outage mode (fire-and-forget)
    if (isInOutageMode() && eligibleEntries.length > 0) {
      // Batch-fetch all updated payments and orders in two queries instead of N+1
      const eligiblePaymentIds = eligibleEntries.map(([, { adj }]) => adj.paymentId)
      const eligibleOrderIds = [...new Set(eligibleEntries.map(([, { adj }]) => adj.orderId))]

      const [fullPayments, fullOrders] = await Promise.all([
        db.payment.findMany({ where: { id: { in: eligiblePaymentIds } } }),
        db.order.findMany({ where: { id: { in: eligibleOrderIds } } }),
      ])

      for (const fp of fullPayments) {
        const entry = eligibleEntries.find(([, { adj }]) => adj.paymentId === fp.id)
        if (entry) {
          void queueOutageWrite('Payment', fp.id, 'UPDATE', fp as unknown as Record<string, unknown>, entry[1].order.locationId).catch(console.error)
        }
      }
      for (const fo of fullOrders) {
        void queueOutageWrite('Order', fo.id, 'UPDATE', fo as unknown as Record<string, unknown>, fo.locationId).catch(console.error)
      }
    }

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

      // Dispatch orders:list-changed for cross-terminal awareness (fire-and-forget)
      void dispatchOpenOrdersChanged(info.locationId, {
        trigger: 'payment_updated',
        orderId: info.orderId,
      }, { async: true }).catch(console.error)

      // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
      void dispatchOrderSummaryUpdated(info.locationId, {
        orderId: info.orderId,
        orderNumber: 0,
        status: 'paid',
        tableId: null,
        tableName: null,
        tabName: null,
        guestCount: 0,
        employeeId: null,
        subtotalCents: Math.round(info.subtotal * 100),
        taxTotalCents: Math.round(info.taxTotal * 100),
        discountTotalCents: Math.round(info.discountTotal * 100),
        tipTotalCents: Math.round(info.tipTotal * 100),
        totalCents: Math.round(info.total * 100),
        itemCount: 0,
        updatedAt: new Date().toISOString(),
        locationId: info.locationId,
      }, { async: true }).catch(console.error)
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

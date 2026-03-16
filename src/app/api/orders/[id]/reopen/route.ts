import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PERMISSIONS } from '@/lib/auth-utils'
import { requirePermission } from '@/lib/api-auth'
import { dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { parseError } from '@/lib/datacap/xml-parser'

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { reason, notes, managerId, forceReopen } = await request.json()

    // Validate inputs
    if (!reason || !managerId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get the order first so we have locationId for auth check
    // Get the order with its payments (exclude soft-deleted)
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        payments: {
          where: { status: 'completed', deletedAt: null },
          select: {
            id: true,
            paymentMethod: true,
            amount: true,
            totalAmount: true,
            datacapRecordNo: true,
            paymentReaderId: true,
            cardLast4: true,
          },
        },
        cards: {
          where: { deletedAt: null, status: { in: ['authorized', 'captured'] } },
          select: {
            id: true,
            recordNo: true,
            cardType: true,
            cardLast4: true,
            authAmount: true,
            status: true,
            readerId: true,
            tokenFrequency: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify manager has permission to reopen (void) orders
    const authResult = await requirePermission(managerId, order.locationId, PERMISSIONS.MGR_VOID_ORDERS)
    if (!authResult.authorized) return NextResponse.json({ error: authResult.error }, { status: authResult.status })

    // Check if order can be reopened
    if (order.status !== 'closed' && order.status !== 'paid' && order.status !== 'voided') {
      return NextResponse.json(
        { error: `Cannot reopen order with status: ${order.status}` },
        { status: 400 }
      )
    }

    // Cooldown guard: prevent immediate reopen after cash payment (race condition)
    if (order.paidAt) {
      const secondsSincePaid = (Date.now() - new Date(order.paidAt).getTime()) / 1000
      if (secondsSincePaid < 60) {
        return NextResponse.json(
          { error: 'Order was recently paid. Wait 60 seconds or use manager override.', requiresManagerApproval: true },
          { status: 403 }
        )
      }
    }

    // Guard: warn about ALL completed payments before reopening
    if (order.payments.length > 0 && !forceReopen) {
      const cardPayments = order.payments.filter(
        p => p.paymentMethod === 'credit' || p.paymentMethod === 'debit'
      )
      const cashPayments = order.payments.filter(p => p.paymentMethod === 'cash')
      const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0)

      return NextResponse.json(
        {
          error: `Order has ${order.payments.length} completed payment(s) totaling $${totalPaid.toFixed(2)}. Reopening will void these. Send forceReopen: true to confirm.`,
          requiresPaymentWarning: true,
          requiresCardPaymentWarning: cardPayments.length > 0,
          payments: {
            total: order.payments.length,
            totalAmount: totalPaid,
            card: cardPayments.map(p => ({
              id: p.id,
              method: p.paymentMethod,
              amount: Number(p.amount),
              cardLast4: p.cardLast4,
            })),
            cash: cashPayments.length,
            cashAmount: cashPayments.reduce((sum, p) => sum + Number(p.totalAmount), 0),
          },
        },
        { status: 409 }
      )
    }

    // Separate card payment list for audit log
    const cardPayments = order.payments.filter(
      p => p.paymentMethod === 'credit' || p.paymentMethod === 'debit'
    )

    // W1-P4: Mark all existing completed payments as voided so the pay route's
    // alreadyPaid calculation starts fresh (old payments were for the previous close).
    if (order.payments.length > 0) {
      await db.payment.updateMany({
        where: {
          orderId,
          status: 'completed',
        },
        data: {
          status: 'voided',
        },
      })

      // Reverse card charges at Datacap for each card payment (fire-and-forget).
      // DB is already updated above — Datacap voids are best-effort so the reopen
      // is never blocked by processor unreachability.
      if (cardPayments.length > 0) {
        void (async () => {
          let client: Awaited<ReturnType<typeof requireDatacapClient>> | null = null
          try {
            client = await requireDatacapClient(order.locationId)
          } catch (err) {
            console.error(
              `[reopen] Failed to create Datacap client for location ${order.locationId}. ` +
              `${cardPayments.length} card payment(s) were NOT reversed at the processor. ` +
              `Void manually via Datacap portal.`,
              err
            )
            return
          }

          for (const cp of cardPayments) {
            const recordNo = cp.datacapRecordNo
            const readerId = cp.paymentReaderId

            if (!recordNo) {
              console.warn(
                `[reopen] Skipping Datacap void for payment ${cp.id} — no datacapRecordNo. ` +
                `amount=$${Number(cp.amount).toFixed(2)}, card=****${cp.cardLast4 || '????'}. ` +
                `Void manually via Datacap portal.`
              )
              continue
            }

            if (!readerId) {
              console.warn(
                `[reopen] Skipping Datacap void for payment ${cp.id} — no paymentReaderId. ` +
                `recordNo=${recordNo}, amount=$${Number(cp.amount).toFixed(2)}, card=****${cp.cardLast4 || '????'}. ` +
                `Void manually via Datacap portal.`
              )
              continue
            }

            try {
              const datacapResponse = await client.voidSale(readerId, { recordNo })
              const datacapError = parseError(datacapResponse)

              if (datacapResponse.cmdStatus === 'Approved' && !datacapError) {
                console.log(
                  `[reopen] Datacap void succeeded for payment ${cp.id}. ` +
                  `recordNo=${recordNo}, amount=$${Number(cp.amount).toFixed(2)}, card=****${cp.cardLast4 || '????'}`
                )
              } else {
                console.error(
                  `[reopen] Datacap void FAILED for payment ${cp.id}. ` +
                  `recordNo=${recordNo}, amount=$${Number(cp.amount).toFixed(2)}, card=****${cp.cardLast4 || '????'}. ` +
                  `error=${datacapError?.text || datacapResponse.textResponse || 'Unknown'}. ` +
                  `Void manually via Datacap portal.`
                )
              }
            } catch (voidErr) {
              console.error(
                `[reopen] Datacap void EXCEPTION for payment ${cp.id}. ` +
                `recordNo=${recordNo}, amount=$${Number(cp.amount).toFixed(2)}, card=****${cp.cardLast4 || '????'}. ` +
                `Void manually via Datacap portal.`,
                voidErr
              )
            }
          }
        })().catch(console.error)
      }
    }

    // Restore OrderCards for token reuse after reopen
    // Cards with Recurring tokens can potentially be re-used for new charges
    const orderCards = order.cards || []
    if (orderCards.length > 0) {
      const cardIdsToRestore = orderCards
        .filter(c => c.status === 'captured' && c.tokenFrequency === 'Recurring')
        .map(c => c.id)

      if (cardIdsToRestore.length > 0) {
        await db.orderCard.updateMany({
          where: { id: { in: cardIdsToRestore } },
          data: {
            status: 'authorized',
            capturedAmount: null,
            capturedAt: null,
            tipAmount: null,
          },
        })

        console.log(
          `[reopen] Restored ${cardIdsToRestore.length} Recurring token OrderCard(s) to 'authorized' for potential reuse`
        )
      }
    }

    // W2-R2: Recalculate order totals from active items (payments were voided, totals are stale)
    const activeItems = await db.orderItem.findMany({
      where: {
        orderId,
        deletedAt: null,
        status: { not: 'voided' },
      },
      include: {
        modifiers: true,
      },
    })

    // Use canonical order calculation utility for tax + total (with split tax support)
    const locationSettings = await db.location.findUnique({
      where: { id: order.locationId },
      select: { settings: true },
    })
    const locSettings = (locationSettings?.settings as Record<string, unknown>) || {}
    const calcItems: OrderItemForCalculation[] = activeItems.map(i => ({
      price: Number(i.price),
      quantity: i.quantity,
      status: i.status,
      itemTotal: Number(i.itemTotal),
      isTaxInclusive: (i as any).isTaxInclusive ?? false,
      modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
    }))
    const recalcTotals = calculateOrderTotals(
      calcItems,
      locSettings as { tax?: { defaultRate?: number } },
      Number(order.discountTotal) || 0,
      0,
      undefined,
      'card',
      order.isTaxExempt,
      Number(order.inclusiveTaxRate) || undefined
    )

    // Update order to open status
    // Bug 9: Clear paidAt and closedAt so the pay route's alreadyPaid calculation isn't confused
    const reopenedOrder = await db.order.update({
      where: { id: orderId },
      data: {
        status: 'open',
        paidAt: null,
        closedAt: null,
        subtotal: recalcTotals.subtotal,
        taxTotal: recalcTotals.taxTotal,
        taxFromInclusive: recalcTotals.taxFromInclusive,
        taxFromExclusive: recalcTotals.taxFromExclusive,
        total: recalcTotals.total,
        tipTotal: 0,
        reopenedAt: new Date(),
        reopenedBy: managerId,
        reopenReason: reason,
        version: { increment: 1 },
      },
    })

    // Revert table status to occupied if order had a table
    if (order.tableId) {
      await db.table.update({
        where: { id: order.tableId },
        data: { status: 'occupied' },
      })
      invalidateSnapshotCache(order.locationId)
    }

    // Create audit log
    await db.auditLog.create({
      data: {
        locationId: order.locationId,
        employeeId: managerId,
        action: 'order_reopened',
        entityType: 'order',
        entityId: orderId,
        details: {
          orderId,
          orderNumber: order.orderNumber,
          oldStatus: order.status,
          newStatus: 'open',
          reason,
          notes: notes || null,
          closedAt: order.closedAt,
          total: Number(order.total),
          paymentsVoided: order.payments.length,
          cardPaymentsVoided: cardPayments.length,
          cardsRestored: orderCards.filter(c => c.status === 'captured' && c.tokenFrequency === 'Recurring').length,
          recurringTokensAvailable: orderCards.filter(c => c.tokenFrequency === 'Recurring').length,
        },
        ipAddress: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    })

    // Emit ORDER_REOPENED event (fire-and-forget)
    void emitOrderEvent(order.locationId, orderId, 'ORDER_REOPENED', {
      reason: reason || null,
    })

    // Dispatch socket events for reopened order (fire-and-forget)
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'reopened',
      orderId,
      tableId: order.tableId || undefined,
    }, { async: true }).catch(() => {})

    // Update floor plan if order had a table (fire-and-forget)
    if (order.tableId) {
      void dispatchFloorPlanUpdate(order.locationId, { async: true }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        order: {
          id: reopenedOrder.id,
          orderNumber: reopenedOrder.orderNumber,
          status: reopenedOrder.status,
          reopenedAt: reopenedOrder.reopenedAt,
        },
        paymentsVoided: order.payments.length,
        cardsRestored: orderCards.filter(c => c.status === 'captured' && c.tokenFrequency === 'Recurring').length,
        hasReusableCards: orderCards.some(c => c.tokenFrequency === 'Recurring'),
      },
    })
  } catch (error) {
    console.error('Failed to reopen order:', error)
    return NextResponse.json(
      { error: 'Failed to reopen order' },
      { status: 500 }
    )
  }
})

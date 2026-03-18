/**
 * Even Split — Split Order Domain
 *
 * Divides an order total evenly N ways, creating N child orders.
 * Items stay on the parent; children carry proportional totals.
 */

import { roundToCents } from '@/lib/pricing'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { distributeDiscountsForEvenSplit } from './discount-distribution'
import type { TxClient, SplitSourceOrder, EvenSplitResult } from './types'

/**
 * Create an even N-way split inside an existing transaction.
 * Returns the created child orders. Route owns socket/event dispatch.
 */
export async function createEvenSplit(
  tx: TxClient,
  order: SplitSourceOrder,
  numWays: number,
): Promise<EvenSplitResult> {
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

  const orderTotal = Number(order.total)
  const perSplit = Math.floor((orderTotal / numWays) * 100) / 100

  // Get current max split index for this parent
  const existingSplits = await tx.order.count({
    where: { parentOrderId: order.id },
  })

  // Create split orders in parallel — each is independent (same parent, unique splitIndex)
  const createdSplits = await Promise.all(
    Array.from({ length: numWays }, (_, i) => {
      const splitIndex = existingSplits + i + 1

      // Split subtotal, tax, and discount proportionally from parent
      const splitSubtotal = i === numWays - 1
        ? Math.round((Number(order.subtotal) - Math.floor((Number(order.subtotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
        : Math.floor((Number(order.subtotal) / numWays) * 100) / 100
      const splitTax = i === numWays - 1
        ? Math.round((Number(order.taxTotal) - Math.floor((Number(order.taxTotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
        : Math.floor((Number(order.taxTotal) / numWays) * 100) / 100
      const splitDiscount = i === numWays - 1
        ? Math.round((Number(order.discountTotal) - Math.floor((Number(order.discountTotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
        : Math.floor((Number(order.discountTotal) / numWays) * 100) / 100
      const splitTaxFromInclusive = i === numWays - 1
        ? Math.round((Number(order.taxFromInclusive) - Math.floor((Number(order.taxFromInclusive) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
        : Math.floor((Number(order.taxFromInclusive) / numWays) * 100) / 100
      const splitTaxFromExclusive = i === numWays - 1
        ? Math.round((Number(order.taxFromExclusive) - Math.floor((Number(order.taxFromExclusive) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
        : Math.floor((Number(order.taxFromExclusive) / numWays) * 100) / 100

      // Last split: compute total FROM its own components to avoid penny drift
      const splitTotal = i === numWays - 1
        ? roundToCents(splitSubtotal + splitTax - splitDiscount)
        : perSplit

      return tx.order.create({
        data: {
          orderNumber: order.orderNumber,
          displayNumber: `${order.orderNumber}-${splitIndex}`,
          locationId: order.locationId,
          employeeId: order.employeeId,
          customerId: order.customerId ?? undefined,
          orderType: order.orderType ?? undefined,
          status: 'open',
          tableId: order.tableId ?? undefined,
          tabName: order.tabName ?? undefined,
          guestCount: 1,
          subtotal: splitSubtotal,
          discountTotal: splitDiscount,
          taxTotal: splitTax,
          taxFromInclusive: splitTaxFromInclusive,
          taxFromExclusive: splitTaxFromExclusive,
          tipTotal: 0,
          total: splitTotal,
          parentOrderId: order.id,
          splitIndex,
          notes: `Split ${splitIndex} of ${numWays} from order #${order.orderNumber}`,
        },
      })
    })
  )

  // --- Distribute parent OrderDiscount records to children ---
  const parentDiscounts = await tx.orderDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })

  await distributeDiscountsForEvenSplit(
    tx,
    parentDiscounts,
    createdSplits,
    numWays,
    order.locationId,
    order.id,
    Number(order.discountTotal || 0),
  )

  // Mark parent order as 'split' so children become payable
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'split',
      discountTotal: 0,
      notes: order.notes
        ? `${order.notes}\n[Split ${numWays} ways]`
        : `[Split ${numWays} ways]`,
      version: { increment: 1 },
    },
  })

  // ── Event emission (fire-and-forget, outside transaction) ──
  // Emit ORDER_CREATED for each child split order
  for (const child of createdSplits) {
    void emitOrderEvent(order.locationId, child.id, 'ORDER_CREATED', {
      locationId: order.locationId,
      employeeId: order.employeeId,
      orderType: order.orderType || 'dine_in',
      tableId: order.tableId,
      tabName: order.tabName,
      guestCount: 1,
      orderNumber: child.orderNumber,
      displayNumber: child.displayNumber,
      parentOrderId: order.id,
      splitIndex: child.splitIndex,
      splitType: 'even',
    }).catch(err => console.error('[even-split] Failed to emit ORDER_CREATED for child:', err))
  }

  // Emit ORDER_CLOSED on the parent order with closedStatus='split'
  void emitOrderEvent(order.locationId, order.id, 'ORDER_CLOSED', {
    closedStatus: 'split',
    reason: `Even split ${numWays} ways`,
    splitType: 'even',
    childOrderIds: createdSplits.map(c => c.id),
    numWays,
  }).catch(err => console.error('[even-split] Failed to emit ORDER_CLOSED for parent:', err))

  return { splitOrders: createdSplits }
}

/**
 * Order Totals Sync — Check Aggregate → Order
 *
 * The Check Aggregate dual-writes to Order/OrderItem once a check is committed.
 * Writing the items alone leaves the Order's money columns stale, and those
 * columns are what payments, receipts, and reports read — so every dual-write
 * site must re-derive them.
 *
 * Single entry point so the commit route and every item mutation agree on how
 * totals are computed.
 */

import { recalculateOrderTotals } from '@/lib/domain/order-items'
import type { TxClient } from '@/lib/domain/order-items'

/**
 * Recompute and persist an Order's money fields from its current OrderItems.
 *
 * MUST be called inside the same transaction as the OrderItem write, so the
 * Order row and its items can never be observed out of step.
 *
 * @param tx - the active transaction client
 * @param orderId - the committed check's linked Order
 * @param locationId - used to load tax/rounding settings
 */
export async function recalculateCommittedOrderTotals(
  tx: TxClient,
  orderId: string,
  locationId: string
): Promise<void> {
  const [location, order] = await Promise.all([
    tx.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    }),
    tx.order.findUnique({
      where: { id: orderId },
      select: { tipTotal: true, isTaxExempt: true },
    }),
  ])

  const totals = await recalculateOrderTotals(
    tx,
    orderId,
    location?.settings ?? null,
    Number(order?.tipTotal ?? 0),
    order?.isTaxExempt ?? false
  )

  await tx.order.update({ where: { id: orderId }, data: totals })
}

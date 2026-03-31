/**
 * Even Split — Split Order Domain
 *
 * Divides an order total evenly N ways, creating N child orders.
 * Items stay on the parent; children carry proportional totals.
 */

import { Prisma } from '@/generated/prisma/client'
import { roundToCents } from '@/lib/pricing'
import { createChildLogger } from '@/lib/logger'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { ValidationError } from '@/lib/api-errors'
import { distributeDiscountsForEvenSplit } from './discount-distribution'
import type { TxClient, SplitSourceOrder, EvenSplitResult } from './types'

const log = createChildLogger('split-order')

/**
 * Create an even N-way split inside an existing transaction.
 * Returns the created child orders. Route owns socket/event dispatch.
 */
export async function createEvenSplit(
  tx: TxClient,
  order: SplitSourceOrder,
  numWays: number,
): Promise<EvenSplitResult> {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`)

  // Re-check status inside FOR UPDATE lock to prevent race with concurrent payment/close
  const lockedParent = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } })
  if (!lockedParent || !['open', 'sent', 'in_progress'].includes(lockedParent.status)) {
    throw new ValidationError('Order status changed — cannot split')
  }

  const orderTotal = Number(order.total)
  const perSplit = Math.floor((orderTotal / numWays) * 100) / 100

  // Tax-exempt + donation fields from parent (available on the Prisma object even if not in SplitSourceOrder type)
  const parentAny = order as any
  const isTaxExempt = parentAny.isTaxExempt ?? false
  const taxExemptReason = parentAny.taxExemptReason ?? null
  const taxExemptId = parentAny.taxExemptId ?? null
  const taxExemptApprovedBy = parentAny.taxExemptApprovedBy ?? null
  const parentDonation = Number(parentAny.donationAmount ?? 0)

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

      // Distribute donation: even share with penny correction on last child
      const splitDonation = parentDonation > 0
        ? (i === numWays - 1
          ? roundToCents(parentDonation - Math.floor((parentDonation / numWays) * 100) / 100 * (numWays - 1))
          : Math.floor((parentDonation / numWays) * 100) / 100)
        : 0

      // Last split: compute total FROM its own components to avoid penny drift
      const splitTotal = i === numWays - 1
        ? roundToCents(splitSubtotal + splitTax - splitDiscount + splitDonation)
        : roundToCents(perSplit + splitDonation)

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
          // Split family tracking (Phase 1+2: Unified Split Checks)
          splitClass: 'allocation',
          splitMode: 'even',
          splitFamilyRootId: order.id,
          // Propagate tax-exempt status from parent
          isTaxExempt,
          ...(taxExemptReason ? { taxExemptReason } : {}),
          ...(taxExemptId ? { taxExemptId } : {}),
          ...(taxExemptApprovedBy ? { taxExemptApprovedBy } : {}),
          // Distribute donation across children
          ...(splitDonation > 0 ? { donationAmount: splitDonation } : {}),
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
  // Set splitFamilyTotal on first split (immutable after — only set if not already present)
  const parentAnyForFamily = order as any
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'split',
      discountTotal: 0,
      // Set splitFamilyTotal on first split (immutable snapshot of original total)
      ...(parentAnyForFamily.splitFamilyTotal ? {} : { splitFamilyTotal: order.total }),
      // Zero out parent donation — it's been distributed to children
      ...(parentDonation > 0 ? { donationAmount: 0 } : {}),
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
    }).catch(err => log.error({ err, orderId: child.id }, 'Failed to emit ORDER_CREATED for child'))
  }

  // Emit ORDER_CLOSED on the parent order with closedStatus='split'
  void emitOrderEvent(order.locationId, order.id, 'ORDER_CLOSED', {
    closedStatus: 'split',
    reason: `Even split ${numWays} ways`,
    splitType: 'even',
    childOrderIds: createdSplits.map(c => c.id),
    numWays,
  }).catch(err => log.error({ err, orderId: order.id }, 'Failed to emit ORDER_CLOSED for parent'))

  return { splitOrders: createdSplits }
}

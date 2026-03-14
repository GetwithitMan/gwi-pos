/**
 * Discount Distribution — Split Order Domain
 *
 * Pure allocation policy for distributing discounts across split children,
 * plus persistence helpers that write the allocations to the database.
 */

import { roundToCents } from '@/lib/pricing'
import type { TxClient, SplitOrderDiscount } from './types'

// ─── Pure Allocation Policy ──────────────────────────────────────────────────

export interface DiscountAllocation {
  /** The original parent discount being distributed */
  parentDiscount: SplitOrderDiscount
  /** Amount allocated to each child, keyed by child order ID */
  childAmounts: Map<string, number>
}

/**
 * Calculate how to distribute a single order-level discount across N children
 * based on their subtotals. Pure function — no DB access.
 *
 * For percent-based: recalculates amount from each child's subtotal
 * For fixed amount: splits proportionally by subtotal ratio (even split uses equal division)
 */
export function allocateDiscountEvenly(
  discount: SplitOrderDiscount,
  numWays: number,
  childSubtotals: Map<string, number>,
): DiscountAllocation {
  const discAmount = Number(discount.amount)
  const isPercent = discount.percent != null && Number(discount.percent) > 0
  const childAmounts = new Map<string, number>()
  const childIds = Array.from(childSubtotals.keys())

  for (let i = 0; i < childIds.length; i++) {
    const childId = childIds[i]
    const childSubtotal = childSubtotals.get(childId) || 0
    let childDiscAmount: number

    if (isPercent) {
      childDiscAmount = Math.round(childSubtotal * (Number(discount.percent) / 100) * 100) / 100
    } else {
      const perChild = Math.floor((discAmount / numWays) * 100) / 100
      childDiscAmount = i === numWays - 1
        ? Math.round((discAmount - perChild * (numWays - 1)) * 100) / 100
        : perChild
    }

    childAmounts.set(childId, childDiscAmount)
  }

  return { parentDiscount: discount, childAmounts }
}

/**
 * Calculate how to distribute a single order-level discount across children
 * proportionally by their subtotal share of the total.
 * Used by by_seat, by_table, and by_item splits.
 */
export function allocateDiscountProportionally(
  discount: SplitOrderDiscount,
  childSubtotals: Map<string, number>,
  totalChildSubtotal: number,
): DiscountAllocation {
  const discAmount = Number(discount.amount)
  const isPercent = discount.percent != null && Number(discount.percent) > 0
  const childAmounts = new Map<string, number>()
  const childIds = Array.from(childSubtotals.keys())
  let distributed = 0

  for (let i = 0; i < childIds.length; i++) {
    const childId = childIds[i]
    const childSub = childSubtotals.get(childId) || 0
    let childDiscAmount: number

    if (isPercent) {
      childDiscAmount = Math.round(childSub * (Number(discount.percent) / 100) * 100) / 100
    } else {
      if (i === childIds.length - 1) {
        // Last child gets remainder to avoid penny drift
        childDiscAmount = Math.round((discAmount - distributed) * 100) / 100
      } else {
        childDiscAmount = Math.round(discAmount * (childSub / totalChildSubtotal) * 100) / 100
      }
    }
    distributed += childDiscAmount
    childAmounts.set(childId, childDiscAmount)
  }

  return { parentDiscount: discount, childAmounts }
}

// ─── Persistence Helpers ─────────────────────────────────────────────────────

/**
 * Persist even-split discount distribution: create child discounts,
 * soft-delete parent discounts, update child order totals.
 * Used by the even split handler.
 */
export async function distributeDiscountsForEvenSplit(
  tx: TxClient,
  parentDiscounts: SplitOrderDiscount[],
  createdSplits: Array<{ id: string; subtotal: any; taxTotal: any }>,
  numWays: number,
  locationId: string,
  parentOrderId: string,
  parentDiscountTotal: number,
): Promise<void> {
  if (parentDiscounts.length === 0) return

  // Track cumulative discount per child (handles multiple discount records)
  const childDiscountAccum = new Map<string, number>()
  for (const child of createdSplits) {
    childDiscountAccum.set(child.id, 0)
  }

  // Build child subtotals map for allocation
  const childSubtotals = new Map<string, number>()
  for (const child of createdSplits) {
    childSubtotals.set(child.id, Number(child.subtotal))
  }

  for (const disc of parentDiscounts) {
    const allocation = allocateDiscountEvenly(disc, numWays, childSubtotals)

    for (const child of createdSplits) {
      const childDiscAmount = allocation.childAmounts.get(child.id) || 0

      await tx.orderDiscount.create({
        data: {
          locationId,
          orderId: child.id,
          discountRuleId: disc.discountRuleId,
          couponId: disc.couponId,
          couponCode: disc.couponCode,
          name: disc.name,
          amount: childDiscAmount,
          percent: (disc.percent != null && Number(disc.percent) > 0) ? disc.percent : null,
          appliedBy: disc.appliedBy,
          isAutomatic: disc.isAutomatic,
          reason: disc.reason,
        },
      })

      childDiscountAccum.set(child.id, (childDiscountAccum.get(child.id) || 0) + childDiscAmount)
    }

    // Soft-delete parent's discount record
    await tx.orderDiscount.update({
      where: { id: disc.id },
      data: { deletedAt: new Date() },
    })
  }

  // Update each child's discountTotal and total with accumulated discount
  for (const child of createdSplits) {
    const totalChildDisc = childDiscountAccum.get(child.id) || 0
    if (totalChildDisc > 0) {
      const childSubtotal = Number(child.subtotal)
      const childTax = Number(child.taxTotal)
      const newChildTotal = Math.round((childSubtotal - totalChildDisc + childTax) * 100) / 100
      await tx.order.update({
        where: { id: child.id },
        data: {
          discountTotal: totalChildDisc,
          total: Math.max(0, newChildTotal),
        },
      })
    }
  }

  // Remainder correction: ensure sum of child discounts equals parent discount total
  if (parentDiscountTotal > 0 && createdSplits.length > 0) {
    const childDiscountSum = Array.from(childDiscountAccum.values()).reduce((sum, v) => sum + v, 0)
    const remainder = roundToCents(parentDiscountTotal - childDiscountSum)
    if (Math.abs(remainder) > 0 && Math.abs(remainder) <= 0.05) {
      // Add remainder to last child's discount
      const lastChild = createdSplits[createdSplits.length - 1]
      const lastChildDisc = childDiscountAccum.get(lastChild.id) || 0
      const correctedDisc = roundToCents(lastChildDisc + remainder)
      const lastChildSubtotal = Number(lastChild.subtotal)
      const lastChildTax = Number(lastChild.taxTotal)
      const correctedTotal = Math.round((lastChildSubtotal - correctedDisc + lastChildTax) * 100) / 100
      await tx.order.update({
        where: { id: lastChild.id },
        data: {
          discountTotal: correctedDisc,
          total: Math.max(0, correctedTotal),
        },
      })
    }
  }
}

/**
 * Persist proportional discount distribution for item/seat/table splits.
 * Creates child discount records, soft-deletes or updates parent discount records.
 *
 * @param mode 'move' — soft-delete parent discount (seat/table: all items move out)
 * @param mode 'reduce' — reduce parent discount amount (by_item: some items remain)
 */
export async function distributeDiscountsProportionally(
  tx: TxClient,
  parentDiscounts: SplitOrderDiscount[],
  childSubtotals: Map<string, number>,
  totalChildSubtotal: number,
  locationId: string,
  mode: 'move' | 'reduce',
  parentRemainingSubtotal?: number,
): Promise<Map<string, number>> {
  // Track cumulative discount per child
  const childDiscAccum = new Map<string, number>()
  for (const childId of childSubtotals.keys()) {
    childDiscAccum.set(childId, 0)
  }

  if (parentDiscounts.length === 0 || totalChildSubtotal === 0) return childDiscAccum

  for (const disc of parentDiscounts) {
    const allocation = allocateDiscountProportionally(disc, childSubtotals, totalChildSubtotal)

    for (const [childId, childDiscAmount] of allocation.childAmounts) {
      await tx.orderDiscount.create({
        data: {
          locationId,
          orderId: childId,
          discountRuleId: disc.discountRuleId,
          couponId: disc.couponId,
          couponCode: disc.couponCode,
          name: disc.name,
          amount: childDiscAmount,
          percent: (disc.percent != null && Number(disc.percent) > 0) ? disc.percent : null,
          appliedBy: disc.appliedBy,
          isAutomatic: disc.isAutomatic,
          reason: disc.reason,
        },
      })

      childDiscAccum.set(childId, (childDiscAccum.get(childId) || 0) + childDiscAmount)
    }

    if (mode === 'move') {
      // Soft-delete parent discount
      await tx.orderDiscount.update({
        where: { id: disc.id },
        data: { deletedAt: new Date() },
      })
    } else {
      // Reduce parent discount to remaining amount
      const discAmount = Number(disc.amount)
      const isPercent = disc.percent != null && Number(disc.percent) > 0
      const totalChildDisc = Array.from(allocation.childAmounts.values()).reduce((s, v) => s + v, 0)
      let parentDiscAmount: number

      if (isPercent) {
        parentDiscAmount = Math.round((parentRemainingSubtotal || 0) * (Number(disc.percent) / 100) * 100) / 100
      } else {
        parentDiscAmount = Math.round((discAmount - totalChildDisc) * 100) / 100
      }

      await tx.orderDiscount.update({
        where: { id: disc.id },
        data: { amount: parentDiscAmount },
      })
    }
  }

  return childDiscAccum
}

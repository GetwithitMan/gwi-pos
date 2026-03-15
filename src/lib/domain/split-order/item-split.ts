/**
 * Item Split — Split Order Domain
 *
 * Moves selected items to a new child order, recalculates parent totals,
 * and distributes discounts proportionally.
 */

import { OrderItemStatus } from '@prisma/client'
import { calculateSplitTax } from '@/lib/order-calculations'
import { distributeDiscountsProportionally } from './discount-distribution'
import type { TxClient, SplitSourceOrder, SplitOrderItem, ItemSplitResult } from './types'

/** Split items into inclusive/exclusive subtotals */
function splitSubtotals(items: SplitOrderItem[]): { inclSub: number; exclSub: number } {
  let inclSub = 0, exclSub = 0
  for (const item of items) {
    const t = Number(item.price) * item.quantity
      + item.modifiers.reduce((s, m) => s + Number(m.price), 0) * item.quantity
    if (item.isTaxInclusive) inclSub += t; else exclSub += t
  }
  return { inclSub, exclSub }
}

/**
 * Build Prisma create data for copying items to a new split child order.
 * Returns the items array and computed subtotal.
 */
function buildItemCreateData(
  itemsToMove: SplitOrderItem[],
  locationId: string,
): { newItems: any[]; newSubtotal: number } {
  let newSubtotal = 0
  const newItems = itemsToMove.map(item => {
    const itemTotal = Number(item.price) * item.quantity
    const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
    newSubtotal += itemTotal + modifiersTotal

    return {
      locationId,
      menuItemId: item.menuItemId,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      itemTotal: item.itemTotal,
      specialNotes: item.specialNotes,
      seatNumber: item.seatNumber,
      blockTimeMinutes: item.blockTimeMinutes,
      blockTimeStartedAt: item.blockTimeStartedAt,
      blockTimeExpiresAt: item.blockTimeExpiresAt,
      isTaxInclusive: item.isTaxInclusive ?? false,
      ...(item.pricingRuleApplied ? { pricingRuleApplied: item.pricingRuleApplied as object } : {}),
      modifiers: {
        create: item.modifiers.map(mod => ({
          locationId,
          modifierId: mod.modifierId,
          name: mod.name,
          price: mod.price,
          quantity: mod.quantity,
          preModifier: mod.preModifier,
          spiritTier: mod.spiritTier,
          linkedBottleProductId: mod.linkedBottleProductId,
        })),
      },
    }
  })

  return { newItems, newSubtotal }
}

/**
 * Create a by-item split inside an existing transaction.
 * Moves specified items to a new child order, recalculates parent, distributes discounts.
 */
export async function createItemSplit(
  tx: TxClient,
  order: SplitSourceOrder,
  itemIds: string[],
  taxRate: number,
  inclusiveTaxRate?: number,
): Promise<ItemSplitResult> {
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

  // Validate items belong to this order
  const itemsToMove = order.items.filter(item => itemIds.includes(item.id))

  // Verify items still exist (guard against concurrent split)
  const freshItems = await tx.orderItem.findMany({
    where: { id: { in: itemIds }, orderId: order.id, deletedAt: null },
    select: { id: true },
  })
  const freshItemIds = new Set(freshItems.map(i => i.id))
  const validItemIds = itemIds.filter((iid: string) => freshItemIds.has(iid))
  if (validItemIds.length === 0) {
    throw new Error('All selected items were already moved by a concurrent split')
  }
  const validItemsToMove = itemsToMove.filter(item => freshItemIds.has(item.id))

  // Build item create data
  const { newItems, newSubtotal } = buildItemCreateData(validItemsToMove, order.locationId)
  const newSplit = splitSubtotals(validItemsToMove)
  const newTaxResult = calculateSplitTax(newSplit.inclSub, newSplit.exclSub, taxRate, inclusiveTaxRate)
  const newTax = newTaxResult.totalTax
  const newTotal = Math.round((newSubtotal + newTaxResult.taxFromExclusive) * 100) / 100

  // Get the next split index
  const maxSplit = await tx.order.aggregate({
    where: { parentOrderId: order.parentOrderId || order.id },
    _max: { splitIndex: true },
  })
  const nextSplitIndex = (maxSplit._max.splitIndex || 0) + 1
  const baseOrderNumber = order.parentOrderId
    ? (await tx.order.findUnique({ where: { id: order.parentOrderId }, select: { orderNumber: true } }))?.orderNumber || order.orderNumber
    : order.orderNumber

  // Create new split order with the selected items
  const newOrder = await tx.order.create({
    data: {
      orderNumber: baseOrderNumber,
      displayNumber: `${baseOrderNumber}-${nextSplitIndex}`,
      locationId: order.locationId,
      employeeId: order.employeeId,
      customerId: order.customerId ?? undefined,
      orderType: order.orderType ?? undefined,
      status: 'open',
      tableId: order.tableId ?? undefined,
      tabName: order.tabName ?? undefined,
      guestCount: 1,
      subtotal: newSubtotal,
      discountTotal: 0,
      taxTotal: newTax,
      taxFromInclusive: newTaxResult.taxFromInclusive,
      taxFromExclusive: newTaxResult.taxFromExclusive,
      tipTotal: 0,
      total: newTotal,
      itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
      parentOrderId: order.parentOrderId || order.id,
      splitIndex: nextSplitIndex,
      notes: `Split from order #${order.orderNumber}`,
      items: {
        create: newItems as any,
      },
    },
    include: {
      items: {
        include: {
          modifiers: true,
        },
      },
    },
  }) as any

  // Update MenuItem.currentOrderId for timed_rental items moved to split child
  const movedEntertainmentItems = validItemsToMove.filter(
    (item: any) => item.menuItem?.itemType === 'timed_rental'
  )
  for (const item of movedEntertainmentItems) {
    if (item.menuItemId) {
      await tx.menuItem.update({
        where: { id: item.menuItemId },
        data: {
          currentOrderId: newOrder.id,
          currentOrderItemId: null,
        },
      })
      await tx.floorPlanElement.updateMany({
        where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
        data: { currentOrderId: newOrder.id },
      })
    }
  }

  // Remove items from original order (soft delete)
  await tx.orderItemModifier.updateMany({
    where: {
      orderItem: {
        id: { in: validItemIds },
      },
    },
    data: { deletedAt: new Date() },
  })
  await tx.orderItem.updateMany({
    where: {
      id: { in: validItemIds },
    },
    data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
  })

  // --- Move item-level discounts to the new child order ---
  const oldToNewItemMap = new Map<string, string>()
  for (let i = 0; i < validItemsToMove.length; i++) {
    const oldItem = validItemsToMove[i]
    const newItem = newOrder.items[i]
    if (newItem) oldToNewItemMap.set(oldItem.id, newItem.id)
  }

  let childItemDiscountTotal = 0
  for (const movedItem of validItemsToMove) {
    const discounts = (movedItem as any).itemDiscounts || []
    for (const disc of discounts) {
      if (disc.deletedAt) continue
      const newItemId = oldToNewItemMap.get(movedItem.id)
      if (!newItemId) continue

      await tx.orderItemDiscount.create({
        data: {
          locationId: order.locationId,
          orderId: newOrder.id,
          orderItemId: newItemId,
          discountRuleId: disc.discountRuleId,
          amount: disc.amount,
          percent: disc.percent,
          appliedById: disc.appliedById,
          reason: disc.reason,
        },
      })
      childItemDiscountTotal += Number(disc.amount)

      await tx.orderItemDiscount.update({
        where: { id: disc.id },
        data: { deletedAt: new Date() },
      })
    }
  }

  // Also proportionally distribute order-level discounts for by_item split
  const parentDiscounts = await tx.orderDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })

  const remainingItems = order.items.filter(item => !validItemIds.includes(item.id))
  let remainingSubtotal = 0
  remainingItems.forEach(item => {
    const itemTotal = Number(item.price) * item.quantity
    const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
    remainingSubtotal += itemTotal + modifiersTotal
  })
  const parentSubtotal = Number(order.subtotal)

  let childOrderDiscountTotal = 0
  if (parentDiscounts.length > 0 && parentSubtotal > 0) {
    const childSubtotals = new Map<string, number>([[newOrder.id, newSubtotal]])
    const childDiscAccum = await distributeDiscountsProportionally(
      tx,
      parentDiscounts,
      childSubtotals,
      parentSubtotal,
      order.locationId,
      'reduce',
      remainingSubtotal,
    )
    childOrderDiscountTotal = childDiscAccum.get(newOrder.id) || 0
  }

  // Update child order with discount totals
  const totalChildDiscount = childItemDiscountTotal + childOrderDiscountTotal
  if (totalChildDiscount > 0) {
    const childTax = Number(newOrder.taxTotal)
    const childTotal = Math.round((newSubtotal - totalChildDiscount + childTax) * 100) / 100
    await tx.order.update({
      where: { id: newOrder.id },
      data: {
        discountTotal: totalChildDiscount,
        total: Math.max(0, childTotal),
      },
    })
  }

  // Recalculate remaining parent discount totals
  const remainingItemDiscounts = await tx.orderItemDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })
  const remainingItemDiscountTotal = remainingItemDiscounts.reduce(
    (sum, d) => sum + Number(d.amount), 0
  )
  const remainingOrderDiscounts = await tx.orderDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })
  const remainingOrderDiscountTotal = remainingOrderDiscounts.reduce(
    (sum, d) => sum + Number(d.amount), 0
  )
  const totalParentDiscount = remainingItemDiscountTotal + remainingOrderDiscountTotal

  const remSplit = splitSubtotals(remainingItems)
  const remTaxResult = calculateSplitTax(remSplit.inclSub, remSplit.exclSub, taxRate, inclusiveTaxRate)
  const remainingTax = remTaxResult.totalTax
  const remainingTotal = Math.round((remainingSubtotal + remTaxResult.taxFromExclusive - totalParentDiscount) * 100) / 100

  // Update original order totals and mark as 'split'
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'split',
      subtotal: remainingSubtotal,
      discountTotal: totalParentDiscount,
      taxTotal: remainingTax,
      taxFromInclusive: remTaxResult.taxFromInclusive,
      taxFromExclusive: remTaxResult.taxFromExclusive,
      total: Math.max(0, remainingTotal),
      itemCount: remainingItems.reduce((sum, i) => sum + i.quantity, 0),
      version: { increment: 1 },
    },
  })

  return {
    newOrder,
    remainingSubtotal,
    remainingTax,
    remainingTotal,
    remainingItems,
    baseOrderNumber,
    nextSplitIndex,
  }
}

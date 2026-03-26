/**
 * Seat Split — Split Order Domain
 *
 * Splits an order by seat number — one child order per seat.
 * Items without seat assignments stay on the parent.
 */

import { OrderItemStatus } from '@/generated/prisma/client'
import { calculateSplitTax } from '@/lib/order-calculations'
import { createChildLogger } from '@/lib/logger'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { distributeDiscountsProportionally } from './discount-distribution'
import type { TxClient, SplitSourceOrder, SplitOrderItem, SeatSplitResult } from './types'

/** Track per-child item discount totals accumulated during seat split */
interface SeatChildDiscountAccum {
  childId: string
  itemDiscountTotal: number
}

const log = createChildLogger('split-order')

/**
 * Create a by-seat split inside an existing transaction.
 * Creates one child order per seat, soft-deletes moved items from parent.
 */
export async function createSeatSplit(
  tx: TxClient,
  order: SplitSourceOrder,
  taxRate: number,
  inclusiveTaxRate?: number,
): Promise<SeatSplitResult> {
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

  // Tax-exempt + donation fields from parent (available on the Prisma object even if not in SplitSourceOrder type)
  const parentAny = order as any
  const isTaxExempt = parentAny.isTaxExempt ?? false
  const taxExemptReason = parentAny.taxExemptReason ?? null
  const taxExemptId = parentAny.taxExemptId ?? null
  const taxExemptApprovedBy = parentAny.taxExemptApprovedBy ?? null
  const parentDonation = Number(parentAny.donationAmount ?? 0)

  // Group items by seat number
  const itemsBySeat = new Map<number | null, SplitOrderItem[]>()
  for (const item of order.items) {
    const seat = item.seatNumber
    if (!itemsBySeat.has(seat)) {
      itemsBySeat.set(seat, [])
    }
    itemsBySeat.get(seat)!.push(item)
  }

  const seatsWithItems = Array.from(itemsBySeat.keys()).filter(s => s !== null) as number[]
  const sortedSeats = seatsWithItems.sort((a, b) => a - b)
  const baseOrderNumber = order.orderNumber

  // Get current max split index
  const existingSplits = await tx.order.count({
    where: { parentOrderId: order.id },
  })

  // Create a split order for each seat
  const splitOrders: Array<{
    id: string
    orderNumber: number
    splitIndex: number | null
    displayNumber: string
    seatNumber: number | null
    total: number
    itemCount: number
    paidAmount: number
    isPaid: boolean
  }> = []
  let splitIndex = existingSplits
  const childItemDiscountAccum: SeatChildDiscountAccum[] = []

  for (const seatNumber of sortedSeats) {
    const seatItems = itemsBySeat.get(seatNumber) || []
    if (seatItems.length === 0) continue

    splitIndex++

    // Calculate totals for this seat's items
    let seatSubtotal = 0
    const newItems = seatItems.map(item => {
      const itemTotal = Number(item.price) * item.quantity
      const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price) * Number(m.quantity ?? 1), 0) * item.quantity
      seatSubtotal += itemTotal + modifiersTotal

      return {
        locationId: order.locationId,
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        itemTotal: item.itemTotal,
        specialNotes: item.specialNotes,
        seatNumber: item.seatNumber,
        courseNumber: item.courseNumber,
        blockTimeMinutes: item.blockTimeMinutes,
        blockTimeStartedAt: item.blockTimeStartedAt,
        blockTimeExpiresAt: item.blockTimeExpiresAt,
        isTaxInclusive: item.isTaxInclusive ?? false,
        ...(item.pricingRuleApplied ? { pricingRuleApplied: item.pricingRuleApplied as object } : {}),
        modifiers: {
          create: item.modifiers.map(mod => ({
            locationId: order.locationId,
            modifierId: mod.modifierId,
            name: mod.name,
            price: mod.price,
            quantity: mod.quantity,
            preModifier: mod.preModifier,
            depth: mod.depth,
            commissionAmount: mod.commissionAmount,
            linkedMenuItemId: mod.linkedMenuItemId,
            linkedMenuItemName: mod.linkedMenuItemName,
            linkedMenuItemPrice: mod.linkedMenuItemPrice,
            spiritTier: mod.spiritTier,
            linkedBottleProductId: mod.linkedBottleProductId,
            isCustomEntry: mod.isCustomEntry,
            isNoneSelection: mod.isNoneSelection,
            noneShowOnReceipt: mod.noneShowOnReceipt,
            customEntryName: mod.customEntryName,
            customEntryPrice: mod.customEntryPrice,
            swapTargetName: mod.swapTargetName,
            swapTargetItemId: mod.swapTargetItemId,
            swapPricingMode: mod.swapPricingMode,
            swapEffectivePrice: mod.swapEffectivePrice,
          })),
        },
        // Clone pizzaData if it exists
        ...(item.pizzaData ? {
          pizzaData: {
            create: {
              locationId: order.locationId,
              sizeId: item.pizzaData.sizeId,
              crustId: item.pizzaData.crustId,
              sauceId: item.pizzaData.sauceId,
              cheeseId: item.pizzaData.cheeseId,
              sauceAmount: item.pizzaData.sauceAmount,
              cheeseAmount: item.pizzaData.cheeseAmount,
              sauceSections: item.pizzaData.sauceSections as any,
              cheeseSections: item.pizzaData.cheeseSections as any,
              toppingsData: item.pizzaData.toppingsData as any,
              cookingInstructions: item.pizzaData.cookingInstructions,
              cutStyle: item.pizzaData.cutStyle,
              sizePrice: item.pizzaData.sizePrice,
              crustPrice: item.pizzaData.crustPrice,
              saucePrice: item.pizzaData.saucePrice,
              cheesePrice: item.pizzaData.cheesePrice,
              toppingsPrice: item.pizzaData.toppingsPrice,
              totalPrice: item.pizzaData.totalPrice,
              freeToppingsUsed: item.pizzaData.freeToppingsUsed,
            },
          },
        } : {}),
      }
    })

    // Split-aware tax for this seat's items
    let seatInclSub = 0, seatExclSub = 0
    for (const item of seatItems) {
      const t = Number(item.price) * item.quantity
        + item.modifiers.reduce((s, m) => s + Number(m.price) * Number(m.quantity ?? 1), 0) * item.quantity
      if (item.isTaxInclusive) seatInclSub += t; else seatExclSub += t
    }
    const seatTaxResult = calculateSplitTax(seatInclSub, seatExclSub, taxRate, inclusiveTaxRate)
    const seatTax = seatTaxResult.totalTax
    // Assign full donation to the first seat child only
    const isFirstSeat = splitOrders.length === 0
    const seatDonation = isFirstSeat && parentDonation > 0 ? parentDonation : 0
    const seatTotal = Math.round((seatSubtotal + seatTaxResult.taxFromExclusive + seatDonation) * 100) / 100

    // Create split order for this seat
    const splitOrder = await tx.order.create({
      data: {
        orderNumber: baseOrderNumber,
        displayNumber: `${baseOrderNumber}-${splitIndex}`,
        locationId: order.locationId,
        employeeId: order.employeeId,
        customerId: order.customerId ?? undefined,
        orderType: order.orderType ?? undefined,
        status: 'open',
        tableId: order.tableId ?? undefined,
        tabName: order.tabName ?? undefined,
        guestCount: 1,
        subtotal: seatSubtotal,
        discountTotal: 0,
        taxTotal: seatTax,
        taxFromInclusive: seatTaxResult.taxFromInclusive,
        taxFromExclusive: seatTaxResult.taxFromExclusive,
        tipTotal: 0,
        total: seatTotal,
        itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
        parentOrderId: order.id,
        splitIndex,
        // Propagate tax-exempt status from parent
        isTaxExempt,
        ...(taxExemptReason ? { taxExemptReason } : {}),
        ...(taxExemptId ? { taxExemptId } : {}),
        ...(taxExemptApprovedBy ? { taxExemptApprovedBy } : {}),
        // Assign donation to first child
        ...(seatDonation > 0 ? { donationAmount: seatDonation } : {}),
        notes: `Seat ${seatNumber} from order #${baseOrderNumber}`,
        items: {
          create: newItems as any,
        },
      },
      include: {
        items: {
          include: { modifiers: true },
        },
      },
    }) as any

    splitOrders.push({
      id: splitOrder.id,
      orderNumber: splitOrder.orderNumber,
      splitIndex: splitOrder.splitIndex,
      displayNumber: `${baseOrderNumber}-${splitIndex}`,
      seatNumber,
      total: Number(splitOrder.total),
      itemCount: (splitOrder.items as any[]).length,
      paidAmount: 0,
      isPaid: false,
    })

    // Update MenuItem.currentOrderId for timed_rental items moved to split child
    const movedEntertainmentItems = seatItems.filter(
      (item: any) => item.menuItem?.itemType === 'timed_rental'
    )
    for (const item of movedEntertainmentItems) {
      if (item.menuItemId) {
        await tx.menuItem.update({
          where: { id: item.menuItemId },
          data: {
            currentOrderId: splitOrder.id,
            currentOrderItemId: null,
          },
        })
        await tx.floorPlanElement.updateMany({
          where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
          data: { currentOrderId: splitOrder.id },
        })
      }
    }

    // --- Move item-level discounts to this seat's child order ---
    const oldToNewItemMap = new Map<string, string>()
    for (let i = 0; i < seatItems.length; i++) {
      const oldItem = seatItems[i]
      const newItem = (splitOrder.items as any[])[i]
      if (newItem) oldToNewItemMap.set(oldItem.id, newItem.id)
    }

    let seatItemDiscountTotal = 0
    for (const movedItem of seatItems) {
      const discounts = (movedItem as any).itemDiscounts || []
      for (const disc of discounts) {
        if (disc.deletedAt) continue
        const newItemId = oldToNewItemMap.get(movedItem.id)
        if (!newItemId) continue

        await tx.orderItemDiscount.create({
          data: {
            locationId: order.locationId,
            orderId: splitOrder.id,
            orderItemId: newItemId,
            discountRuleId: disc.discountRuleId,
            amount: disc.amount,
            percent: disc.percent,
            appliedById: disc.appliedById,
            reason: disc.reason,
          },
        })
        seatItemDiscountTotal += Number(disc.amount)

        await tx.orderItemDiscount.update({
          where: { id: disc.id },
          data: { deletedAt: new Date() },
        })
      }
    }
    childItemDiscountAccum.push({ childId: splitOrder.id, itemDiscountTotal: seatItemDiscountTotal })
  }

  // Delete items from original order (they've been copied to split orders)
  const itemIdsToRemove = seatsWithItems.flatMap(seat =>
    itemsBySeat.get(seat)?.map(item => item.id) || []
  )

  await tx.orderItemModifier.updateMany({
    where: {
      orderItem: { id: { in: itemIdsToRemove } },
    },
    data: { deletedAt: new Date() },
  })
  await tx.orderItem.updateMany({
    where: { id: { in: itemIdsToRemove } },
    data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
  })

  // --- Distribute parent OrderDiscount records proportionally to seat children ---
  const parentDiscounts = await tx.orderDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })

  // Build a lookup for item-level discount totals per child
  const childItemDiscMap = new Map<string, number>()
  for (const accum of childItemDiscountAccum) {
    childItemDiscMap.set(accum.childId, accum.itemDiscountTotal)
  }
  const hasAnyItemDiscounts = childItemDiscountAccum.some(a => a.itemDiscountTotal > 0)

  // Calculate subtotals for each child
  const childSubtotals = new Map<string, number>()
  let totalChildSubtotal = 0
  for (const child of splitOrders) {
    const seatItems = itemsBySeat.get(child.seatNumber) || []
    let sub = 0
    seatItems.forEach(item => {
      sub += Number(item.price) * item.quantity
      sub += item.modifiers.reduce((ms, m) => ms + Number(m.price) * Number(m.quantity ?? 1), 0) * item.quantity
    })
    childSubtotals.set(child.id, sub)
    totalChildSubtotal += sub
  }

  let childOrderDiscAccum = new Map<string, number>()
  if (parentDiscounts.length > 0 && totalChildSubtotal > 0) {
    childOrderDiscAccum = await distributeDiscountsProportionally(
      tx,
      parentDiscounts,
      childSubtotals,
      totalChildSubtotal,
      order.locationId,
      'move',
    )
  }

  // Update each child's discountTotal and total with combined item + order discounts
  if (parentDiscounts.length > 0 || hasAnyItemDiscounts) {
    for (const child of splitOrders) {
      const orderDisc = childOrderDiscAccum.get(child.id) || 0
      const itemDisc = childItemDiscMap.get(child.id) || 0
      const totalChildDisc = orderDisc + itemDisc
      if (totalChildDisc > 0) {
        const childSub = childSubtotals.get(child.id) || 0
        // For discounted children, we need the original seat items to classify
        const childSeatItems = itemsBySeat.get(child.seatNumber) || []
        let cInclSub = 0, cExclSub = 0
        for (const ci of childSeatItems) {
          const t = Number(ci.price) * ci.quantity
            + ci.modifiers.reduce((s, m) => s + Number(m.price) * Number(m.quantity ?? 1), 0) * ci.quantity
          if (ci.isTaxInclusive) cInclSub += t; else cExclSub += t
        }
        // Allocate discount proportionally between inclusive and exclusive
        const discOnIncl = childSub > 0 ? Math.round(totalChildDisc * (cInclSub / childSub) * 100) / 100 : 0
        const discOnExcl = Math.round((totalChildDisc - discOnIncl) * 100) / 100
        const childTaxResult = calculateSplitTax(
          Math.max(0, cInclSub - discOnIncl), Math.max(0, cExclSub - discOnExcl), taxRate, inclusiveTaxRate
        )
        const newChildTotal = Math.round((childSub + childTaxResult.taxFromExclusive - totalChildDisc) * 100) / 100
        await tx.order.update({
          where: { id: child.id },
          data: {
            discountTotal: totalChildDisc,
            taxTotal: childTaxResult.totalTax,
            taxFromInclusive: childTaxResult.taxFromInclusive,
            taxFromExclusive: childTaxResult.taxFromExclusive,
            total: Math.max(0, newChildTotal),
          },
        })
        child.total = Math.max(0, newChildTotal)
      }
    }
  }

  // Recalculate original order totals (for items without seat assignment)
  const remainingItems = itemsBySeat.get(null) || []
  let remainingSubtotal = 0
  let remInclSub = 0, remExclSub = 0
  remainingItems.forEach(item => {
    const itemTotal = Number(item.price) * item.quantity
    const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price) * Number(m.quantity ?? 1), 0) * item.quantity
    const t = itemTotal + modifiersTotal
    remainingSubtotal += t
    if (item.isTaxInclusive) remInclSub += t; else remExclSub += t
  })

  // Recalculate remaining parent discount totals (item-level discounts still on parent)
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

  const remTaxResult = calculateSplitTax(remInclSub, remExclSub, taxRate, inclusiveTaxRate)
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
      // Zero out parent donation — assigned to first child
      ...(parentDonation > 0 ? { donationAmount: 0 } : {}),
      notes: order.notes
        ? `${order.notes}\n[Split by seat: ${sortedSeats.length} seats]`
        : `[Split by seat: ${sortedSeats.length} seats]`,
      version: { increment: 1 },
    },
  })

  // ── Event emission (fire-and-forget, outside transaction) ──
  // Emit ITEM_REMOVED for each item moved from the source order
  if (itemIdsToRemove.length > 0) {
    void emitOrderEvents(order.locationId, order.id, itemIdsToRemove.map(itemId => ({
      type: 'ITEM_REMOVED' as const,
      payload: {
        lineItemId: itemId,
        reason: 'Moved via seat split',
      },
    }))).catch(err => log.error({ err, orderId: order.id }, 'Failed to emit ITEM_REMOVED events'))
  }

  // Emit ORDER_CREATED for each child split order (one per seat)
  for (const child of splitOrders) {
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
      splitType: 'by_seat',
      seatNumber: child.seatNumber,
    }).catch(err => log.error({ err, orderId: child.id }, 'Failed to emit ORDER_CREATED for child'))
  }

  // Emit ORDER_CLOSED on the parent order with closedStatus='split'
  void emitOrderEvent(order.locationId, order.id, 'ORDER_CLOSED', {
    closedStatus: 'split',
    reason: `Seat split — ${sortedSeats.length} seat(s)`,
    splitType: 'by_seat',
    childOrderIds: splitOrders.map(c => c.id),
    seatNumbers: sortedSeats,
  }).catch(err => log.error({ err, orderId: order.id }, 'Failed to emit ORDER_CLOSED for parent'))

  return {
    splitOrders,
    itemIdsToRemove,
    remainingItems,
    remainingTotal,
  }
}

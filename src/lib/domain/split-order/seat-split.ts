/**
 * Seat Split — Split Order Domain
 *
 * Splits an order by seat number — one child order per seat.
 * Items without seat assignments stay on the parent.
 */

import { OrderItemStatus } from '@prisma/client'
import { calculateSplitTax } from '@/lib/order-calculations'
import { distributeDiscountsProportionally } from './discount-distribution'
import type { TxClient, SplitSourceOrder, SplitOrderItem, SeatSplitResult } from './types'

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

  for (const seatNumber of sortedSeats) {
    const seatItems = itemsBySeat.get(seatNumber) || []
    if (seatItems.length === 0) continue

    splitIndex++

    // Calculate totals for this seat's items
    let seatSubtotal = 0
    const newItems = seatItems.map(item => {
      const itemTotal = Number(item.price) * item.quantity
      const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
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
        modifiers: {
          create: item.modifiers.map(mod => ({
            locationId: order.locationId,
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

    // Split-aware tax for this seat's items
    let seatInclSub = 0, seatExclSub = 0
    for (const item of seatItems) {
      const t = Number(item.price) * item.quantity
        + item.modifiers.reduce((s, m) => s + Number(m.price), 0) * item.quantity
      if (item.isTaxInclusive) seatInclSub += t; else seatExclSub += t
    }
    const seatTaxResult = calculateSplitTax(seatInclSub, seatExclSub, taxRate, inclusiveTaxRate)
    const seatTax = seatTaxResult.totalTax
    const seatTotal = Math.round((seatSubtotal + seatTaxResult.taxFromExclusive) * 100) / 100

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

  // Calculate subtotals for each child
  const childSubtotals = new Map<string, number>()
  let totalChildSubtotal = 0
  for (const child of splitOrders) {
    const seatItems = itemsBySeat.get(child.seatNumber) || []
    let sub = 0
    seatItems.forEach(item => {
      sub += Number(item.price) * item.quantity
      sub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
    })
    childSubtotals.set(child.id, sub)
    totalChildSubtotal += sub
  }

  if (parentDiscounts.length > 0 && totalChildSubtotal > 0) {
    const childDiscAccum = await distributeDiscountsProportionally(
      tx,
      parentDiscounts,
      childSubtotals,
      totalChildSubtotal,
      order.locationId,
      'move',
    )

    // Update each child's discountTotal and total with accumulated discount
    for (const child of splitOrders) {
      const totalChildDisc = childDiscAccum.get(child.id) || 0
      if (totalChildDisc > 0) {
        const childSub = childSubtotals.get(child.id) || 0
        // For discounted children, we need the original seat items to classify
        const childSeatItems = itemsBySeat.get(child.seatNumber) || []
        let cInclSub = 0, cExclSub = 0
        for (const ci of childSeatItems) {
          const t = Number(ci.price) * ci.quantity
            + ci.modifiers.reduce((s, m) => s + Number(m.price), 0) * ci.quantity
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
    const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
    const t = itemTotal + modifiersTotal
    remainingSubtotal += t
    if (item.isTaxInclusive) remInclSub += t; else remExclSub += t
  })

  const remTaxResult = calculateSplitTax(remInclSub, remExclSub, taxRate, inclusiveTaxRate)
  const remainingTax = remTaxResult.totalTax
  const remainingTotal = Math.round((remainingSubtotal + remTaxResult.taxFromExclusive) * 100) / 100

  // Update original order totals and mark as 'split'
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: 'split',
      subtotal: remainingSubtotal,
      discountTotal: 0,
      taxTotal: remainingTax,
      taxFromInclusive: remTaxResult.taxFromInclusive,
      taxFromExclusive: remTaxResult.taxFromExclusive,
      total: remainingTotal,
      itemCount: remainingItems.reduce((sum, i) => sum + i.quantity, 0),
      notes: order.notes
        ? `${order.notes}\n[Split by seat: ${sortedSeats.length} seats]`
        : `[Split by seat: ${sortedSeats.length} seats]`,
      version: { increment: 1 },
    },
  })

  return {
    splitOrders,
    itemIdsToRemove,
    remainingItems,
    remainingTotal,
  }
}

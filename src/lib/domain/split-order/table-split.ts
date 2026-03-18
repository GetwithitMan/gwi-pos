/**
 * Table Split — Split Order Domain
 *
 * Splits an order by source table — one child order per table.
 * Items without table assignments stay on the parent.
 */

import { OrderItemStatus } from '@/generated/prisma/client'
import { calculateSplitTax } from '@/lib/order-calculations'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { distributeDiscountsProportionally } from './discount-distribution'
import type { TxClient, SplitSourceOrder, SplitOrderItem, TableSplitResult } from './types'

/**
 * Create a by-table split inside an existing transaction.
 * Creates one child order per source table, soft-deletes moved items from parent.
 *
 * @param tableNameMap - Map of tableId to display name (fetched by route outside transaction)
 */
export async function createTableSplit(
  tx: TxClient,
  order: SplitSourceOrder,
  taxRate: number,
  tablesWithItems: string[],
  tableNameMap: Map<string, string>,
  inclusiveTaxRate?: number,
): Promise<TableSplitResult> {
  await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

  // Group items by sourceTableId
  const itemsByTable = new Map<string | null, SplitOrderItem[]>()
  for (const item of order.items) {
    const tableId = item.sourceTableId
    if (!itemsByTable.has(tableId)) {
      itemsByTable.set(tableId, [])
    }
    itemsByTable.get(tableId)!.push(item)
  }

  const baseOrderNumber = order.orderNumber

  // Get current max split index
  const existingSplits = await tx.order.count({
    where: { parentOrderId: order.id },
  })

  // Create a split order for each table
  const splitOrders: Array<{
    id: string
    orderNumber: number
    splitIndex: number | null
    displayNumber: string
    tableId: string
    tableName: string
    total: number
    itemCount: number
    paidAmount: number
    isPaid: boolean
  }> = []
  let splitIndex = existingSplits

  for (const tableId of tablesWithItems) {
    const tableItems = itemsByTable.get(tableId) || []
    if (tableItems.length === 0) continue

    splitIndex++
    const tableName = tableNameMap.get(tableId) || `Table ${tableId.slice(0, 4)}`

    // Calculate totals for this table's items
    let tableSubtotal = 0
    const newItems = tableItems.map(item => {
      const itemTotal = Number(item.price) * item.quantity
      const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
      tableSubtotal += itemTotal + modifiersTotal

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
        sourceTableId: item.sourceTableId,
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
            customEntryName: mod.customEntryName,
            customEntryPrice: mod.customEntryPrice,
            swapTargetName: mod.swapTargetName,
            swapTargetItemId: mod.swapTargetItemId,
            swapPricingMode: mod.swapPricingMode,
            swapEffectivePrice: mod.swapEffectivePrice,
          })),
        },
      }
    })

    // Split-aware tax for this table's items
    let tblInclSub = 0, tblExclSub = 0
    for (const item of tableItems) {
      const t = Number(item.price) * item.quantity
        + item.modifiers.reduce((s, m) => s + Number(m.price), 0) * item.quantity
      if (item.isTaxInclusive) tblInclSub += t; else tblExclSub += t
    }
    const tableTaxResult = calculateSplitTax(tblInclSub, tblExclSub, taxRate, inclusiveTaxRate)
    const tableTax = tableTaxResult.totalTax
    const tableTotal = Math.round((tableSubtotal + tableTaxResult.taxFromExclusive) * 100) / 100

    // Create split order for this table
    const splitOrder = await tx.order.create({
      data: {
        orderNumber: baseOrderNumber,
        displayNumber: `${baseOrderNumber}-${splitIndex}`,
        locationId: order.locationId,
        employeeId: order.employeeId,
        customerId: order.customerId ?? undefined,
        orderType: order.orderType ?? undefined,
        status: 'open',
        tableId: tableId,
        tabName: order.tabName ?? undefined,
        guestCount: 1,
        subtotal: tableSubtotal,
        discountTotal: 0,
        taxTotal: tableTax,
        taxFromInclusive: tableTaxResult.taxFromInclusive,
        taxFromExclusive: tableTaxResult.taxFromExclusive,
        tipTotal: 0,
        total: tableTotal,
        itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
        parentOrderId: order.id,
        splitIndex,
        notes: `${tableName} from order #${baseOrderNumber}`,
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
      tableId,
      tableName,
      total: Number(splitOrder.total),
      itemCount: (splitOrder.items as any[]).length,
      paidAmount: 0,
      isPaid: false,
    })

    // Update MenuItem.currentOrderId for timed_rental items moved to split child
    const movedEntertainmentItems = tableItems.filter(
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
  const itemIdsToRemove = tablesWithItems.flatMap(tableId =>
    itemsByTable.get(tableId)?.map(item => item.id) || []
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

  // --- Distribute parent OrderDiscount records proportionally to table children ---
  const parentDiscounts = await tx.orderDiscount.findMany({
    where: { orderId: order.id, deletedAt: null },
  })

  // Calculate subtotals for each child
  const childSubtotals = new Map<string, number>()
  let totalChildSubtotal = 0
  for (const child of splitOrders) {
    const tblItems = itemsByTable.get(child.tableId) || []
    let sub = 0
    tblItems.forEach(item => {
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
        const childTableItems = itemsByTable.get(child.tableId) || []
        let cInclSub = 0, cExclSub = 0
        for (const ci of childTableItems) {
          const t = Number(ci.price) * ci.quantity
            + ci.modifiers.reduce((s, m) => s + Number(m.price), 0) * ci.quantity
          if (ci.isTaxInclusive) cInclSub += t; else cExclSub += t
        }
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

  // Recalculate original order totals (for items without table assignment)
  const remainingItems = (itemsByTable.get(null) || []) as SplitOrderItem[]
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
        ? `${order.notes}\n[Split by table: ${tablesWithItems.length} tables]`
        : `[Split by table: ${tablesWithItems.length} tables]`,
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
        reason: 'Moved via table split',
      },
    }))).catch(err => console.error('[table-split] Failed to emit ITEM_REMOVED events:', err))
  }

  // Emit ORDER_CREATED for each child split order (one per table)
  for (const child of splitOrders) {
    void emitOrderEvent(order.locationId, child.id, 'ORDER_CREATED', {
      locationId: order.locationId,
      employeeId: order.employeeId,
      orderType: order.orderType || 'dine_in',
      tableId: child.tableId,
      tabName: order.tabName,
      guestCount: 1,
      orderNumber: child.orderNumber,
      displayNumber: child.displayNumber,
      parentOrderId: order.id,
      splitIndex: child.splitIndex,
      splitType: 'by_table',
      tableName: child.tableName,
    }).catch(err => console.error('[table-split] Failed to emit ORDER_CREATED for child:', err))
  }

  // Emit ORDER_CLOSED on the parent order with closedStatus='split'
  void emitOrderEvent(order.locationId, order.id, 'ORDER_CLOSED', {
    closedStatus: 'split',
    reason: `Table split — ${tablesWithItems.length} table(s)`,
    splitType: 'by_table',
    childOrderIds: splitOrders.map(c => c.id),
  }).catch(err => console.error('[table-split] Failed to emit ORDER_CLOSED for parent:', err))

  return {
    splitOrders,
    itemIdsToRemove,
    remainingItems,
    remainingTotal,
  }
}

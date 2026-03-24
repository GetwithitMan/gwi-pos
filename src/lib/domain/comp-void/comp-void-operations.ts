/**
 * Comp/Void Operations — ORCHESTRATION (takes TxClient)
 *
 * Core comp/void transaction logic: update item, create records,
 * recalculate totals. Called inside db.$transaction().
 */

import { recalculatePercentDiscounts, getLocationTaxRate, calculateSplitTax } from '@/lib/order-calculations'
import { roundToCents } from '@/lib/pricing'
import {
  calculateSubtotalSplit,
  buildOrderTotals,
  calculateCommissionTotal,
} from './calculations'
import type {
  TxClient,
  CompVoidInput,
  CompVoidTxResult,
  CardPaymentInfo,
  ParentTotals,
} from './types'

// ─── Comp/Void Transaction ──────────────────────────────────────────────────

/**
 * Apply a comp or void inside a transaction.
 *
 * - Acquires row-level locks on order + item
 * - Updates item status
 * - Soft-deletes item-level discounts
 * - Creates VoidLog + AuditLog entries
 * - Marks remote approval as used (if applicable)
 * - Recalculates order totals, discounts, commission
 * - Updates parent order totals (if split child)
 *
 * Throws structured error strings: ORDER_NOT_FOUND, ORDER_ALREADY_SETTLED, ITEM_ALREADY_SETTLED
 */
export async function applyCompVoid(
  tx: TxClient,
  input: CompVoidInput,
  locationSettings: { tax?: { defaultRate?: number } },
): Promise<CompVoidTxResult> {
  const {
    orderId, itemId, action, reason, employeeId,
    wasMade, approvedById, approvedAt, remoteApprovalId,
    locationId, itemName, itemQuantity, itemTotal, isBottleService,
  } = input

  const newStatus = action === 'comp' ? 'comped' : 'voided'
  const itemWasMade = action === 'comp' ? true : (wasMade ?? false)

  // 0. Acquire row-level lock to prevent void-during-payment race condition
  const [lockedOrder] = await (tx as any).$queryRaw`
    SELECT "status" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `
  if (!lockedOrder) throw new Error('ORDER_NOT_FOUND')
  if (['paid', 'closed', 'voided'].includes(lockedOrder.status)) {
    throw new Error('ORDER_ALREADY_SETTLED')
  }

  // Re-check item status inside the lock to prevent double comp/void.
  const [freshItem] = await (tx as any).$queryRawUnsafe(
    `SELECT "id", "status" FROM "OrderItem" WHERE "id" = $1 AND "orderId" = $2 FOR UPDATE`,
    itemId,
    orderId,
  ) as Array<{ id: string; status: string }>
  if (!freshItem || freshItem.status !== 'active') {
    throw new Error('ITEM_ALREADY_SETTLED')
  }

  // Collect card payment info for potential Datacap reversal
  const cardPayments: CardPaymentInfo[] = await (tx as any).payment.findMany({
    where: { orderId, status: 'completed', deletedAt: null },
    select: {
      id: true,
      datacapRecordNo: true,
      paymentReaderId: true,
      totalAmount: true,
      refundedAmount: true,
      cardLast4: true,
      paymentMethod: true,
    },
  })

  // 1. Update item status
  await (tx as any).orderItem.update({
    where: { id: itemId },
    data: {
      status: newStatus,
      voidReason: reason,
      wasMade: itemWasMade,
      lastMutatedBy: 'local',
    },
  })

  // 1b. Soft-delete any OrderItemDiscount records for the voided/comped item
  await (tx as any).orderItemDiscount.updateMany({
    where: { orderItemId: itemId, deletedAt: null },
    data: { deletedAt: new Date() },
  })

  // 2. Create void log entry
  const voidLogEntry = await (tx as any).voidLog.create({
    data: {
      locationId,
      orderId,
      employeeId,
      voidType: 'item',
      itemId,
      amount: itemTotal,
      reason: `[${action}] ${reason}`,
      wasMade: action === 'comp' ? true : (wasMade ?? false),
      approvedById: approvedById || null,
      approvedAt: approvedAt || null,
      remoteApprovalId: remoteApprovalId || null,
    },
  })

  // 2b. Log comp/void to AuditLog with linked paper trail
  const previousAuditActions = await (tx as any).auditLog.findMany({
    where: {
      entityType: 'order',
      entityId: orderId,
      action: { in: ['item_voided', 'item_comped'] },
      details: { path: ['itemId'], equals: itemId },
    },
    select: { id: true, action: true, employeeId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  await (tx as any).auditLog.create({
    data: {
      locationId,
      employeeId,
      action: action === 'void' ? 'item_voided' : 'item_comped',
      entityType: 'order',
      entityId: orderId,
      details: {
        itemId,
        itemName,
        quantity: itemQuantity,
        amount: itemTotal,
        reason,
        wasMade: itemWasMade,
        approvedBy: approvedById || null,
        remoteApproval: !!remoteApprovalId,
        relatedAuditActions: previousAuditActions.length > 0
          ? previousAuditActions.map((a: any) => ({
              auditLogId: a.id,
              action: a.action,
              employeeId: a.employeeId,
              at: a.createdAt.toISOString(),
            }))
          : undefined,
      },
    },
  })

  // Log manager override if approval was provided by a different employee
  if (approvedById && approvedById !== employeeId) {
    await (tx as any).auditLog.create({
      data: {
        locationId,
        employeeId: approvedById,
        action: 'manager_override',
        entityType: 'order',
        entityId: orderId,
        details: {
          overrideType: action,
          itemId,
          itemName,
          amount: itemTotal,
          requestedBy: employeeId,
          approvedBy: approvedById,
          reason,
        },
      },
    })
  }

  // 3. Mark remote approval as used
  if (remoteApprovalId) {
    await (tx as any).remoteVoidApproval.update({
      where: { id: remoteApprovalId },
      data: { status: 'used', usedAt: new Date() },
    })
  }

  // 4. Recalculate order totals
  const activeItems = await (tx as any).orderItem.findMany({
    where: { orderId, status: 'active' },
    include: { modifiers: true },
  })

  const split = calculateSubtotalSplit(activeItems)
  const orderLevelDiscount = await recalculatePercentDiscounts(tx as any, orderId, split.subtotal)

  const activeItemDiscounts = await (tx as any).orderItemDiscount.findMany({
    where: { orderId, deletedAt: null },
    select: { amount: true },
  })
  const itemLevelDiscount = activeItemDiscounts.reduce((sum: number, d: any) => sum + Number(d.amount), 0)
  const rawDiscountTotal = roundToCents(orderLevelDiscount + itemLevelDiscount)
  // Cap discount at subtotal to prevent negative totals after comp reduces the subtotal
  const discountTotal = Math.min(rawDiscountTotal, split.subtotal)

  const taxRate = getLocationTaxRate(locationSettings)
  // Get inclusive tax rate from location settings (may differ from exclusive rate)
  const inclusiveTaxRateRaw = (locationSettings as any)?.tax?.inclusiveTaxRate
  const inclusiveRate = inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw) && inclusiveTaxRateRaw > 0
    ? inclusiveTaxRateRaw / 100 : undefined

  // Allocate discount proportionally between inclusive/exclusive, compute tax on post-discount amounts
  let discOnIncl = 0, discOnExcl = 0
  if (discountTotal > 0 && split.subtotal > 0) {
    const inclShare = split.inclusiveSubtotal / split.subtotal
    discOnIncl = roundToCents(discountTotal * inclShare)
    discOnExcl = discountTotal - discOnIncl  // Don't double-round — remainder preserves sum
  }
  const postDiscIncl = roundToCents(Math.max(0, split.inclusiveSubtotal - discOnIncl))
  const postDiscExcl = roundToCents(Math.max(0, split.exclusiveSubtotal - discOnExcl))
  const splitTax = calculateSplitTax(postDiscIncl, postDiscExcl, taxRate, inclusiveRate)
  const totals = buildOrderTotals(
    split.inclusiveSubtotal, split.exclusiveSubtotal, split.subtotal,
    discountTotal, splitTax,
  )

  // Add donation back to total — buildOrderTotals doesn't know about donations
  // (matches pattern in order-totals.ts recalculateOrderTotals)
  const orderForDonation = await (tx as any).order.findUnique({
    where: { id: orderId },
    select: { donationAmount: true },
  })
  const donationAmount = Number(orderForDonation?.donationAmount ?? 0)
  if (donationAmount > 0) {
    totals.total = roundToCents(totals.total + donationAmount)
  }

  const shouldAutoClose = activeItems.length === 0

  // 5. Update order with recalculated totals + increment version
  const txItemCount = activeItems.reduce((sum: number, i: any) => sum + i.quantity, 0)
  await (tx as any).order.update({
    where: { id: orderId },
    data: {
      ...totals,
      itemCount: txItemCount,
      ...(isBottleService ? { bottleServiceCurrentSpend: totals.subtotal } : {}),
      ...(shouldAutoClose ? { status: 'cancelled', paidAt: new Date() } : {}),
      version: { increment: 1 },
      lastMutatedBy: 'local',
    },
  })

  // 5b. Recalculate commission from active items only
  const activeCommissionItems = await (tx as any).orderItem.findMany({
    where: { orderId, status: 'active', deletedAt: null },
    include: { menuItem: { select: { commissionType: true, commissionValue: true } } },
  })
  const newCommission = calculateCommissionTotal(activeCommissionItems)
  await (tx as any).order.update({ where: { id: orderId }, data: { commissionTotal: newCommission } })
  // Zero the voided/comped item's own commission
  await (tx as any).orderItem.update({ where: { id: itemId }, data: { commissionAmount: 0 } })

  // 6. If this is a split child, update parent order totals
  let parentTotals: ParentTotals | null = null
  const parentOrderId = (await (tx as any).order.findUnique({
    where: { id: orderId },
    select: { parentOrderId: true },
  }))?.parentOrderId

  if (parentOrderId) {
    parentTotals = await recalcParentTotals(tx, parentOrderId)
  }

  return {
    activeItemCount: txItemCount,
    totals,
    shouldAutoClose,
    parentTotals,
    cardPayments,
    voidLogId: voidLogEntry.id as string,
  }
}

// ─── Restore (Undo Comp/Void) ───────────────────────────────────────────────

/**
 * Restore a comped/voided item inside a transaction.
 *
 * - Sets item back to 'active'
 * - Restores soft-deleted item-level discounts
 * - Recalculates order totals
 */
export async function applyRestore(
  tx: TxClient,
  orderId: string,
  itemId: string,
  locationSettings: { tax?: { defaultRate?: number } },
  isBottleService: boolean,
): Promise<{ totals: { subtotal: number; discountTotal: number; taxTotal: number; taxFromInclusive: number; taxFromExclusive: number; total: number } }> {
  // 1. Restore the item
  await (tx as any).orderItem.update({
    where: { id: itemId },
    data: { status: 'active', voidReason: null },
  })

  // 1b. Restore soft-deleted item-level discounts
  await (tx as any).orderItemDiscount.updateMany({
    where: { orderItemId: itemId, deletedAt: { not: null } },
    data: { deletedAt: null },
  })

  // 2. Recalculate order totals
  const activeItems = await (tx as any).orderItem.findMany({
    where: { orderId, status: 'active' },
    include: { modifiers: true },
  })

  const split = calculateSubtotalSplit(activeItems)
  const orderLevelDiscount = await recalculatePercentDiscounts(tx as any, orderId, split.subtotal)

  const restoreItemDiscounts = await (tx as any).orderItemDiscount.findMany({
    where: { orderId, deletedAt: null },
    select: { amount: true },
  })
  const itemLevelDiscount = restoreItemDiscounts.reduce((sum: number, d: any) => sum + Number(d.amount), 0)
  const rawRestoreDiscount = roundToCents(orderLevelDiscount + itemLevelDiscount)
  // Cap discount at subtotal for safety (restore adds subtotal back, but guard anyway)
  const discountTotal = Math.min(rawRestoreDiscount, split.subtotal)

  const taxRate = getLocationTaxRate(locationSettings)
  // Get inclusive tax rate from location settings (may differ from exclusive rate)
  const inclusiveTaxRateRaw = (locationSettings as any)?.tax?.inclusiveTaxRate
  const inclusiveRate = inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw) && inclusiveTaxRateRaw > 0
    ? inclusiveTaxRateRaw / 100 : undefined

  // Allocate discount proportionally between inclusive/exclusive, compute tax on post-discount amounts
  let discOnIncl = 0, discOnExcl = 0
  if (discountTotal > 0 && split.subtotal > 0) {
    const inclShare = split.inclusiveSubtotal / split.subtotal
    discOnIncl = roundToCents(discountTotal * inclShare)
    discOnExcl = discountTotal - discOnIncl  // Don't double-round — remainder preserves sum
  }
  const postDiscIncl = roundToCents(Math.max(0, split.inclusiveSubtotal - discOnIncl))
  const postDiscExcl = roundToCents(Math.max(0, split.exclusiveSubtotal - discOnExcl))
  const splitTax = calculateSplitTax(postDiscIncl, postDiscExcl, taxRate, inclusiveRate)
  const totals = buildOrderTotals(
    split.inclusiveSubtotal, split.exclusiveSubtotal, split.subtotal,
    discountTotal, splitTax,
  )

  // Add donation back to total — buildOrderTotals doesn't know about donations
  const restoreOrderForDonation = await (tx as any).order.findUnique({
    where: { id: orderId },
    select: { donationAmount: true },
  })
  const restoreDonation = Number(restoreOrderForDonation?.donationAmount ?? 0)
  if (restoreDonation > 0) {
    totals.total = roundToCents(totals.total + restoreDonation)
  }

  // 3. Update order with recalculated totals
  await (tx as any).order.update({
    where: { id: orderId },
    data: {
      ...totals,
      itemCount: activeItems.reduce((sum: number, i: any) => sum + i.quantity, 0),
      ...(isBottleService ? { bottleServiceCurrentSpend: totals.subtotal } : {}),
      version: { increment: 1 },
    },
  })

  return { totals }
}

// ─── Parent Totals ──────────────────────────────────────────────────────────

/**
 * Recalculate parent order totals from sibling split orders.
 */
async function recalcParentTotals(
  tx: TxClient,
  parentOrderId: string,
): Promise<ParentTotals> {
  const siblings = await (tx as any).order.findMany({
    where: { parentOrderId, deletedAt: null },
    select: {
      subtotal: true,
      taxTotal: true,
      taxFromInclusive: true,
      taxFromExclusive: true,
      total: true,
      discountTotal: true,
      items: {
        where: { status: 'active', deletedAt: null },
        select: { quantity: true },
      },
    },
  })

  const parentSubtotal = siblings.reduce((sum: number, s: any) => sum + Number(s.subtotal), 0)
  const parentTaxTotal = siblings.reduce((sum: number, s: any) => sum + Number(s.taxTotal), 0)
  const parentTaxFromInclusive = siblings.reduce((sum: number, s: any) => sum + Number(s.taxFromInclusive ?? 0), 0)
  const parentTaxFromExclusive = siblings.reduce((sum: number, s: any) => sum + Number(s.taxFromExclusive ?? 0), 0)
  const parentTotal = siblings.reduce((sum: number, s: any) => sum + Number(s.total), 0)
  const parentDiscountTotal = siblings.reduce((sum: number, s: any) => sum + Number(s.discountTotal), 0)
  const parentItemCount = siblings.reduce(
    (sum: number, s: any) => sum + s.items.reduce((iSum: number, i: any) => iSum + i.quantity, 0), 0,
  )

  await (tx as any).order.update({
    where: { id: parentOrderId },
    data: {
      subtotal: parentSubtotal,
      taxTotal: parentTaxTotal,
      taxFromInclusive: parentTaxFromInclusive,
      taxFromExclusive: parentTaxFromExclusive,
      total: parentTotal,
      discountTotal: parentDiscountTotal,
      itemCount: parentItemCount,
    },
  })

  return {
    subtotal: parentSubtotal,
    taxTotal: parentTaxTotal,
    taxFromInclusive: parentTaxFromInclusive,
    taxFromExclusive: parentTaxFromExclusive,
    total: parentTotal,
    discountTotal: parentDiscountTotal,
    itemCount: parentItemCount,
  }
}

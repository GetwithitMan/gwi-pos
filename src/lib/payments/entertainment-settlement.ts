/**
 * Entertainment Settlement — settles per-minute timed rental pricing before payment.
 *
 * For timed_rental items with per-minute pricing, the order item's price was set to
 * the base price at ordering time. At payment, compute the actual charge from elapsed time.
 * Tax is recalculated after price settlement (not just subtotal + old tax).
 */

import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { calculateCharge, type EntertainmentPricing, type OvertimeConfig } from '@/lib/entertainment-pricing'
import { getLocationTaxRate, recalculatePercentDiscounts, calculateSplitTax } from '@/lib/order-calculations'
import { toNumber, roundToCents } from '@/lib/pricing'

interface OrderForSettlement {
  items: Array<{
    id: string
    menuItemId: string
    blockTimeStartedAt: Date | null
    blockTimeExpiresAt: Date | null
    blockTimeMinutes: number | null
    quantity: number
    menuItem?: { itemType?: string } | null
  }>
  location: {
    settings: unknown
  }
}

interface SettlementResult {
  subtotal: number
  discountTotal: number
  taxTotal: number
  taxFromInclusive: number
  taxFromExclusive: number
  total: number
}

/**
 * Settle per-minute entertainment items and recalculate order totals.
 * Returns null if no per-minute items exist (no settlement needed).
 * Otherwise returns the new order totals after settlement.
 */
export async function settleEntertainmentPricing(
  tx: any,
  orderId: string,
  locationId: string,
  order: OrderForSettlement,
  inclusiveTaxRate: number | undefined,
): Promise<SettlementResult | null> {
  const perMinuteItems = order.items.filter(
    (item: any) => item.menuItem?.itemType === 'timed_rental' && item.blockTimeStartedAt && !item.blockTimeExpiresAt
  )

  if (perMinuteItems.length === 0) return null

  const now = new Date()
  const payLocSettings = order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } } | null
  const taxRate = getLocationTaxRate(payLocSettings)

  // Prefer order-level snapshot; fall back to location setting with > 0 guard
  const payInclRateRaw = payLocSettings?.tax?.inclusiveTaxRate
  const payInclusiveRate = inclusiveTaxRate
    ?? (payInclRateRaw != null && Number.isFinite(payInclRateRaw) && payInclRateRaw > 0
      ? payInclRateRaw / 100 : undefined)

  // Batch-fetch all menu items for per-minute settlement in ONE query (N+1 fix)
  const perMinuteMenuItemIds = [...new Set(perMinuteItems.map((item: any) => item.menuItemId))]
  const perMinuteMenuItems = await tx.menuItem.findMany({
    where: { id: { in: perMinuteMenuItemIds } },
    select: {
      id: true, ratePerMinute: true, minimumCharge: true, incrementMinutes: true, graceMinutes: true, price: true,
      overtimeEnabled: true, overtimeMode: true, overtimeMultiplier: true,
      overtimePerMinuteRate: true, overtimeFlatFee: true, overtimeGraceMinutes: true,
    },
  })
  const perMinuteMenuItemMap = new Map<string, any>(perMinuteMenuItems.map((mi: any) => [mi.id, mi]))

  // Calculate settlements and batch the updates
  const settlementUpdates: Promise<unknown>[] = []
  for (const item of perMinuteItems) {
    const startedAt = new Date(item.blockTimeStartedAt!)
    const elapsedMinutes = Math.max(1, Math.ceil((now.getTime() - startedAt.getTime()) / 60000))

    const mi = perMinuteMenuItemMap.get(item.menuItemId)
    if (!mi) continue

    const ratePerMinute = mi.ratePerMinute ? toNumber(mi.ratePerMinute) : 0
    if (ratePerMinute <= 0) continue

    // Build overtime config if enabled on the menu item
    const otConfig: OvertimeConfig | undefined = mi.overtimeEnabled
      ? {
          enabled: true,
          mode: (mi.overtimeMode as OvertimeConfig['mode']) || 'multiplier',
          multiplier: mi.overtimeMultiplier ? toNumber(mi.overtimeMultiplier) : undefined,
          perMinuteRate: mi.overtimePerMinuteRate ? toNumber(mi.overtimePerMinuteRate) : undefined,
          flatFee: mi.overtimeFlatFee ? toNumber(mi.overtimeFlatFee) : undefined,
          graceMinutes: mi.overtimeGraceMinutes ?? undefined,
        }
      : undefined

    const pricing: EntertainmentPricing = {
      ratePerMinute,
      minimumCharge: mi.minimumCharge ? toNumber(mi.minimumCharge) : 0,
      incrementMinutes: mi.incrementMinutes ?? 15,
      graceMinutes: mi.graceMinutes ?? 5,
      overtime: otConfig,
    }

    // Pass bookedMinutes to calculateCharge so overtime applies if session exceeded booked time
    const bookedMinutes = item.blockTimeMinutes || undefined
    const breakdown = calculateCharge(elapsedMinutes, pricing, bookedMinutes)
    const settledPrice = breakdown.totalCharge

    settlementUpdates.push(
      OrderItemRepository.updateItem(item.id, locationId, {
        price: settledPrice,
        itemTotal: settledPrice * item.quantity,
      }, tx)
    )
  }
  await Promise.all(settlementUpdates)

  // Recalculate totals from active items
  const activeItems = await (tx as any).orderItem.findMany({
    where: { orderId, locationId, status: 'active', deletedAt: null },
    include: { modifiers: true },
  })

  let newSubtotal = 0
  for (const ai of activeItems) {
    const modTotal = ai.modifiers.reduce((s: number, m: any) => s + toNumber(m.price), 0)
    newSubtotal += roundToCents((toNumber(ai.price) + modTotal) * ai.quantity)
  }
  newSubtotal = roundToCents(newSubtotal)

  // Recalculate percent-based discounts against new subtotal
  const newDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotal)
  const effectiveDiscount = Math.min(newDiscountTotal, newSubtotal)

  // Split-aware tax recalculation after entertainment settlement
  let payInclSub = 0, payExclSub = 0
  for (const ai of activeItems) {
    const modTotal = ai.modifiers.reduce((s: number, m: any) => s + toNumber(m.price), 0)
    const t = roundToCents((toNumber(ai.price) + modTotal) * ai.quantity)
    if ((ai as any).isTaxInclusive) payInclSub += t; else payExclSub += t
  }
  payInclSub = roundToCents(payInclSub)
  payExclSub = roundToCents(payExclSub)

  // Allocate discount proportionally between inclusive and exclusive
  let payDiscIncl = 0, payDiscExcl = 0
  if (effectiveDiscount > 0 && newSubtotal > 0) {
    payDiscIncl = roundToCents(effectiveDiscount * (payInclSub / newSubtotal))
    payDiscExcl = roundToCents(effectiveDiscount - payDiscIncl)
  }

  const payTaxResult = calculateSplitTax(
    Math.max(0, payInclSub - payDiscIncl), Math.max(0, payExclSub - payDiscExcl), taxRate, payInclusiveRate
  )
  const newTaxTotal = payTaxResult.totalTax
  const newTotal = roundToCents(newSubtotal + payTaxResult.taxFromExclusive - effectiveDiscount)

  await OrderRepository.updateOrder(orderId, locationId, {
    subtotal: newSubtotal,
    discountTotal: effectiveDiscount,
    taxTotal: newTaxTotal,
    taxFromInclusive: payTaxResult.taxFromInclusive,
    taxFromExclusive: payTaxResult.taxFromExclusive,
    total: newTotal,
  }, tx)

  return {
    subtotal: newSubtotal,
    discountTotal: effectiveDiscount,
    taxTotal: newTaxTotal,
    taxFromInclusive: payTaxResult.taxFromInclusive,
    taxFromExclusive: payTaxResult.taxFromExclusive,
    total: newTotal,
  }
}

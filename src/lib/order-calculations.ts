/**
 * Order Calculations - Single Source of Truth
 *
 * Centralized calculation logic for order totals, taxes, and commissions.
 * Used by both client (UI) and server (API routes) to ensure consistency.
 *
 * PRINCIPLES:
 * - All money rounding goes through roundToCents() from pricing.ts
 * - Rounding is the absolute last step (sum raw → dual pricing → discount → tax → tip → THEN round)
 * - Tax lines are rounded to 2 decimals (compliance), final total optionally rounded per settings
 * - taxRate is always a decimal (0.08), never ambiguous 8 vs 0.08
 */

import { roundToCents, applyPriceRounding, calculateCommission } from './pricing'
import type { PriceRoundingSettings } from './settings'

// ============================================================================
// TYPES
// ============================================================================

export interface OrderItemForCalculation {
  price: number
  quantity: number
  status?: string // 'active' | 'voided' | 'comped' — voided/comped items excluded from totals
  modifiers?: Array<{
    price: number
    quantity?: number
  }>
  ingredientModifications?: Array<{
    priceAdjustment: number
  }>
  itemTotal?: number // For persisted items from DB
  commissionAmount?: number // For persisted items from DB
  categoryType?: string | null // For tax-inclusive pricing split
  isTaxInclusive?: boolean // Stored on OrderItem — true if item was tax-inclusive at time of sale
  // Weight-based pricing (sold-by-weight items)
  weight?: number | null       // NET weight (post-tare)
  weightUnit?: string | null   // "lb" | "kg" | "oz" | "g"
  unitPrice?: number | null    // Price per weight unit
  soldByWeight?: boolean
}

export interface LocationTaxSettings {
  tax?: {
    defaultRate?: number // Stored as percentage (e.g. 8 for 8%), converted to decimal internally
    inclusiveTaxRate?: number // Separate rate for tax-inclusive items (percentage, e.g. 10 for 10%)
  }
}

export interface OrderTotals {
  subtotal: number
  taxTotal: number
  taxFromInclusive: number  // Tax backed out of inclusive items
  taxFromExclusive: number  // Tax added on top of exclusive items
  discountTotal: number
  tipTotal: number
  totalBeforeRounding: number  // Total before price rounding applied
  total: number                // Final total (after rounding if applicable)
  roundingDelta: number        // total - totalBeforeRounding (0 if no rounding)
  commissionTotal?: number
}

// ============================================================================
// ITEM CALCULATIONS
// ============================================================================

/**
 * Calculate the total for a single order item (before order-level adjustments)
 *
 * Formula: (itemPrice * qty) + (modifierPrices * qty) + (ingredientAdjustments * qty)
 */
export function calculateItemTotal(item: OrderItemForCalculation): number {
  // If item already has itemTotal (from DB), use it
  if (item.itemTotal !== undefined && item.itemTotal !== null) {
    return Number(item.itemTotal) || 0
  }

  // Calculate from components
  const price = Number(item.price ?? 0) || 0
  const quantity = Number(item.quantity ?? 1) || 1
  // Weight-based items: unitPrice * weight * quantity (instead of price * quantity)
  const itemBaseTotal = (item.soldByWeight && item.weight && item.unitPrice)
    ? (Number(item.unitPrice ?? 0) || 0) * (Number(item.weight ?? 0) || 0) * quantity
    : price * quantity

  const modifiersTotal = (item.modifiers || []).reduce((sum, mod) => {
    return sum + ((Number(mod.price ?? 0) || 0) * (Number(mod.quantity ?? 1) || 1))
  }, 0) * quantity

  const ingredientModTotal = (item.ingredientModifications || []).reduce((sum, ing) => {
    return sum + (Number(ing.priceAdjustment ?? 0) || 0)
  }, 0) * quantity

  return itemBaseTotal + modifiersTotal + ingredientModTotal
}

/**
 * Calculate commission for a single item.
 * Delegates to the canonical calculateCommission in pricing.ts.
 */
export function calculateItemCommission(
  itemTotal: number,
  quantity: number,
  commissionType: string | null,
  commissionValue: number | null
): number {
  return calculateCommission(itemTotal, commissionType, commissionValue, quantity)
}

// ============================================================================
// ORDER CALCULATIONS
// ============================================================================

// Memoization cache for calculateOrderTotals — avoids redundant recalculation
// during rapid re-renders of the same order. Small fixed-size cache (max 20 entries).
const _totalsCache = new Map<string, OrderTotals>()
const TOTALS_CACHE_MAX = 20

// Version counter bumped externally (or on cache miss) to cheaply invalidate
// the totals cache without serializing the entire items array.
let _totalsCacheVersion = 0

/** Call this whenever order items mutate to invalidate the totals cache. */
export function invalidateTotalsCache(): void {
  _totalsCacheVersion++
  _totalsCache.clear()
}

function buildTotalsCacheKey(
  items: Array<OrderItemForCalculation & { commissionAmount?: number }>,
  locationSettings: LocationTaxSettings | null,
  discountTotal: number,
  tipTotal: number,
  priceRounding: PriceRoundingSettings | undefined,
  paymentMethod: string
): string {
  // Cheap key: version + item count + sum of price-affecting fields.
  // This avoids JSON.stringify on 5-10KB of data per call.
  let hash = _totalsCacheVersion * 100003
  for (const i of items) {
    hash = (hash * 31 + (i.price || 0) * 100) | 0
    hash = (hash * 31 + (i.quantity || 0)) | 0
    hash = (hash * 31 + (i.itemTotal ?? -1) * 100) | 0
    hash = (hash * 31 + (i.commissionAmount ?? -1) * 100) | 0
    hash = (hash * 31 + (i.isTaxInclusive ? 1 : 0)) | 0
    hash = (hash * 31 + (i.weight ?? 0) * 100) | 0
    hash = (hash * 31 + (i.unitPrice ?? 0) * 100) | 0
    const s = i.status
    hash = (hash * 31 + (s === 'voided' ? 2 : s === 'comped' ? 3 : 1)) | 0
    const mods = i.modifiers
    if (mods) for (const m of mods) {
      hash = (hash * 31 + (m.price || 0) * 100) | 0
      hash = (hash * 31 + (m.quantity ?? 1)) | 0
    }
    const ings = i.ingredientModifications
    if (ings) for (const ig of ings) {
      hash = (hash * 31 + (ig.priceAdjustment || 0) * 100) | 0
    }
  }
  hash = (hash * 31 + (locationSettings?.tax?.defaultRate ?? 0) * 100) | 0
  hash = (hash * 31 + (locationSettings?.tax?.inclusiveTaxRate ?? 0) * 100) | 0
  hash = (hash * 31 + discountTotal * 100) | 0
  hash = (hash * 31 + tipTotal * 100) | 0
  return `${items.length}:${hash}:${paymentMethod}:${priceRounding ? 1 : 0}`
}

/**
 * Calculate order subtotal from all items
 */
export function calculateOrderSubtotal(items: OrderItemForCalculation[]): number {
  return items
    .filter(item => !item.status || item.status === 'active')
    .reduce((sum, item) => sum + calculateItemTotal(item), 0)
}

/**
 * Calculate total commission from all items
 */
export function calculateOrderCommission(
  items: Array<OrderItemForCalculation & { commissionAmount?: number }>
): number {
  return items.reduce((sum, item) => {
    if (item.commissionAmount !== undefined && item.commissionAmount !== null) {
      return sum + (Number(item.commissionAmount) || 0)
    }
    return sum
  }, 0)
}

/**
 * Calculate tax based on subtotal and location settings
 */
export function calculateOrderTax(
  subtotal: number,
  locationSettings: LocationTaxSettings | null
): number {
  const taxRate = (locationSettings?.tax?.defaultRate ?? 0) / 100
  return roundToCents(subtotal * taxRate)
}

/**
 * Calculate final order total
 */
export function calculateOrderTotal(
  subtotal: number,
  taxTotal: number,
  discountTotal: number,
  tipTotal: number
): number {
  return roundToCents(subtotal + taxTotal - discountTotal + tipTotal)
}

/**
 * Calculate all order totals at once.
 *
 * Pipeline:
 * 1. Sum raw item totals → inclusiveSubtotal, exclusiveSubtotal
 * 2. Calculate split tax (back out inclusive, add exclusive) — rounded to cents for compliance
 * 3. Compute totalBeforeRounding = inclusive + exclusive + taxFromExclusive - discounts + tip
 * 4. Apply price rounding as absolute last step (if settings provided)
 * 5. Return roundingDelta for display
 *
 * @param items - Array of order items (inline or persisted)
 * @param locationSettings - Location settings (for tax rate, stored as percentage e.g. 8)
 * @param existingDiscountTotal - Order-level discount (default 0)
 * @param existingTipTotal - Order-level tip (default 0)
 * @param priceRounding - Optional price rounding settings (Skill 88)
 * @param paymentMethod - Payment method for rounding rules (default 'card')
 */
export function calculateOrderTotals(
  items: Array<OrderItemForCalculation & { commissionAmount?: number }>,
  locationSettings: LocationTaxSettings | null,
  existingDiscountTotal: number = 0,
  existingTipTotal: number = 0,
  priceRounding?: PriceRoundingSettings,
  paymentMethod: 'cash' | 'card' = 'card',
  isTaxExempt?: boolean
): OrderTotals {
  // Memoization: return cached result if inputs unchanged
  const cacheKey = buildTotalsCacheKey(items, locationSettings, existingDiscountTotal, existingTipTotal, priceRounding, paymentMethod)
  const cached = _totalsCache.get(cacheKey)
  if (cached && !isTaxExempt) return cached

  const rawRate = locationSettings?.tax?.defaultRate ?? 0
  const taxRate = isTaxExempt ? 0 : (Number.isFinite(rawRate) ? rawRate : 0) / 100
  const commissionTotal = calculateOrderCommission(items)

  // 1. Split items into tax-inclusive vs tax-exclusive
  let inclusiveSubtotal = 0
  let exclusiveSubtotal = 0

  for (const item of items) {
    if (item.status && item.status !== 'active') continue
    const total = calculateItemTotal(item)
    if (item.isTaxInclusive) {
      inclusiveSubtotal += total
    } else {
      exclusiveSubtotal += total
    }
  }

  inclusiveSubtotal = roundToCents(inclusiveSubtotal)
  exclusiveSubtotal = roundToCents(exclusiveSubtotal)
  const subtotal = roundToCents(inclusiveSubtotal + exclusiveSubtotal)

  // 2. Allocate discount proportionally between inclusive and exclusive items,
  //    then compute tax on the POST-DISCOUNT amounts (most US jurisdictions require this).
  let discountOnInclusive = 0
  let discountOnExclusive = 0
  if (existingDiscountTotal > 0 && subtotal > 0) {
    const inclusiveShare = inclusiveSubtotal / subtotal
    discountOnInclusive = roundToCents(existingDiscountTotal * inclusiveShare)
    discountOnExclusive = roundToCents(existingDiscountTotal - discountOnInclusive)
  }

  const postDiscountInclusive = roundToCents(Math.max(0, inclusiveSubtotal - discountOnInclusive))
  const postDiscountExclusive = roundToCents(Math.max(0, exclusiveSubtotal - discountOnExclusive))

  // Split tax on post-discount amounts — rounded to cents for compliance
  const inclusiveTaxRateRaw = locationSettings?.tax?.inclusiveTaxRate
  const inclusiveRate = inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw)
    ? inclusiveTaxRateRaw / 100 : undefined
  const { taxFromInclusive, taxFromExclusive, totalTax } = calculateSplitTax(
    postDiscountInclusive, postDiscountExclusive, taxRate, inclusiveRate
  )

  // 3. Total before rounding
  // Inclusive items already contain tax (no extra added), exclusive items get taxFromExclusive added
  // Discount is already reflected in the post-discount tax, so subtract it from the base amounts
  const totalBeforeRounding = roundToCents(
    inclusiveSubtotal + exclusiveSubtotal + taxFromExclusive
    - existingDiscountTotal + existingTipTotal
  )

  // 4. Apply price rounding as absolute last step
  let total = totalBeforeRounding
  let roundingDelta = 0

  if (priceRounding) {
    total = applyPriceRounding(totalBeforeRounding, priceRounding, paymentMethod)
    roundingDelta = roundToCents(total - totalBeforeRounding)
  }

  const result: OrderTotals = {
    subtotal,
    taxTotal: totalTax,
    taxFromInclusive,
    taxFromExclusive,
    discountTotal: existingDiscountTotal,
    tipTotal: existingTipTotal,
    totalBeforeRounding,
    total,
    roundingDelta,
    commissionTotal,
  }

  // Store in cache (evict oldest entries if over limit)
  if (_totalsCache.size >= TOTALS_CACHE_MAX) {
    const firstKey = _totalsCache.keys().next().value!
    _totalsCache.delete(firstKey)
  }
  _totalsCache.set(cacheKey, result)

  return result
}

// ============================================================================
// TIP CALCULATIONS
// ============================================================================

/**
 * Recalculate order total when tip changes
 */
export function recalculateTotalWithTip(
  subtotal: number,
  taxTotal: number,
  discountTotal: number,
  newTipTotal: number
): number {
  return calculateOrderTotal(subtotal, taxTotal, discountTotal, newTipTotal)
}

// ============================================================================
// TAX-INCLUSIVE PRICING
// ============================================================================

const LIQUOR_CATEGORY_TYPES = ['liquor', 'drinks']
const FOOD_CATEGORY_TYPES = ['food', 'pizza', 'combos']

export interface TaxInclusiveSettings {
  taxInclusiveLiquor: boolean
  taxInclusiveFood: boolean
}

/**
 * Check if an item's category type is tax-inclusive based on settings
 */
export function isItemTaxInclusive(
  categoryType: string | null | undefined,
  settings: TaxInclusiveSettings
): boolean {
  if (!categoryType) return false
  const ct = categoryType.toLowerCase()
  if (settings.taxInclusiveLiquor && LIQUOR_CATEGORY_TYPES.includes(ct)) return true
  if (settings.taxInclusiveFood && FOOD_CATEGORY_TYPES.includes(ct)) return true
  return false
}

/**
 * Split order items into tax-inclusive and tax-exclusive subtotals.
 */
export function splitSubtotalsByTaxInclusion(
  items: OrderItemForCalculation[],
  taxInclusiveSettings: TaxInclusiveSettings
): { inclusiveSubtotal: number; exclusiveSubtotal: number } {
  let inclusiveSubtotal = 0
  let exclusiveSubtotal = 0

  for (const item of items) {
    if (item.status && item.status !== 'active') continue
    const total = calculateItemTotal(item)
    if (isItemTaxInclusive(item.categoryType, taxInclusiveSettings)) {
      inclusiveSubtotal += total
    } else {
      exclusiveSubtotal += total
    }
  }

  return {
    inclusiveSubtotal: roundToCents(inclusiveSubtotal),
    exclusiveSubtotal: roundToCents(exclusiveSubtotal),
  }
}

/**
 * Calculate tax for a mixed order with both inclusive and exclusive items.
 *
 * Inclusive: tax = price - (price / (1 + rate))  — backed out
 * Exclusive: tax = price × rate                  — added on top
 */
export function calculateSplitTax(
  inclusiveSubtotal: number,
  exclusiveSubtotal: number,
  taxRate: number,
  inclusiveTaxRate?: number
): { taxFromInclusive: number; taxFromExclusive: number; totalTax: number } {
  const inclRate = inclusiveTaxRate ?? taxRate
  // Guard: rates must be finite and non-negative to produce valid tax
  const safeInclRate = Number.isFinite(inclRate) && inclRate > 0 ? inclRate : 0
  const safeExclRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0
  const taxFromInclusive = inclusiveSubtotal > 0 && safeInclRate > 0
    ? roundToCents(inclusiveSubtotal - (inclusiveSubtotal / (1 + safeInclRate)))
    : 0
  const taxFromExclusive = exclusiveSubtotal > 0 && safeExclRate > 0
    ? roundToCents(exclusiveSubtotal * safeExclRate)
    : 0

  return {
    taxFromInclusive,
    taxFromExclusive,
    totalTax: roundToCents(taxFromInclusive + taxFromExclusive),
  }
}

// ── Legacy helpers (migrated from deprecated tax-calculations.ts) ──

/**
 * Get the location's default tax rate as a decimal (e.g., 0.08 for 8%).
 */
export function getLocationTaxRate(settings: { tax?: { defaultRate?: number } } | null | undefined): number {
  const rate = settings?.tax?.defaultRate ?? 0
  return rate / 100
}

/**
 * Get the effective tax rate for a specific item.
 */
export function getEffectiveTaxRate(
  itemTaxRate: number | null | undefined,
  itemTaxExempt: boolean,
  locationTaxRate: number
): number {
  if (itemTaxExempt) return 0
  if (itemTaxRate != null) return itemTaxRate / 100
  return locationTaxRate
}

/**
 * Calculate tax on a subtotal using a single rate.
 */
export function calculateTax(subtotal: number, taxRate: number): number {
  return roundToCents(subtotal * taxRate)
}

/**
 * @deprecated Use calculateOrderTotals() instead — this function uses single-rate
 * tax math and does NOT support tax-inclusive pricing. Remaining callers should
 * be migrated.
 */
export function calculateSimpleOrderTotals(
  subtotal: number,
  discountTotal: number,
  locationSettings: { tax?: { defaultRate?: number } } | null | undefined,
  isTaxExempt?: boolean
): {
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
} {
  const taxRate = isTaxExempt ? 0 : getLocationTaxRate(locationSettings)
  const effectiveDiscount = Math.min(discountTotal, subtotal)
  const taxableAmount = subtotal - effectiveDiscount
  const taxTotal = roundToCents(taxableAmount * taxRate)
  const total = roundToCents(taxableAmount + taxTotal)

  return {
    subtotal,
    discountTotal: effectiveDiscount,
    taxTotal,
    total,
  }
}

// ============================================================================
// DISCOUNT RECALCULATION
// ============================================================================

/**
 * Recalculate percent-based discount amounts when the subtotal changes.
 *
 * Percent discounts are stored as fixed dollar amounts at the time of application.
 * When items are added, removed, or voided, the subtotal changes but the discount
 * amounts stay stale. This function updates them.
 *
 * @param tx - Prisma transaction client (or db)
 * @param orderId - The order to recalculate discounts for
 * @param newSubtotal - The new subtotal after item changes
 * @returns The new total discount amount (sum of all discount amounts)
 */
export async function recalculatePercentDiscounts(
  tx: { orderDiscount: { findMany: (...args: any[]) => Promise<any>; update: (...args: any[]) => Promise<any> } },
  orderId: string,
  newSubtotal: number
): Promise<number> {
  const discounts = await tx.orderDiscount.findMany({
    where: { orderId, deletedAt: null },
  })

  if (discounts.length === 0) return 0

  let totalDiscount = 0

  for (const discount of discounts) {
    const percent = discount.percent ? Number(discount.percent) : null

    if (percent != null && percent > 0) {
      // Recalculate amount from percentage and new subtotal
      const newAmount = roundToCents(newSubtotal * (percent / 100))
      // Cap: discount can't exceed remaining subtotal
      const cappedAmount = Math.min(newAmount, Math.max(0, newSubtotal - totalDiscount))

      if (cappedAmount !== (Number(discount.amount) || 0)) {
        await tx.orderDiscount.update({
          where: { id: discount.id },
          data: { amount: cappedAmount },
        })
      }
      totalDiscount += cappedAmount
    } else {
      // Fixed discount — unchanged
      totalDiscount += (Number(discount.amount) || 0)
    }
  }

  return totalDiscount
}

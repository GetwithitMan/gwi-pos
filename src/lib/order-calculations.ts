/**
 * Order Calculations - Single Source of Truth
 *
 * Centralized calculation logic for order totals, taxes, and commissions.
 * Used by both client (UI) and server (API routes) to ensure consistency.
 *
 * PRINCIPLES:
 * - All money rounding goes through roundToCents() from pricing.ts
 * - Rounding is the absolute last step (sum raw → surcharge → discount → tax → tip → THEN round)
 * - Tax lines are rounded to 2 decimals (compliance), final total optionally rounded per settings
 * - taxRate is always a decimal (0.08), never ambiguous 8 vs 0.08
 */

import { roundToCents, applyPriceRounding } from './pricing'
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
}

export interface LocationTaxSettings {
  tax?: {
    defaultRate?: number // Stored as percentage (e.g. 8 for 8%), converted to decimal internally
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
    return Number(item.itemTotal)
  }

  // Calculate from components
  const itemBaseTotal = item.price * item.quantity

  const modifiersTotal = (item.modifiers || []).reduce((sum, mod) => {
    return sum + (mod.price * (mod.quantity || 1))
  }, 0) * item.quantity

  const ingredientModTotal = (item.ingredientModifications || []).reduce((sum, ing) => {
    return sum + (ing.priceAdjustment || 0)
  }, 0) * item.quantity

  return itemBaseTotal + modifiersTotal + ingredientModTotal
}

/**
 * Calculate commission for a single item
 */
export function calculateItemCommission(
  itemTotal: number,
  quantity: number,
  commissionType: string | null,
  commissionValue: number | null
): number {
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }

  if (commissionType === 'percent') {
    return roundToCents(itemTotal * commissionValue / 100)
  } else if (commissionType === 'fixed') {
    return roundToCents(commissionValue * quantity)
  }

  return 0
}

// ============================================================================
// ORDER CALCULATIONS
// ============================================================================

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
      return sum + Number(item.commissionAmount)
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
  const taxRate = (locationSettings?.tax?.defaultRate || 8) / 100
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
  paymentMethod: 'cash' | 'card' = 'card'
): OrderTotals {
  const taxRate = (locationSettings?.tax?.defaultRate || 8) / 100
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

  // 2. Split tax — rounded to cents for compliance
  const { taxFromInclusive, taxFromExclusive, totalTax } = calculateSplitTax(
    inclusiveSubtotal, exclusiveSubtotal, taxRate
  )

  // 3. Total before rounding
  // Inclusive items already contain tax (no extra added), exclusive items get taxFromExclusive added
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

  return {
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
  if (settings.taxInclusiveLiquor && LIQUOR_CATEGORY_TYPES.includes(categoryType)) return true
  if (settings.taxInclusiveFood && FOOD_CATEGORY_TYPES.includes(categoryType)) return true
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
  taxRate: number
): { taxFromInclusive: number; taxFromExclusive: number; totalTax: number } {
  const taxFromInclusive = inclusiveSubtotal > 0
    ? roundToCents(inclusiveSubtotal - (inclusiveSubtotal / (1 + taxRate)))
    : 0
  const taxFromExclusive = roundToCents(exclusiveSubtotal * taxRate)

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
  const rate = settings?.tax?.defaultRate ?? 8
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
 * Simplified order totals (subtotal-only signature).
 * For full support (tax-inclusive, rounding), use calculateOrderTotals above.
 */
export function calculateSimpleOrderTotals(
  subtotal: number,
  discountTotal: number,
  locationSettings: { tax?: { defaultRate?: number } } | null | undefined
): {
  subtotal: number
  discountTotal: number
  taxTotal: number
  total: number
} {
  const taxRate = getLocationTaxRate(locationSettings)
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

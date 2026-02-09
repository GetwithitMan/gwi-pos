// Tax Calculations — Thin wrappers over order-calculations.ts
//
// DEPRECATED: New code should import directly from '@/lib/order-calculations'
// and '@/lib/pricing'. These wrappers exist for backward compatibility with
// existing API routes that use the simplified (subtotal-only) signature.
//
// NOTE: This simplified calculateOrderTotals does NOT handle tax-inclusive
// pricing or price rounding. Routes handling tax-inclusive items should
// migrate to the full calculateOrderTotals from order-calculations.ts.

import { roundToCents } from './pricing'

interface TaxSettings {
  tax?: {
    defaultRate?: number
    calculateAfterDiscount?: boolean
  }
}

/**
 * Get the location's default tax rate as a decimal (e.g., 0.08 for 8%).
 */
export function getLocationTaxRate(settings: TaxSettings | null | undefined): number {
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
 * @deprecated Use calculateOrderTotals from '@/lib/order-calculations' for full support.
 */
export function calculateOrderTotals(
  subtotal: number,
  discountTotal: number,
  locationSettings: TaxSettings | null | undefined
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

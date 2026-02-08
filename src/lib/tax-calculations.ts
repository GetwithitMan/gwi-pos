// Centralized tax calculation engine
// Single source of truth for all tax logic across the POS
//
// Location settings store defaultRate as a percentage number (e.g., 8.0 = 8%)
// MenuItem can override with taxRate (Decimal) or isTaxExempt (Boolean)

interface TaxSettings {
  tax?: {
    defaultRate?: number
    calculateAfterDiscount?: boolean
  }
}

/**
 * Get the location's default tax rate as a decimal (e.g., 0.08 for 8%).
 * Extracts from location settings JSON with consistent fallback.
 */
export function getLocationTaxRate(settings: TaxSettings | null | undefined): number {
  const rate = settings?.tax?.defaultRate ?? 8
  return rate / 100
}

/**
 * Get the effective tax rate for a specific item.
 * Priority: item-level override > location default.
 *
 * @param itemTaxRate - MenuItem.taxRate (percentage number, e.g. 10 for 10%), or null
 * @param itemTaxExempt - MenuItem.isTaxExempt
 * @param locationTaxRate - Already-converted decimal rate from getLocationTaxRate()
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
 * Applies consistent rounding (to nearest cent).
 */
export function calculateTax(subtotal: number, taxRate: number): number {
  return Math.round(subtotal * taxRate * 100) / 100
}

/**
 * Recalculate order totals from active items.
 * Used after comp/void, discount changes, item transfers, etc.
 *
 * @param subtotal - Sum of active item prices (already calculated by caller)
 * @param discountTotal - Total discounts applied
 * @param locationSettings - Location settings JSON (or parsed)
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
  const taxTotal = calculateTax(taxableAmount, taxRate)
  const total = Math.round((taxableAmount + taxTotal) * 100) / 100

  return {
    subtotal,
    discountTotal: effectiveDiscount,
    taxTotal,
    total,
  }
}

/**
 * Order Calculations - Single Source of Truth
 *
 * Centralized calculation logic for order totals, taxes, and commissions.
 * Used by both client (UI) and server (API routes) to ensure consistency.
 *
 * FIX-006: Eliminates duplicate calculation logic scattered across:
 * - FloorPlanHome.tsx
 * - orders/page.tsx
 * - /api/orders/[id]/items/route.ts
 * - /api/orders/[id]/route.ts
 */

// ============================================================================
// TYPES
// ============================================================================

export interface OrderItemForCalculation {
  price: number
  quantity: number
  modifiers?: Array<{
    price: number
    quantity?: number
  }>
  ingredientModifications?: Array<{
    priceAdjustment: number
  }>
  itemTotal?: number // For persisted items from DB
  commissionAmount?: number // For persisted items from DB
}

export interface LocationTaxSettings {
  tax?: {
    defaultRate?: number
  }
}

export interface OrderTotals {
  subtotal: number
  taxTotal: number
  discountTotal: number
  tipTotal: number
  total: number
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
 *
 * @param itemTotal - Total for the item (from calculateItemTotal)
 * @param quantity - Item quantity
 * @param commissionType - 'percent' or 'fixed'
 * @param commissionValue - Percentage (e.g., 5 for 5%) or fixed amount
 */
export function calculateItemCommission(
  itemTotal: number,
  quantity: number,
  commissionType: string | null,
  commissionValue: number | null
): number {
  // If item already has commission (from DB), use it
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }

  if (commissionType === 'percent') {
    return Math.round((itemTotal * commissionValue / 100) * 100) / 100
  } else if (commissionType === 'fixed') {
    return Math.round((commissionValue * quantity) * 100) / 100
  }

  return 0
}

// ============================================================================
// ORDER CALCULATIONS
// ============================================================================

/**
 * Calculate order subtotal from all items
 *
 * Use this for both inline items (client) and persisted items (server)
 */
export function calculateOrderSubtotal(items: OrderItemForCalculation[]): number {
  return items.reduce((sum, item) => sum + calculateItemTotal(item), 0)
}

/**
 * Calculate total commission from all items
 *
 * For persisted items, sums existing commissionAmount.
 * For new items, calculates commission based on menu item settings.
 */
export function calculateOrderCommission(
  items: Array<OrderItemForCalculation & { commissionAmount?: number }>
): number {
  return items.reduce((sum, item) => {
    // Use existing commission if available (from DB)
    if (item.commissionAmount !== undefined && item.commissionAmount !== null) {
      return sum + Number(item.commissionAmount)
    }
    return sum
  }, 0)
}

/**
 * Calculate tax based on subtotal and location settings
 *
 * @param subtotal - Order subtotal (before tax/discount/tip)
 * @param locationSettings - Location settings with tax rate
 * @returns Tax amount rounded to 2 decimals
 */
export function calculateOrderTax(
  subtotal: number,
  locationSettings: LocationTaxSettings | null
): number {
  const taxRate = (locationSettings?.tax?.defaultRate || 8) / 100
  return Math.round(subtotal * taxRate * 100) / 100
}

/**
 * Calculate final order total
 *
 * Formula: subtotal + tax - discount + tip
 */
export function calculateOrderTotal(
  subtotal: number,
  taxTotal: number,
  discountTotal: number,
  tipTotal: number
): number {
  return Math.round((subtotal + taxTotal - discountTotal + tipTotal) * 100) / 100
}

/**
 * Calculate all order totals at once (convenience function)
 *
 * @param items - Array of order items (inline or persisted)
 * @param locationSettings - Location settings (for tax rate)
 * @param existingDiscountTotal - Order-level discount (default 0)
 * @param existingTipTotal - Order-level tip (default 0)
 * @returns Complete order totals object
 */
export function calculateOrderTotals(
  items: Array<OrderItemForCalculation & { commissionAmount?: number }>,
  locationSettings: LocationTaxSettings | null,
  existingDiscountTotal: number = 0,
  existingTipTotal: number = 0
): OrderTotals {
  const subtotal = calculateOrderSubtotal(items)
  const taxTotal = calculateOrderTax(subtotal, locationSettings)
  const commissionTotal = calculateOrderCommission(items)
  const total = calculateOrderTotal(subtotal, taxTotal, existingDiscountTotal, existingTipTotal)

  return {
    subtotal,
    taxTotal,
    discountTotal: existingDiscountTotal,
    tipTotal: existingTipTotal,
    total,
    commissionTotal,
  }
}

// ============================================================================
// TIP CALCULATIONS
// ============================================================================

/**
 * Recalculate order total when tip changes
 *
 * Use this in PUT /api/orders/[id] when tipTotal is updated
 */
export function recalculateTotalWithTip(
  subtotal: number,
  taxTotal: number,
  discountTotal: number,
  newTipTotal: number
): number {
  return calculateOrderTotal(subtotal, taxTotal, discountTotal, newTipTotal)
}

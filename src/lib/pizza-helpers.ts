/**
 * Pizza Helpers - FIX-004: Pizza Configuration Consistency
 *
 * Standardizes pizza pricing across all order paths:
 * - Create order
 * - Append items
 * - Load/reload order
 *
 * PRICING MODEL (Option A - Base Price + Modifier Toppings):
 * - item.price = Base pizza price (size + crust + sauce + cheese ONLY)
 * - Toppings = Individual modifiers with individual prices
 * - pizzaConfig.totalPrice = Calculated (base + toppings), not stored separately
 * - Never double-count toppings
 */

import type { UiModifier } from '@/types/orders'
import type { PizzaOrderConfig } from '@/types'

// Extended InlineOrderItem with pizzaConfig for validation
interface PizzaOrderItem {
  id: string
  menuItemId: string
  name: string
  price: number
  quantity: number
  modifiers: UiModifier[]
  pizzaConfig?: PizzaOrderConfig
}

/**
 * Calculates pizza total from base price + topping modifiers.
 * Base price comes from size/crust/sauce/cheese combo.
 * Toppings are modifiers with individual prices.
 *
 * @param basePrice - Size + crust + sauce + cheese total
 * @param toppingModifiers - Array of topping modifiers with prices
 * @returns Total pizza price including all toppings
 */
export function calculatePizzaTotal(
  basePrice: number,
  toppingModifiers: UiModifier[]
): number {
  const toppingsTotal = toppingModifiers.reduce(
    (sum, mod) => sum + (mod.price * (mod.quantity || 1)),
    0
  )
  return Math.round((basePrice + toppingsTotal) * 100) / 100
}

/**
 * Extracts base price from pizza configuration.
 * Base = size + crust + sauce + cheese (NO toppings).
 *
 * @param pizzaConfig - Full pizza configuration
 * @returns Base price without toppings
 */
export function getPizzaBasePrice(pizzaConfig: PizzaOrderConfig): number {
  const { priceBreakdown } = pizzaConfig
  const base =
    priceBreakdown.sizePrice +
    priceBreakdown.crustPrice +
    priceBreakdown.saucePrice +
    priceBreakdown.cheesePrice

  return Math.round(base * 100) / 100
}

/**
 * Validates that pizza item follows pricing rules:
 * - item.price = base only (size + crust + sauce + cheese)
 * - toppings are separate modifiers
 * - no double counting
 *
 * @param item - Order item to validate
 * @returns Validation result with any issues found
 */
export function validatePizzaItem(item: PizzaOrderItem): {
  valid: boolean
  issues: string[]
} {
  const issues: string[] = []

  if (!item.pizzaConfig) {
    issues.push('Missing pizzaConfig')
    return { valid: false, issues }
  }

  // Base price should match size + crust + sauce + cheese
  const expectedBase = getPizzaBasePrice(item.pizzaConfig)
  const actualBase = item.price

  if (Math.abs(actualBase - expectedBase) > 0.01) {
    issues.push(
      `Base price mismatch: expected ${expectedBase.toFixed(2)}, got ${actualBase.toFixed(2)}`
    )
  }

  // Toppings should exist as modifiers
  const toppingCount = item.pizzaConfig.toppings.length
  const toppingModifiers = item.modifiers.filter(m => {
    // Topping modifiers should have IDs that match toppings in config
    // (In the actual implementation, we may need to track this via a special field)
    return item.pizzaConfig?.toppings.some(t => t.toppingId === m.modifierId)
  })

  if (toppingModifiers.length !== toppingCount) {
    issues.push(
      `Topping count mismatch: config has ${toppingCount}, modifiers have ${toppingModifiers.length}`
    )
  }

  // Verify total price calculation
  const calculatedTotal = calculatePizzaTotal(actualBase, item.modifiers)
  const storedTotal = item.pizzaConfig.totalPrice

  if (Math.abs(calculatedTotal - storedTotal) > 0.01) {
    issues.push(
      `Total price mismatch: calculated ${calculatedTotal.toFixed(2)}, stored ${storedTotal.toFixed(2)}`
    )
  }

  return {
    valid: issues.length === 0,
    issues
  }
}

/**
 * Checks if item.price includes toppings (incorrect - should be base only).
 * This helps identify double-counting issues.
 *
 * @param item - Order item to check
 * @returns True if price appears to include toppings
 */
export function hasPriceDoubleCountingIssue(item: PizzaOrderItem): boolean {
  if (!item.pizzaConfig) return false

  const basePrice = getPizzaBasePrice(item.pizzaConfig)
  const toppingsPrice = item.pizzaConfig.priceBreakdown.toppingsPrice

  // If item.price is significantly higher than base, it might include toppings
  const possibleDoubleCount = item.price > (basePrice + toppingsPrice / 2)

  return possibleDoubleCount
}

/**
 * Recalculates all pizza-related prices for an order item.
 * Used when loading orders to ensure pricing consistency.
 *
 * @param item - Order item with pizza config
 * @returns Updated item with corrected prices
 */
export function recalculatePizzaPrices(item: PizzaOrderItem): PizzaOrderItem {
  if (!item.pizzaConfig) return item

  const basePrice = getPizzaBasePrice(item.pizzaConfig)
  const totalPrice = calculatePizzaTotal(basePrice, item.modifiers)

  return {
    ...item,
    price: basePrice,  // Always set to base only
    pizzaConfig: {
      ...item.pizzaConfig,
      totalPrice,  // Recalculated total
    }
  }
}

/**
 * Logs pizza pricing validation results for debugging.
 * Use in development to track down pricing inconsistencies.
 *
 * @param item - Order item to debug
 * @param context - Where this validation is happening (e.g., "create", "append", "load")
 */
export function debugPizzaPricing(item: PizzaOrderItem, context: string): void {
  if (!item.pizzaConfig) return

  const validation = validatePizzaItem(item)
  const basePrice = getPizzaBasePrice(item.pizzaConfig)
  const toppingsPrice = item.pizzaConfig.priceBreakdown.toppingsPrice
  const calculatedTotal = calculatePizzaTotal(basePrice, item.modifiers)

  console.log(`[Pizza Pricing Debug - ${context}]`, {
    itemName: item.name,
    basePrice,
    toppingsPrice,
    calculatedTotal,
    storedTotal: item.pizzaConfig.totalPrice,
    itemPrice: item.price,
    validation,
    hasDoubleCountIssue: hasPriceDoubleCountingIssue(item),
  })
}

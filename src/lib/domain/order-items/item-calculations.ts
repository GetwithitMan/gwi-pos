/**
 * Order Item Calculations — PURE functions
 *
 * Price calculations, modifier prices, tax-inclusive flags, cost-at-sale
 * preparation data. No DB, no side effects.
 */

import { roundToCents, calculateCardPrice } from '@/lib/pricing'
import {
  calculateItemTotal,
  calculateItemCommission,
  isItemTaxInclusive,
  type TaxInclusiveSettings,
} from '@/lib/order-calculations'
import type {
  AddItemInput,
  MenuItemInfo,
  ItemPrepData,
} from './types'

// ─── Modifier ID Validation ─────────────────────────────────────────────────

/**
 * Check if a string is a valid CUID (for real modifier IDs).
 * CUIDs are typically 25 chars starting with 'c'. Combo IDs start with 'combo-'.
 */
export function isValidModifierId(modId: string): boolean {
  return !!modId && !modId.startsWith('combo-') && modId.length >= 20
}

// ─── Effective Price ────────────────────────────────────────────────────────

/**
 * Calculate the effective price for an item, accounting for weight-based pricing.
 * Weight-based items: unitPrice * weight. Standard items: item.price.
 */
export function calculateEffectivePrice(item: AddItemInput): number {
  if (item.soldByWeight && item.weight && item.unitPrice) {
    return roundToCents(item.unitPrice * item.weight)
  }
  return item.price
}

// ─── Item Prep Data ─────────────────────────────────────────────────────────

/**
 * Pre-compute all item data needed for creation (pure computation, no DB).
 * This consolidates the inline mapping done in the POST handler.
 */
export function prepareItemData(
  item: AddItemInput,
  menuItem: MenuItemInfo | undefined,
  taxIncSettings: TaxInclusiveSettings
): ItemPrepData {
  const effectivePrice = calculateEffectivePrice(item)

  const fullItemTotal = calculateItemTotal({
    ...item,
    price: effectivePrice,
  })

  const itemCommission = calculateItemCommission(
    fullItemTotal,
    item.quantity,
    menuItem?.commissionType || null,
    menuItem?.commissionValue ? Number(menuItem.commissionValue) : null
  )

  const catType = menuItem?.category?.categoryType ?? null
  const itemTaxInclusive = isItemTaxInclusive(catType ?? undefined, taxIncSettings)

  return { item, effectivePrice, fullItemTotal, itemCommission, menuItem, catType, itemTaxInclusive }
}

/**
 * Prepare data for an array of items. Returns prep data plus aggregate subtotal/commission.
 */
export function prepareAllItemsData(
  items: AddItemInput[],
  menuItemMap: Map<string, MenuItemInfo>,
  taxIncSettings: TaxInclusiveSettings
): {
  itemPrepData: ItemPrepData[]
  newItemsSubtotal: number
  newItemsCommission: number
} {
  const itemPrepData = items.map(item => {
    const menuItem = menuItemMap.get(item.menuItemId)
    return prepareItemData(item, menuItem, taxIncSettings)
  })

  let newItemsSubtotal = 0
  let newItemsCommission = 0
  for (const d of itemPrepData) {
    newItemsSubtotal += d.fullItemTotal
    newItemsCommission += d.itemCommission
  }

  return { itemPrepData, newItemsSubtotal, newItemsCommission }
}

// ─── Tax-Inclusive Settings Derivation ───────────────────────────────────────

/**
 * Derive tax-inclusive flags from cached tax rules and categories.
 * PURE — operates on pre-fetched data.
 */
export function deriveTaxInclusiveSettings(
  taxRules: Array<{ appliesTo: string | null; categoryIds?: unknown }>,
  allCategories: Array<{ id: string; categoryType: string | null }>
): TaxInclusiveSettings {
  let taxInclusiveLiquor = false
  let taxInclusiveFood = false

  for (const rule of taxRules) {
    if (rule.appliesTo === 'all') {
      taxInclusiveLiquor = true
      taxInclusiveFood = true
      break
    }
    if (rule.appliesTo === 'category' && rule.categoryIds) {
      for (const cat of allCategories) {
        if ((rule.categoryIds as string[]).includes(cat.id)) {
          if (cat.categoryType && ['liquor', 'drinks'].includes(cat.categoryType)) taxInclusiveLiquor = true
          if (cat.categoryType && ['food', 'pizza', 'combos'].includes(cat.categoryType)) taxInclusiveFood = true
        }
      }
    }
  }

  return { taxInclusiveLiquor, taxInclusiveFood }
}

// ─── Card Price ─────────────────────────────────────────────────────────────

/**
 * Calculate the card price for an item when dual pricing is enabled.
 * Returns null if dual pricing is disabled.
 */
export function calculateItemCardPrice(
  effectivePrice: number,
  dualPricingEnabled: boolean,
  cashDiscountPct: number
): number | null {
  if (!dualPricingEnabled) return null
  return calculateCardPrice(effectivePrice, cashDiscountPct)
}

// ─── Open Item Detection ────────────────────────────────────────────────────

/**
 * Detect if any items have custom (non-catalog) prices, which requires
 * manager.open_items permission. Excludes weight-based and timed-rental
 * items whose prices are inherently dynamic.
 *
 * Pizza items are checked separately: a $0 total on a non-free menu item
 * is flagged as a price-tampering signal requiring manager approval.
 *
 * Returns true if any item has an unexpected price deviation.
 */
export function hasOpenPricedItems(
  items: AddItemInput[],
  menuItemPrices: Map<string, number>,
  pricingOptionPrices: Map<string, number>
): boolean {
  // Standard items (non-pizza, non-weight, non-timed): check price vs catalog
  const pricableItems = items.filter(i => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)

  for (const item of pricableItems) {
    const menuItemPrice = menuItemPrices.get(item.menuItemId)
    if (menuItemPrice === undefined) continue

    let expectedPrice = menuItemPrice
    if (item.pricingOptionId) {
      const optPrice = pricingOptionPrices.get(item.pricingOptionId)
      if (optPrice != null) expectedPrice = optPrice
    }
    if (item.pourMultiplier && item.pourMultiplier !== 1) {
      expectedPrice = Math.round(expectedPrice * item.pourMultiplier * 100) / 100
    }

    if (Math.abs(Math.round(item.price * 100) - Math.round(expectedPrice * 100)) > 1) {
      return true
    }
  }

  // Pizza items: flag $0 pizza when the catalog menu item has a non-zero base price.
  // Pizza prices are computed by the pizza builder, but a $0 total on a non-free
  // menu item is a price-tampering signal that requires manager approval.
  const pizzaItems = items.filter(i => !!i.pizzaConfig)
  for (const item of pizzaItems) {
    const menuItemPrice = menuItemPrices.get(item.menuItemId)
    if (menuItemPrice === undefined) continue
    if (menuItemPrice > 0 && Number(item.pizzaConfig!.totalPrice) <= 0) {
      return true
    }
  }

  return false
}

// ─── Modifier Pricing Data ──────────────────────────────────────────────────

/** Extended pricing data for server-side pre-modifier price computation. */
export interface ModifierPricingData {
  price: number
  extraPrice: number
  liteMultiplier: number | null   // null → default 0.5
  extraMultiplier: number | null  // null → default 2.0
}

// ─── Modifier Price Override ────────────────────────────────────────────────

/**
 * Parse a compound preModifier string into tokens (server-side mirror of client helper).
 */
function parsePreModTokens(preModifier: string | null | undefined): string[] {
  if (!preModifier) return []
  return preModifier.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Compute the server-authoritative price for a modifier given its pre-modifier.
 * Mirrors the client-side computePrice logic in useModifierSelections.ts.
 */
function computeServerModifierPrice(data: ModifierPricingData, preModifier: string | null | undefined): number {
  const tokens = parsePreModTokens(preModifier)
  const p = data.price

  if (tokens.includes('no')) return 0
  if (tokens.includes('lite')) {
    const mult = data.liteMultiplier ?? 0.5
    return Math.round(p * mult * 100) / 100
  }
  if (tokens.includes('extra')) {
    if (data.extraPrice > 0) return data.extraPrice
    const mult = data.extraMultiplier ?? 2.0
    return Math.round(p * mult * 100) / 100
  }
  return p
}

/**
 * Override client-supplied modifier prices with server-authoritative prices.
 * Pizza items are excluded — their modifiers have computed prices from the
 * pizza builder (coverage-based topping pricing, free topping quotas, etc.).
 *
 * Pre-modifier adjustments (no → $0, lite → reduced, extra → extraPrice) are
 * computed server-side from DB data to prevent price tampering while preserving
 * correct pre-modifier pricing.
 *
 * Mutates items in place for efficiency (matches prior behavior).
 */
export function overrideModifierPrices(
  items: AddItemInput[],
  modifierPriceMap: Map<string, ModifierPricingData>
): void {
  const nonPizzaItems = items.filter(item => !item.pizzaConfig)
  for (const item of nonPizzaItems) {
    for (const mod of item.modifiers || []) {
      if (mod.modifierId && isValidModifierId(mod.modifierId) && modifierPriceMap.has(mod.modifierId)) {
        const data = modifierPriceMap.get(mod.modifierId)!
        mod.price = computeServerModifierPrice(data, mod.preModifier)
      }
    }
  }
}

// ─── Live Modifier Total ────────────────────────────────────────────────────

/**
 * Calculate the live modifier total from active modifiers (for quantity updates).
 * Prevents penny drift from stale item.modifierTotal.
 */
export function calculateLiveModifierTotal(
  activeModifiers: Array<{ price: unknown; quantity?: number | null }>
): number {
  return activeModifiers.reduce(
    (sum, m) => sum + Number(m.price) * (m.quantity ?? 1), 0
  )
}

/**
 * Calculate updated item total when quantity changes.
 */
export function calculateUpdatedItemTotal(
  itemPrice: number,
  liveModifierTotal: number,
  newQuantity: number
): number {
  return (itemPrice + liveModifierTotal) * newQuantity
}

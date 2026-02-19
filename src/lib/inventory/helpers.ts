/**
 * Shared helper functions for inventory calculations
 */

import { Decimal } from '@prisma/client/runtime/library'
import type { MultiplierSettings, InventoryItemData, PrepItemWithIngredients } from './types'
import { convertUnits, normalizeUnit } from './unit-conversion'

/**
 * Get the effective cost per unit, preferring yield cost if available
 */
export function getEffectiveCost(item: {
  costPerUnit: Decimal | number
  yieldCostPerUnit?: Decimal | number | null
}): number {
  if (item.yieldCostPerUnit !== null && item.yieldCostPerUnit !== undefined) {
    return Number(item.yieldCostPerUnit)
  }
  return Number(item.costPerUnit)
}

/**
 * Safely convert Decimal or number to number
 */
export function toNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

// ============================================
// Modifier Instruction Multipliers
// ============================================

/**
 * Default multiplier values (industry standard)
 * - NO: 0 (deduct nothing)
 * - LITE: 0.5 (50% of standard amount)
 * - EXTRA: 2.0 (double the standard amount)
 * - TRIPLE: 3.0 (triple the standard amount)
 */
export const DEFAULT_MULTIPLIERS: Required<MultiplierSettings> = {
  multiplierLite: 0.5,
  multiplierExtra: 2.0,
  multiplierTriple: 3.0,
}

/**
 * Gets the multiplier for a modifier instruction (preModifier)
 *
 * @param instruction - The preModifier value ("no", "lite", "extra", etc.)
 * @param settings - Optional location-specific multiplier settings
 * @returns The multiplier to apply to usage quantity
 *
 * Examples:
 * - "no" returns 0 (don't deduct anything)
 * - "lite" returns 0.5 (deduct half)
 * - "extra" returns 2.0 (deduct double)
 * - null/undefined returns 1.0 (standard amount)
 */
export function getModifierMultiplier(
  instruction: string | null | undefined,
  settings?: MultiplierSettings
): number {
  const normalized = instruction?.toUpperCase().trim() || 'NORMAL'

  // Handle zero/removal instructions
  if (['NO', 'NONE', 'REMOVE', 'WITHOUT', 'HOLD'].includes(normalized)) {
    return 0
  }

  // Handle multiplier instructions (use settings if available, else defaults)
  switch (normalized) {
    case 'LITE':
    case 'LIGHT':
    case 'EASY':
    case 'HALF':
      return toNumber(settings?.multiplierLite) || Number(DEFAULT_MULTIPLIERS.multiplierLite)

    case 'EXTRA':
    case 'DOUBLE':
    case 'HEAVY':
      return toNumber(settings?.multiplierExtra) || Number(DEFAULT_MULTIPLIERS.multiplierExtra)

    case 'TRIPLE':
    case '3X':
      return toNumber(settings?.multiplierTriple) || Number(DEFAULT_MULTIPLIERS.multiplierTriple)

    case 'ADD':
    case 'NORMAL':
    case 'REGULAR':
    case 'SIDE':
    default:
      return 1.0
  }
}

/**
 * Check if a modifier instruction indicates removal (NO, NONE, etc.)
 */
export function isRemovalInstruction(instruction: string | null | undefined): boolean {
  const normalized = instruction?.toUpperCase().trim() || ''
  return ['NO', 'NONE', 'REMOVE', 'WITHOUT', 'HOLD'].includes(normalized)
}

// ============================================
// Recursive Prep Item Explosion
// ============================================

const MAX_RECURSION_DEPTH = 10 // Prevent infinite loops

export interface ExplodedIngredient {
  inventoryItem: InventoryItemData
  quantity: number
}

/**
 * Recursively explode a prep item into its raw inventory items
 * Handles nested prep items (e.g., BBQ Pizza -> BBQ Sauce -> BBQ Spice Mix -> Paprika)
 */
export function explodePrepItem(
  prepItem: PrepItemWithIngredients,
  quantityNeeded: number,
  usageUnit: string,
  depth: number = 0
): ExplodedIngredient[] {
  // Guard against infinite recursion
  if (depth >= MAX_RECURSION_DEPTH) {
    console.warn(`Max recursion depth reached for prep item: ${prepItem.name}`)
    return []
  }

  const results: ExplodedIngredient[] = []
  const batchYield = toNumber(prepItem.batchYield) || 1
  const outputUnit = prepItem.outputUnit || usageUnit

  // Calculate how many "batches" of prep item we need
  // First, try to convert units if they differ
  let scaledQuantity = quantityNeeded
  if (outputUnit && usageUnit && normalizeUnit(outputUnit) !== normalizeUnit(usageUnit)) {
    const converted = convertUnits(quantityNeeded, usageUnit, outputUnit)
    if (converted !== null) {
      scaledQuantity = converted
    }
    // If conversion fails, we use the raw quantity (assume same scale)
  }

  // Scale factor: how much of each ingredient per unit of prep item output
  const scaleFactor = scaledQuantity / batchYield

  for (const ing of prepItem.ingredients) {
    const ingQty = toNumber(ing.quantity) * scaleFactor

    if (ing.inventoryItem) {
      // Terminal case: raw inventory item
      results.push({
        inventoryItem: ing.inventoryItem,
        quantity: ingQty,
      })
    } else if (ing.prepItem) {
      // Recursive case: nested prep item
      const nestedResults = explodePrepItem(
        ing.prepItem,
        ingQty,
        ing.unit,
        depth + 1
      )
      results.push(...nestedResults)
    }
  }

  return results
}

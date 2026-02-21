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
 * Gets the multiplier for a single (non-compound) modifier instruction token.
 * Internal helper — do not call directly; use getModifierMultiplier instead.
 */
function getSingleTokenMultiplier(token: string, settings?: MultiplierSettings): number {
  const normalized = token.toUpperCase().trim()

  // Handle zero/removal instructions
  if (['NO', 'NONE', 'REMOVE', 'WITHOUT', 'HOLD'].includes(normalized)) {
    return 0
  }

  // Handle multiplier instructions (use settings if available, else defaults)
  // Note: Use explicit null/undefined checks — `||` would treat a location's
  // explicit 0 value as falsy and incorrectly fall back to the default.
  switch (normalized) {
    case 'LITE':
    case 'LIGHT':
    case 'EASY':
    case 'HALF': {
      const lite = settings?.multiplierLite
      return (lite !== null && lite !== undefined && !isNaN(Number(lite)))
        ? Number(lite)
        : Number(DEFAULT_MULTIPLIERS.multiplierLite)
    }

    case 'EXTRA':
    case 'DOUBLE':
    case 'HEAVY': {
      const extra = settings?.multiplierExtra
      return (extra !== null && extra !== undefined && !isNaN(Number(extra)))
        ? Number(extra)
        : Number(DEFAULT_MULTIPLIERS.multiplierExtra)
    }

    case 'TRIPLE':
    case '3X': {
      const triple = settings?.multiplierTriple
      return (triple !== null && triple !== undefined && !isNaN(Number(triple)))
        ? Number(triple)
        : Number(DEFAULT_MULTIPLIERS.multiplierTriple)
    }

    case 'ADD':
    case 'NORMAL':
    case 'REGULAR':
    case 'SIDE':
    default:
      return 1.0
  }
}

/**
 * Gets the multiplier for a modifier instruction (preModifier).
 *
 * T-042: Supports compound strings (e.g. "side,extra" → tokens ["side", "extra"]).
 * When multiple tokens are present the highest-priority token wins:
 *   1. Any removal token (NO, etc.) → 0
 *   2. Highest non-1.0 multiplier wins (EXTRA > TRIPLE > LITE)
 *   3. Otherwise 1.0 (SIDE, NORMAL, etc.)
 *
 * @param instruction - The preModifier value, possibly compound e.g. "side,extra"
 * @param settings - Optional location-specific multiplier settings
 * @returns The multiplier to apply to usage quantity
 *
 * Examples:
 * - "no"         → 0   (don't deduct anything)
 * - "lite"       → 0.5 (deduct half)
 * - "extra"      → 2.0 (deduct double)
 * - "side,extra" → 2.0 (extra dominates)
 * - "side"       → 1.0 (on the side — same quantity)
 * - null/undefined → 1.0 (standard amount)
 */
export function getModifierMultiplier(
  instruction: string | null | undefined,
  settings?: MultiplierSettings
): number {
  if (!instruction) return 1.0

  // T-042: parse compound string (backward-compatible — single tokens still work)
  const tokens = instruction.split(',').map(t => t.trim()).filter(Boolean)
  if (tokens.length === 0) return 1.0

  // Evaluate each token and pick the highest-priority result
  const multipliers = tokens.map(t => getSingleTokenMultiplier(t, settings))

  // If any token is a removal instruction (0), that takes precedence
  if (multipliers.includes(0)) return 0

  // Otherwise return the maximum multiplier across all tokens
  return Math.max(...multipliers)
}

/**
 * Check if a modifier instruction indicates removal (NO, NONE, etc.).
 * T-042: Supports compound strings — returns true if ANY token is a removal instruction.
 */
export function isRemovalInstruction(instruction: string | null | undefined): boolean {
  if (!instruction) return false
  const tokens = instruction.split(',').map(t => t.trim()).filter(Boolean)
  const removalTokens = new Set(['NO', 'NONE', 'REMOVE', 'WITHOUT', 'HOLD'])
  return tokens.some(t => removalTokens.has(t.toUpperCase().trim()))
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

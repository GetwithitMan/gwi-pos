/**
 * Inventory Calculations Utility
 * Shared logic for theoretical usage, variance, and costing calculations
 */

import { db } from '@/lib/db'
import { Decimal } from '@prisma/client/runtime/library'

// ============================================
// Types
// ============================================

export interface InventoryItemData {
  id: string
  name: string
  category: string
  department: string
  storageUnit: string
  costPerUnit: Decimal | number
  yieldCostPerUnit?: Decimal | number | null
}

export interface TheoreticalUsageItem {
  inventoryItemId: string
  name: string
  category: string
  department: string
  theoreticalUsage: number
  unit: string
  costPerUnit: number
  totalCost: number
}

export interface TheoreticalUsageResult {
  locationId: string
  startDate: string
  endDate: string
  department: string
  orderCount: number
  usage: TheoreticalUsageItem[]
  totalCost: number
}

export interface CalculateTheoreticalUsageParams {
  locationId: string
  startDate: Date
  endDate: Date
  department?: string | null
  multiplierSettings?: MultiplierSettings | null
}

// Recursive ingredient types for deep prep item nesting
export interface PrepItemIngredient {
  quantity: Decimal | number
  unit: string
  inventoryItem?: InventoryItemData | null
  prepItem?: PrepItemWithIngredients | null
}

export interface PrepItemWithIngredients {
  id: string
  name: string
  batchYield?: Decimal | number | null
  outputUnit?: string | null
  costPerUnit?: Decimal | number | null
  ingredients: PrepItemIngredient[]
}

export interface RecipeIngredient {
  quantity: Decimal | number
  unit: string
  inventoryItem?: InventoryItemData | null
  prepItem?: PrepItemWithIngredients | null
}

// ============================================
// Unit Conversion System
// ============================================

type UnitCategory = 'weight' | 'volume' | 'count'

interface UnitDefinition {
  category: UnitCategory
  baseUnit: string
  toBase: number // Multiplier to convert to base unit
}

// Unit definitions - all conversions go through a base unit per category
// Weight: base = grams (g)
// Volume: base = milliliters (ml)
// Count: base = each (ea)
const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  // Weight units (base: grams)
  'g': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'gram': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'grams': { category: 'weight', baseUnit: 'g', toBase: 1 },
  'kg': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'kilogram': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'kilograms': { category: 'weight', baseUnit: 'g', toBase: 1000 },
  'oz': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'ounce': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'ounces': { category: 'weight', baseUnit: 'g', toBase: 28.3495 },
  'lb': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'lbs': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'pound': { category: 'weight', baseUnit: 'g', toBase: 453.592 },
  'pounds': { category: 'weight', baseUnit: 'g', toBase: 453.592 },

  // Volume units (base: milliliters)
  'ml': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'milliliter': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'milliliters': { category: 'volume', baseUnit: 'ml', toBase: 1 },
  'l': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'liter': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'liters': { category: 'volume', baseUnit: 'ml', toBase: 1000 },
  'fl oz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'floz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'fluid oz': { category: 'volume', baseUnit: 'ml', toBase: 29.5735 },
  'cup': { category: 'volume', baseUnit: 'ml', toBase: 236.588 },
  'cups': { category: 'volume', baseUnit: 'ml', toBase: 236.588 },
  'pt': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'pint': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'pints': { category: 'volume', baseUnit: 'ml', toBase: 473.176 },
  'qt': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'quart': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'quarts': { category: 'volume', baseUnit: 'ml', toBase: 946.353 },
  'gal': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'gallon': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'gallons': { category: 'volume', baseUnit: 'ml', toBase: 3785.41 },
  'tsp': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'teaspoon': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'teaspoons': { category: 'volume', baseUnit: 'ml', toBase: 4.92892 },
  'tbsp': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },
  'tablespoon': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },
  'tablespoons': { category: 'volume', baseUnit: 'ml', toBase: 14.7868 },

  // Count units (base: each)
  'ea': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'each': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pc': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pcs': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'piece': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'pieces': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'slice': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'slices': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'portion': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'portions': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'serving': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'servings': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'case': { category: 'count', baseUnit: 'ea', toBase: 1 }, // Case requires item-specific conversion
  'cases': { category: 'count', baseUnit: 'ea', toBase: 1 },
  'dozen': { category: 'count', baseUnit: 'ea', toBase: 12 },
  'doz': { category: 'count', baseUnit: 'ea', toBase: 12 },
}

/**
 * Normalize unit string for lookup
 */
function normalizeUnit(unit: string): string {
  return unit.toLowerCase().trim()
}

/**
 * Get unit definition, returns null if unknown
 */
function getUnitDefinition(unit: string): UnitDefinition | null {
  return UNIT_DEFINITIONS[normalizeUnit(unit)] || null
}

/**
 * Convert quantity from one unit to another
 * Returns null if conversion is not possible (different categories or unknown units)
 */
export function convertUnits(
  quantity: number,
  fromUnit: string,
  toUnit: string
): number | null {
  const fromDef = getUnitDefinition(fromUnit)
  const toDef = getUnitDefinition(toUnit)

  // If either unit is unknown, return null
  if (!fromDef || !toDef) {
    return null
  }

  // If units are in different categories, conversion is not possible
  if (fromDef.category !== toDef.category) {
    return null
  }

  // Same unit, no conversion needed
  if (normalizeUnit(fromUnit) === normalizeUnit(toUnit)) {
    return quantity
  }

  // Convert: source -> base -> target
  const inBase = quantity * fromDef.toBase
  const result = inBase / toDef.toBase

  return result
}

/**
 * Check if two units are compatible (same category)
 */
export function areUnitsCompatible(unit1: string, unit2: string): boolean {
  const def1 = getUnitDefinition(unit1)
  const def2 = getUnitDefinition(unit2)

  if (!def1 || !def2) return false
  return def1.category === def2.category
}

/**
 * Get the category of a unit
 */
export function getUnitCategory(unit: string): UnitCategory | null {
  const def = getUnitDefinition(unit)
  return def?.category || null
}

// ============================================
// Helper Functions
// ============================================

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
 * Settings for modifier instruction multipliers
 * These can be configured per-location in InventorySettings
 */
export interface MultiplierSettings {
  multiplierLite?: number | Decimal
  multiplierExtra?: number | Decimal
  multiplierTriple?: number | Decimal
}

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

interface ExplodedIngredient {
  inventoryItem: InventoryItemData
  quantity: number
}

/**
 * Recursively explode a prep item into its raw inventory items
 * Handles nested prep items (e.g., BBQ Pizza -> BBQ Sauce -> BBQ Spice Mix -> Paprika)
 */
function explodePrepItem(
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

// ============================================
// Theoretical Usage Calculation
// ============================================

/**
 * Calculate theoretical inventory usage based on sales
 * This is the core calculation shared by multiple reports
 */
export async function calculateTheoreticalUsage(
  params: CalculateTheoreticalUsageParams
): Promise<TheoreticalUsageResult> {
  const { locationId, startDate, endDate, department, multiplierSettings } = params

  // Get all completed orders in the date range
  // Note: PrepItemIngredient only links to InventoryItem (no nested prep items in schema)
  const orders = await db.order.findMany({
    where: {
      locationId,
      status: { in: ['completed', 'paid'] },
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      items: {
        where: { deletedAt: null },
        include: {
          menuItem: {
            include: {
              recipe: {
                include: {
                  ingredients: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                      prepItem: {
                        include: {
                          ingredients: {
                            include: {
                              inventoryItem: {
                                select: {
                                  id: true,
                                  name: true,
                                  category: true,
                                  department: true,
                                  storageUnit: true,
                                  costPerUnit: true,
                                  yieldCostPerUnit: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              // Liquor recipes from Liquor Builder (RecipeIngredient -> BottleProduct -> InventoryItem)
              recipeIngredients: {
                where: { deletedAt: null },
                include: {
                  bottleProduct: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          modifiers: {
            include: {
              modifier: {
                include: {
                  inventoryLink: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                  // Fallback: Modifier.ingredientId → Ingredient → InventoryItem
                  ingredient: {
                    select: {
                      id: true,
                      inventoryItemId: true,
                      standardQuantity: true,
                      standardUnit: true,
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  // Aggregate theoretical usage
  const usageMap = new Map<string, TheoreticalUsageItem>()

  function addUsage(item: InventoryItemData, quantity: number): void {
    // Filter by department if specified (case-insensitive)
    if (department && item.department.toLowerCase() !== department.toLowerCase()) {
      return
    }

    const existing = usageMap.get(item.id)
    const cost = getEffectiveCost(item)

    if (existing) {
      existing.theoreticalUsage += quantity
      existing.totalCost += quantity * cost
    } else {
      usageMap.set(item.id, {
        inventoryItemId: item.id,
        name: item.name,
        category: item.category,
        department: item.department,
        theoreticalUsage: quantity,
        unit: item.storageUnit,
        costPerUnit: cost,
        totalCost: quantity * cost,
      })
    }
  }

  // Process each order item
  for (const order of orders) {
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      // Build a set of inventory item IDs that have "NO" modifiers on this order item
      // This allows us to skip base recipe ingredients that were explicitly removed
      const removedIngredientIds = new Set<string>()
      for (const mod of orderItem.modifiers) {
        if (isRemovalInstruction(mod.preModifier)) {
          // Check inventoryLink path (primary)
          if (mod.modifier?.inventoryLink?.inventoryItemId) {
            removedIngredientIds.add(mod.modifier.inventoryLink.inventoryItemId)
          }
          // Check ingredient path (fallback)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else if ((mod.modifier as any)?.ingredient?.inventoryItem?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            removedIngredientIds.add((mod.modifier as any).ingredient.inventoryItem.id)
          }
        }
      }

      // Process recipe ingredients (MenuItemRecipe system)
      if (orderItem.menuItem?.recipe) {
        for (const ing of orderItem.menuItem.recipe.ingredients) {
          // Skip ingredients that were explicitly removed with "NO" modifier
          if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
            continue
          }

          const ingQty = toNumber(ing.quantity) * itemQty

          if (ing.inventoryItem) {
            // Direct inventory item
            addUsage(ing.inventoryItem as InventoryItemData, ingQty)
          } else if (ing.prepItem) {
            // Recursively explode prep item to raw ingredients
            const exploded = explodePrepItem(
              ing.prepItem as PrepItemWithIngredients,
              ingQty,
              ing.unit
            )
            for (const exp of exploded) {
              // Also skip exploded ingredients that were explicitly removed
              if (!removedIngredientIds.has(exp.inventoryItem.id)) {
                addUsage(exp.inventoryItem, exp.quantity)
              }
            }
          }
        }
      }

      // Process liquor recipe ingredients (RecipeIngredient -> BottleProduct -> InventoryItem)
      // This handles cocktails created via the Liquor Builder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
      if (recipeIngredients && Array.isArray(recipeIngredients)) {
        for (const ing of recipeIngredients) {
          // Get the linked inventory item from the bottle product
          const inventoryItem = ing.bottleProduct?.inventoryItem
          if (!inventoryItem) continue

          // Skip if this inventory item was explicitly removed with "NO" modifier
          if (removedIngredientIds.has(inventoryItem.id)) {
            continue
          }

          // Calculate pour quantity in oz
          // pourCount * itemQty * (pourSizeOz or location default 1.5oz)
          const pourCount = toNumber(ing.pourCount) || 1
          const pourSizeOz = toNumber(ing.pourSizeOz) || toNumber(ing.bottleProduct?.pourSizeOz) || 1.5
          const totalOz = pourCount * pourSizeOz * itemQty

          // Add usage - inventory is tracked in oz for liquor items
          addUsage(inventoryItem as InventoryItemData, totalOz)
        }
      }

      // Process modifier ingredients with instruction multipliers
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty

        // Get the multiplier based on the instruction (preModifier: "lite", "extra", etc.)
        const preModifier = mod.preModifier
        const multiplier = getModifierMultiplier(preModifier, multiplierSettings || undefined)

        // If multiplier is 0 (e.g., "NO"), skip this modifier entirely
        if (multiplier === 0) continue

        // Path A: ModifierInventoryLink (takes precedence)
        if (mod.modifier?.inventoryLink?.inventoryItem) {
          const link = mod.modifier.inventoryLink
          const linkItem = link.inventoryItem as InventoryItemData

          let linkQty = toNumber(link.usageQuantity) * modQty * multiplier

          if (link.usageUnit && linkItem.storageUnit) {
            const converted = convertUnits(linkQty, link.usageUnit, linkItem.storageUnit)
            if (converted !== null) {
              linkQty = converted
            }
          }

          addUsage(linkItem, linkQty)
          continue  // inventoryLink found — skip fallback
        }

        // Path B: Modifier.ingredientId → Ingredient → InventoryItem (fallback)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ingredient = (mod.modifier as any)?.ingredient
        if (ingredient?.inventoryItem) {
          const stdQty = toNumber(ingredient.standardQuantity) || 1
          let ingQty = stdQty * modQty * multiplier

          if (ingredient.standardUnit && ingredient.inventoryItem.storageUnit) {
            const converted = convertUnits(ingQty, ingredient.standardUnit, ingredient.inventoryItem.storageUnit)
            if (converted !== null) {
              ingQty = converted
            }
          }

          addUsage(ingredient.inventoryItem as InventoryItemData, ingQty)
        }
      }
    }
  }

  // Sort by category and name
  const usage = Array.from(usageMap.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.name.localeCompare(b.name)
  })

  // Calculate totals
  const totalCost = usage.reduce((sum, item) => sum + item.totalCost, 0)

  return {
    locationId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    department: department || 'All',
    orderCount: orders.length,
    usage,
    totalCost,
  }
}

// ============================================
// Recipe Costing Calculation
// ============================================

export interface RecipeCostingResult {
  totalCost: number
  sellPrice: number
  foodCostPercent: number
  grossProfit: number
  grossMargin: number
}

/**
 * Calculate recipe costing metrics
 */
export function calculateRecipeCosting(
  totalCost: number,
  sellPrice: number
): RecipeCostingResult {
  const foodCostPercent = sellPrice > 0 ? (totalCost / sellPrice) * 100 : 0
  const grossProfit = sellPrice - totalCost
  const grossMargin = sellPrice > 0 ? (grossProfit / sellPrice) * 100 : 0

  return {
    totalCost,
    sellPrice,
    foodCostPercent,
    grossProfit,
    grossMargin,
  }
}

// ============================================
// Ingredient Cost Calculation
// ============================================

export interface IngredientWithCost {
  id: string
  quantity: number
  unit: string
  unitCost: number
  lineCost: number
  inventoryItem?: {
    id: string
    name: string
    storageUnit: string
    costPerUnit: number
    yieldCostPerUnit?: number | null
  } | null
  prepItem?: {
    id: string
    name: string
    outputUnit?: string | null
    costPerUnit?: number | null
  } | null
}

interface IngredientInput {
  quantity: Decimal | number
  unit: string
  inventoryItem?: {
    storageUnit?: string
    costPerUnit: Decimal | number
    yieldCostPerUnit?: Decimal | number | null
  } | null
  prepItem?: {
    costPerUnit?: Decimal | number | null
  } | null
}

type ProcessedIngredient<T> = Omit<T, 'quantity'> & {
  quantity: number
  unitCost: number
  lineCost: number
  conversionApplied?: boolean
}

/**
 * Calculate costs for recipe ingredients with unit conversion support
 */
export function calculateIngredientCosts<T extends IngredientInput>(
  ingredients: T[]
): { ingredients: ProcessedIngredient<T>[], totalCost: number } {
  let totalCost = 0

  const processedIngredients = ingredients.map((ing): ProcessedIngredient<T> => {
    let qty = toNumber(ing.quantity)
    let unitCost = 0
    let conversionApplied = false

    if (ing.inventoryItem) {
      unitCost = getEffectiveCost(ing.inventoryItem)

      // Try to apply unit conversion if units differ
      if (ing.inventoryItem.storageUnit && ing.unit) {
        const storageUnit = ing.inventoryItem.storageUnit
        if (normalizeUnit(ing.unit) !== normalizeUnit(storageUnit)) {
          const converted = convertUnits(qty, ing.unit, storageUnit)
          if (converted !== null) {
            qty = converted
            conversionApplied = true
          }
        }
      }
    } else if (ing.prepItem?.costPerUnit) {
      unitCost = toNumber(ing.prepItem.costPerUnit)
    }

    const lineCost = qty * unitCost
    totalCost += lineCost

    // Build result without the original quantity, then add processed values
    const { quantity: _originalQty, ...rest } = ing
    return {
      ...rest,
      quantity: qty,
      unitCost,
      lineCost,
      conversionApplied,
    } as ProcessedIngredient<T>
  })

  return { ingredients: processedIngredients, totalCost }
}

// ============================================
// Utility Exports for Unit Conversion
// ============================================

export const unitConversion = {
  convert: convertUnits,
  areCompatible: areUnitsCompatible,
  getCategory: getUnitCategory,
  normalize: normalizeUnit,
}

// ============================================
// Auto-Deduction on Order Paid
// ============================================

/**
 * Result type for inventory deduction operations
 */
export interface InventoryDeductionResult {
  success: boolean
  itemsDeducted: number
  totalCost: number
  errors?: string[]
}

/**
 * The include tree for fetching order data (shared between report and deduction)
 */
const ORDER_INVENTORY_INCLUDE = {
  items: {
    where: { deletedAt: null },
    include: {
      menuItem: {
        include: {
          recipe: {
            include: {
              ingredients: {
                include: {
                  inventoryItem: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      department: true,
                      storageUnit: true,
                      costPerUnit: true,
                      yieldCostPerUnit: true,
                      currentStock: true,
                    },
                  },
                  prepItem: {
                    include: {
                      ingredients: {
                        include: {
                          inventoryItem: {
                            select: {
                              id: true,
                              name: true,
                              category: true,
                              department: true,
                              storageUnit: true,
                              costPerUnit: true,
                              yieldCostPerUnit: true,
                              currentStock: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          // Liquor recipes from Liquor Builder (RecipeIngredient -> BottleProduct -> InventoryItem)
          recipeIngredients: {
            where: { deletedAt: null },
            include: {
              bottleProduct: {
                include: {
                  inventoryItem: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      department: true,
                      storageUnit: true,
                      costPerUnit: true,
                      yieldCostPerUnit: true,
                      currentStock: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      modifiers: {
        include: {
          modifier: {
            include: {
              inventoryLink: {
                include: {
                  inventoryItem: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      department: true,
                      storageUnit: true,
                      costPerUnit: true,
                      yieldCostPerUnit: true,
                      currentStock: true,
                    },
                  },
                },
              },
              // Fallback: Modifier.ingredientId → Ingredient → InventoryItem
              ingredient: {
                select: {
                  id: true,
                  inventoryItemId: true,
                  standardQuantity: true,
                  standardUnit: true,
                  inventoryItem: {
                    select: {
                      id: true,
                      name: true,
                      category: true,
                      department: true,
                      storageUnit: true,
                      costPerUnit: true,
                      yieldCostPerUnit: true,
                      currentStock: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const

/**
 * Deduct inventory for a paid order
 *
 * Called when an order is paid/closed. This function:
 * 1. Fetches the order with full recipe/modifier data
 * 2. Calculates theoretical usage using the same logic as reports
 * 3. Decrements inventory stock and creates transaction records
 *
 * This is designed to be called asynchronously (fire-and-forget) to not
 * block the payment flow.
 *
 * @param orderId - The order ID to process
 * @param employeeId - Optional employee ID for audit trail
 * @param multiplierSettings - Optional location multiplier settings
 */
export async function deductInventoryForOrder(
  orderId: string,
  employeeId?: string | null,
  multiplierSettings?: MultiplierSettings | null
): Promise<InventoryDeductionResult> {
  try {
    // Fetch the order with full recipe tree
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: ORDER_INVENTORY_INCLUDE,
    })

    if (!order) {
      return { success: false, itemsDeducted: 0, totalCost: 0, errors: ['Order not found'] }
    }

    // Build usage map (same logic as calculateTheoreticalUsage but for one order)
    const usageMap = new Map<string, {
      inventoryItemId: string
      name: string
      quantity: number
      costPerUnit: number
      storageUnit: string
      currentStock: number
    }>()

    // Type for inventory items from Prisma (with Decimal currentStock)
    type InventoryItemWithStock = {
      id: string
      name: string
      category: string
      department: string
      storageUnit: string
      costPerUnit: Decimal | number
      yieldCostPerUnit?: Decimal | number | null
      currentStock: Decimal | number
    }

    function addUsage(item: InventoryItemWithStock, quantity: number): void {
      const existing = usageMap.get(item.id)
      const cost = getEffectiveCost(item)
      const currentStock = toNumber(item.currentStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        usageMap.set(item.id, {
          inventoryItemId: item.id,
          name: item.name,
          quantity,
          costPerUnit: cost,
          storageUnit: item.storageUnit,
          currentStock,
        })
      }
    }

    // Process each order item
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      // Build a set of inventory item IDs that have "NO" modifiers on this order item
      const removedIngredientIds = new Set<string>()
      for (const mod of orderItem.modifiers) {
        if (isRemovalInstruction(mod.preModifier)) {
          // Check inventoryLink path (primary)
          if (mod.modifier?.inventoryLink?.inventoryItemId) {
            removedIngredientIds.add(mod.modifier.inventoryLink.inventoryItemId)
          }
          // Check ingredient path (fallback)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else if ((mod.modifier as any)?.ingredient?.inventoryItem?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            removedIngredientIds.add((mod.modifier as any).ingredient.inventoryItem.id)
          }
        }
      }

      // Process recipe ingredients (MenuItemRecipe system)
      if (orderItem.menuItem?.recipe) {
        for (const ing of orderItem.menuItem.recipe.ingredients) {
          // Skip ingredients that were explicitly removed with "NO" modifier
          if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
            continue
          }

          const ingQty = toNumber(ing.quantity) * itemQty

          if (ing.inventoryItem) {
            // Direct inventory item
            addUsage(ing.inventoryItem, ingQty)
          } else if (ing.prepItem) {
            // Recursively explode prep item to raw ingredients
            const exploded = explodePrepItem(
              ing.prepItem as PrepItemWithIngredients,
              ingQty,
              ing.unit
            )
            for (const exp of exploded) {
              // Also skip exploded ingredients that were explicitly removed
              if (!removedIngredientIds.has(exp.inventoryItem.id)) {
                addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
              }
            }
          }
        }
      }

      // Process liquor recipe ingredients (RecipeIngredient -> BottleProduct -> InventoryItem)
      // This handles cocktails created via the Liquor Builder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
      if (recipeIngredients && Array.isArray(recipeIngredients)) {
        for (const ing of recipeIngredients) {
          // Get the linked inventory item from the bottle product
          const inventoryItem = ing.bottleProduct?.inventoryItem
          if (!inventoryItem) continue

          // Skip if this inventory item was explicitly removed with "NO" modifier
          if (removedIngredientIds.has(inventoryItem.id)) {
            continue
          }

          // Calculate pour quantity in oz
          // pourCount * itemQty * (pourSizeOz or location default 1.5oz)
          const pourCount = toNumber(ing.pourCount) || 1
          const pourSizeOz = toNumber(ing.pourSizeOz) || toNumber(ing.bottleProduct?.pourSizeOz) || 1.5
          const totalOz = pourCount * pourSizeOz * itemQty

          // Add usage - inventory is tracked in oz for liquor items
          addUsage(inventoryItem, totalOz)
        }
      }

      // Process modifier ingredients with instruction multipliers
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty

        // Get the multiplier based on the instruction
        const preModifier = mod.preModifier
        const multiplier = getModifierMultiplier(preModifier, multiplierSettings || undefined)

        // If multiplier is 0 (e.g., "NO"), skip this modifier entirely
        if (multiplier === 0) continue

        // Path A: ModifierInventoryLink (takes precedence)
        const link = mod.modifier?.inventoryLink
        const linkItem = link?.inventoryItem
        if (link && linkItem) {
          let linkQty = toNumber(link.usageQuantity) * modQty * multiplier

          // Apply unit conversion if needed
          if (link.usageUnit && linkItem.storageUnit) {
            const converted = convertUnits(linkQty, link.usageUnit, linkItem.storageUnit)
            if (converted !== null) {
              linkQty = converted
            }
          }

          addUsage(linkItem, linkQty)
          continue  // inventoryLink found — skip fallback
        }

        // Path B: Modifier.ingredientId → Ingredient → InventoryItem (fallback)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ingredient = (mod.modifier as any)?.ingredient
        if (ingredient?.inventoryItem) {
          const stdQty = toNumber(ingredient.standardQuantity) || 1
          let ingQty = stdQty * modQty * multiplier

          // Apply unit conversion if needed
          if (ingredient.standardUnit && ingredient.inventoryItem.storageUnit) {
            const converted = convertUnits(ingQty, ingredient.standardUnit, ingredient.inventoryItem.storageUnit)
            if (converted !== null) {
              ingQty = converted
            }
          }

          addUsage(ingredient.inventoryItem, ingQty)
        }
      }
    }

    // Now perform the actual deductions in a transaction
    const usageItems = Array.from(usageMap.values())

    if (usageItems.length === 0) {
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Build transaction array for atomic operation
    const operations = usageItems.flatMap(item => {
      const totalCost = item.quantity * item.costPerUnit
      const newStock = item.currentStock - item.quantity

      return [
        // Decrement stock
        db.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: { decrement: item.quantity },
          },
        }),
        // Create transaction record
        db.inventoryItemTransaction.create({
          data: {
            locationId: order.locationId,
            inventoryItemId: item.inventoryItemId,
            type: 'sale',
            quantityBefore: item.currentStock,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
            unitCost: item.costPerUnit,
            totalCost,
            reason: `Order #${order.orderNumber}`,
            referenceType: 'order',
            referenceId: orderId,
          },
        }),
      ]
    })

    // Execute all operations atomically
    await db.$transaction(operations)

    const totalCost = usageItems.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0)

    return {
      success: true,
      itemsDeducted: usageItems.length,
      totalCost,
    }
  } catch (error) {
    console.error('Failed to deduct inventory for order:', error)
    return {
      success: false,
      itemsDeducted: 0,
      totalCost: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

// ============================================
// Waste Path: Voided Items That Were Made
// ============================================

/**
 * Void reasons that indicate food/drink was made and should still deduct inventory
 */
export const WASTE_VOID_REASONS = [
  'kitchen_error',
  'customer_disliked',
  'wrong_order',
  'remade',
  'quality_issue',
]

/**
 * Deduct inventory for a voided order item when the food was actually made
 *
 * Called when an order item is voided with a reason indicating the item was prepared
 * (e.g., "Kitchen Error", "Customer Disliked"). This still deducts inventory
 * and also creates a waste log entry.
 *
 * @param orderItemId - The order item ID being voided
 * @param voidReason - The reason for voiding
 * @param employeeId - Optional employee ID for audit trail
 * @param multiplierSettings - Optional location multiplier settings
 */
export async function deductInventoryForVoidedItem(
  orderItemId: string,
  voidReason: string,
  employeeId?: string | null,
  multiplierSettings?: MultiplierSettings | null
): Promise<InventoryDeductionResult> {
  try {
    // Normalize the void reason
    const normalizedReason = voidReason.toLowerCase().replace(/\s+/g, '_')

    // Check if this is a waste-type void (food was made)
    if (!WASTE_VOID_REASONS.includes(normalizedReason)) {
      // Not a waste void - no inventory deduction needed
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Fetch the order item with full recipe tree
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: { select: { locationId: true, orderNumber: true } },
        menuItem: {
          include: {
            recipe: {
              include: {
                ingredients: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true,
                        name: true,
                        category: true,
                        department: true,
                        storageUnit: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                        currentStock: true,
                      },
                    },
                    prepItem: {
                      include: {
                        ingredients: {
                          include: {
                            inventoryItem: {
                              select: {
                                id: true,
                                name: true,
                                category: true,
                                department: true,
                                storageUnit: true,
                                costPerUnit: true,
                                yieldCostPerUnit: true,
                                currentStock: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        modifiers: {
          include: {
            modifier: {
              include: {
                inventoryLink: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true,
                        name: true,
                        category: true,
                        department: true,
                        storageUnit: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                        currentStock: true,
                      },
                    },
                  },
                },
                // Fallback: Modifier.ingredientId → Ingredient → InventoryItem
                ingredient: {
                  select: {
                    id: true,
                    inventoryItemId: true,
                    standardQuantity: true,
                    standardUnit: true,
                    inventoryItem: {
                      select: {
                        id: true,
                        name: true,
                        category: true,
                        department: true,
                        storageUnit: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                        currentStock: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!orderItem || !orderItem.order) {
      return { success: false, itemsDeducted: 0, totalCost: 0, errors: ['Order item not found'] }
    }

    const { locationId, orderNumber } = orderItem.order
    const itemQty = orderItem.quantity

    // Type for inventory items from Prisma (with Decimal currentStock)
    type InventoryItemWithStock = {
      id: string
      name: string
      category: string
      department: string
      storageUnit: string
      costPerUnit: Decimal | number
      yieldCostPerUnit?: Decimal | number | null
      currentStock: Decimal | number
    }

    // Build usage map
    const usageMap = new Map<string, {
      inventoryItemId: string
      name: string
      quantity: number
      costPerUnit: number
      storageUnit: string
      currentStock: number
    }>()

    function addUsage(item: InventoryItemWithStock, quantity: number): void {
      const existing = usageMap.get(item.id)
      const cost = getEffectiveCost(item)
      const currentStock = toNumber(item.currentStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        usageMap.set(item.id, {
          inventoryItemId: item.id,
          name: item.name,
          quantity,
          costPerUnit: cost,
          storageUnit: item.storageUnit,
          currentStock,
        })
      }
    }

    // Build removed ingredient set from "NO" modifiers
    const removedIngredientIds = new Set<string>()
    for (const mod of orderItem.modifiers) {
      if (isRemovalInstruction(mod.preModifier)) {
        // Check inventoryLink path (primary)
        if (mod.modifier?.inventoryLink?.inventoryItemId) {
          removedIngredientIds.add(mod.modifier.inventoryLink.inventoryItemId)
        }
        // Check ingredient path (fallback)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else if ((mod.modifier as any)?.ingredient?.inventoryItem?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          removedIngredientIds.add((mod.modifier as any).ingredient.inventoryItem.id)
        }
      }
    }

    // Process recipe ingredients
    if (orderItem.menuItem?.recipe) {
      for (const ing of orderItem.menuItem.recipe.ingredients) {
        if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
          continue
        }

        const ingQty = toNumber(ing.quantity) * itemQty

        if (ing.inventoryItem) {
          addUsage(ing.inventoryItem, ingQty)
        } else if (ing.prepItem) {
          const exploded = explodePrepItem(
            ing.prepItem as PrepItemWithIngredients,
            ingQty,
            ing.unit
          )
          for (const exp of exploded) {
            if (!removedIngredientIds.has(exp.inventoryItem.id)) {
              addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
            }
          }
        }
      }
    }

    // Process modifier ingredients
    for (const mod of orderItem.modifiers) {
      const modQty = (mod.quantity || 1) * itemQty

      const preModifier = mod.preModifier
      const multiplier = getModifierMultiplier(preModifier, multiplierSettings || undefined)

      if (multiplier === 0) continue

      // Path A: ModifierInventoryLink (takes precedence)
      const link = mod.modifier?.inventoryLink
      const linkItem = link?.inventoryItem
      if (link && linkItem) {
        let linkQty = toNumber(link.usageQuantity) * modQty * multiplier

        if (link.usageUnit && linkItem.storageUnit) {
          const converted = convertUnits(linkQty, link.usageUnit, linkItem.storageUnit)
          if (converted !== null) {
            linkQty = converted
          }
        }

        addUsage(linkItem, linkQty)
        continue  // inventoryLink found — skip fallback
      }

      // Path B: Modifier.ingredientId → Ingredient → InventoryItem (fallback)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ingredient = (mod.modifier as any)?.ingredient
      if (ingredient?.inventoryItem) {
        const stdQty = toNumber(ingredient.standardQuantity) || 1
        let ingQty = stdQty * modQty * multiplier

        if (ingredient.standardUnit && ingredient.inventoryItem.storageUnit) {
          const converted = convertUnits(ingQty, ingredient.standardUnit, ingredient.inventoryItem.storageUnit)
          if (converted !== null) {
            ingQty = converted
          }
        }

        addUsage(ingredient.inventoryItem, ingQty)
      }
    }

    // Perform deductions
    const usageItems = Array.from(usageMap.values())

    if (usageItems.length === 0) {
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Build transaction array - includes both stock decrement and waste log entries
    const operations = usageItems.flatMap(item => {
      const totalCost = item.quantity * item.costPerUnit
      const newStock = item.currentStock - item.quantity

      return [
        // Decrement stock
        db.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: { decrement: item.quantity },
          },
        }),
        // Create transaction record (type: waste)
        db.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: item.inventoryItemId,
            type: 'waste',
            quantityBefore: item.currentStock,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
            unitCost: item.costPerUnit,
            totalCost,
            reason: `Void: ${voidReason} (Order #${orderNumber})`,
            referenceType: 'void',
            referenceId: orderItemId,
          },
        }),
        // Create waste log entry
        db.wasteLogEntry.create({
          data: {
            locationId,
            inventoryItemId: item.inventoryItemId,
            quantity: item.quantity,
            unit: item.storageUnit,
            reason: voidReason,
            costImpact: totalCost,
            employeeId: employeeId || null,
            notes: `Auto-logged from voided order item (Order #${orderNumber})`,
          },
        }),
      ]
    })

    // Execute atomically
    await db.$transaction(operations)

    const totalCost = usageItems.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0)

    return {
      success: true,
      itemsDeducted: usageItems.length,
      totalCost,
    }
  } catch (error) {
    console.error('Failed to deduct inventory for voided item:', error)
    return {
      success: false,
      itemsDeducted: 0,
      totalCost: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

// ============================================
// Prep Stock Deduction (on Send to Kitchen)
// ============================================

export interface PrepStockDeductionResult {
  success: boolean
  deductedItems: Array<{
    ingredientId: string
    name: string
    quantityDeducted: number
    unit: string
    stockBefore: number
    stockAfter: number
  }>
  errors: string[]
}

/**
 * Deduct prep stock when order items are sent to kitchen.
 * This tracks prepared ingredient usage for daily count items.
 *
 * @param orderId - The order ID
 * @param orderItemIds - Specific item IDs being sent (empty = all pending items)
 * @returns Deduction result with items deducted
 */
export async function deductPrepStockForOrder(
  orderId: string,
  orderItemIds?: string[]
): Promise<PrepStockDeductionResult> {
  try {
    // Get order with items and their ingredients
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: {
          where: orderItemIds?.length
            ? { id: { in: orderItemIds }, deletedAt: null }
            : { deletedAt: null },
          include: {
            menuItem: {
              include: {
                // Get menu item ingredients (links to Ingredient model)
                ingredients: {
                  where: { deletedAt: null },
                  include: {
                    ingredient: {
                      include: {
                        // Include child prep items
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            modifiers: {
              where: { deletedAt: null },
              include: {
                modifier: {
                  include: {
                    // Modifiers may link to ingredients
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!order) {
      return { success: false, deductedItems: [], errors: ['Order not found'] }
    }

    // Check if prep stock tracking is enabled for this location
    const settings = await db.inventorySettings.findUnique({
      where: { locationId: order.locationId },
    })

    // Default to enabled if no settings exist
    const trackPrepStock = settings?.trackPrepStock ?? true
    const deductPrepOnSend = settings?.deductPrepOnSend ?? true

    if (!trackPrepStock || !deductPrepOnSend) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build usage map for prep items (ingredients with isDailyCountItem = true)
    const prepUsageMap = new Map<string, {
      ingredientId: string
      name: string
      quantity: number
      unit: string
      currentStock: number
    }>()

    function addPrepUsage(ingredient: {
      id: string
      name: string
      standardUnit?: string | null
      currentPrepStock: Decimal | number
      isDailyCountItem?: boolean
    }, quantity: number): void {
      if (!ingredient.isDailyCountItem) return

      const existing = prepUsageMap.get(ingredient.id)
      const currentStock = toNumber(ingredient.currentPrepStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        prepUsageMap.set(ingredient.id, {
          ingredientId: ingredient.id,
          name: ingredient.name,
          quantity,
          unit: ingredient.standardUnit || 'each',
          currentStock,
        })
      }
    }

    // Build removed ingredient set from "NO" modifiers
    const removedIngredientIds = new Set<string>()
    for (const item of order.items) {
      for (const mod of item.modifiers) {
        const preModifier = mod.preModifier
        if (isRemovalInstruction(preModifier) && mod.modifier?.ingredient?.id) {
          removedIngredientIds.add(mod.modifier.ingredient.id)
        }
      }
    }

    // Process each order item
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      // Process menu item ingredients
      if (orderItem.menuItem?.ingredients) {
        for (const link of orderItem.menuItem.ingredients) {
          const ingredient = link.ingredient
          if (!ingredient || removedIngredientIds.has(ingredient.id)) continue

          // Use override quantity or ingredient's standard quantity
          const baseQty = link.quantity
            ? toNumber(link.quantity)
            : ingredient.standardQuantity
              ? toNumber(ingredient.standardQuantity)
              : 1

          let totalQty = baseQty * itemQty

          // Apply unit conversion if link unit differs from ingredient's standard unit
          const linkUnit = (link as { unit?: string | null }).unit
          if (linkUnit && ingredient.standardUnit && linkUnit !== ingredient.standardUnit) {
            const converted = convertUnits(totalQty, linkUnit, ingredient.standardUnit)
            if (converted !== null) totalQty = converted
          }

          // Add the ingredient itself if it's a daily count item
          if (ingredient.isDailyCountItem) {
            addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
          }

          // Also check child prep items
          if (ingredient.childIngredients) {
            for (const child of ingredient.childIngredients) {
              if (child.isDailyCountItem) {
                // Child quantity is relative to parent
                const childQty = child.standardQuantity
                  ? toNumber(child.standardQuantity) * totalQty
                  : totalQty
                addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
              }
            }
          }
        }
      }

      // Process modifier ingredients
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty
        const ingredient = mod.modifier?.ingredient

        if (!ingredient || removedIngredientIds.has(ingredient.id)) continue

        const preModifier = mod.preModifier
        const multiplier = getModifierMultiplier(preModifier, {
          multiplierLite: settings?.multiplierLite ? toNumber(settings.multiplierLite) : 0.5,
          multiplierExtra: settings?.multiplierExtra ? toNumber(settings.multiplierExtra) : 2.0,
          multiplierTriple: settings?.multiplierTriple ? toNumber(settings.multiplierTriple) : 3.0,
        })

        if (multiplier === 0) continue

        const totalQty = modQty * multiplier

        if (ingredient.isDailyCountItem) {
          addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
        }

        // Check child prep items
        if (ingredient.childIngredients) {
          for (const child of ingredient.childIngredients) {
            if (child.isDailyCountItem) {
              const childQty = child.standardQuantity
                ? toNumber(child.standardQuantity) * totalQty
                : totalQty
              addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
            }
          }
        }
      }
    }

    // Perform deductions
    const prepItems = Array.from(prepUsageMap.values())

    if (prepItems.length === 0) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build update operations
    const deductedItems: PrepStockDeductionResult['deductedItems'] = []

    const operations = prepItems.map(item => {
      const newStock = Math.max(0, item.currentStock - item.quantity)

      deductedItems.push({
        ingredientId: item.ingredientId,
        name: item.name,
        quantityDeducted: item.quantity,
        unit: item.unit,
        stockBefore: item.currentStock,
        stockAfter: newStock,
      })

      return db.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          currentPrepStock: { decrement: item.quantity },
        },
      })
    })

    // Execute atomically
    await db.$transaction(operations)

    return {
      success: true,
      deductedItems,
      errors: [],
    }
  } catch (error) {
    console.error('Failed to deduct prep stock:', error)
    return {
      success: false,
      deductedItems: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

/**
 * Restore prep stock when order items are voided (before they're made).
 * Only restores if the item hasn't been prepared yet.
 *
 * @param orderId - The order ID
 * @param orderItemIds - Specific item IDs being voided
 * @param wasMade - Whether the food was actually made (don't restore if true)
 * @returns Restoration result
 */
export async function restorePrepStockForVoid(
  orderId: string,
  orderItemIds: string[],
  wasMade: boolean = false
): Promise<PrepStockDeductionResult> {
  // Don't restore if the food was actually made
  if (wasMade) {
    return { success: true, deductedItems: [], errors: [] }
  }

  try {
    // Get order with items and their ingredients
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: {
          where: { id: { in: orderItemIds } },
          include: {
            menuItem: {
              include: {
                ingredients: {
                  where: { deletedAt: null },
                  include: {
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            modifiers: {
              where: { deletedAt: null },
              include: {
                modifier: {
                  include: {
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!order) {
      return { success: false, deductedItems: [], errors: ['Order not found'] }
    }

    // Check settings
    const settings = await db.inventorySettings.findUnique({
      where: { locationId: order.locationId },
    })

    const restorePrepOnVoid = settings?.restorePrepOnVoid ?? true

    if (!restorePrepOnVoid) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build usage map (same logic as deduction)
    const prepUsageMap = new Map<string, {
      ingredientId: string
      name: string
      quantity: number
      unit: string
      currentStock: number
    }>()

    function addPrepUsage(ingredient: {
      id: string
      name: string
      standardUnit?: string | null
      currentPrepStock: Decimal | number
      isDailyCountItem?: boolean
    }, quantity: number): void {
      if (!ingredient.isDailyCountItem) return

      const existing = prepUsageMap.get(ingredient.id)
      const currentStock = toNumber(ingredient.currentPrepStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        prepUsageMap.set(ingredient.id, {
          ingredientId: ingredient.id,
          name: ingredient.name,
          quantity,
          unit: ingredient.standardUnit || 'each',
          currentStock,
        })
      }
    }

    // Process items (same as deduction)
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      if (orderItem.menuItem?.ingredients) {
        for (const link of orderItem.menuItem.ingredients) {
          const ingredient = link.ingredient
          if (!ingredient) continue

          const baseQty = link.quantity
            ? toNumber(link.quantity)
            : ingredient.standardQuantity
              ? toNumber(ingredient.standardQuantity)
              : 1

          const totalQty = baseQty * itemQty

          if (ingredient.isDailyCountItem) {
            addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
          }

          if (ingredient.childIngredients) {
            for (const child of ingredient.childIngredients) {
              if (child.isDailyCountItem) {
                const childQty = child.standardQuantity
                  ? toNumber(child.standardQuantity) * totalQty
                  : totalQty
                addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
              }
            }
          }
        }
      }

      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty
        const ingredient = mod.modifier?.ingredient

        if (!ingredient) continue

        const multiplier = getModifierMultiplier(mod.preModifier, {
          multiplierLite: settings?.multiplierLite ? toNumber(settings.multiplierLite) : 0.5,
          multiplierExtra: settings?.multiplierExtra ? toNumber(settings.multiplierExtra) : 2.0,
          multiplierTriple: settings?.multiplierTriple ? toNumber(settings.multiplierTriple) : 3.0,
        })

        if (multiplier === 0) continue

        const totalQty = modQty * multiplier

        if (ingredient.isDailyCountItem) {
          addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
        }

        if (ingredient.childIngredients) {
          for (const child of ingredient.childIngredients) {
            if (child.isDailyCountItem) {
              const childQty = child.standardQuantity
                ? toNumber(child.standardQuantity) * totalQty
                : totalQty
              addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
            }
          }
        }
      }
    }

    // Perform restorations (increment instead of decrement)
    const prepItems = Array.from(prepUsageMap.values())

    if (prepItems.length === 0) {
      return { success: true, deductedItems: [], errors: [] }
    }

    const restoredItems: PrepStockDeductionResult['deductedItems'] = []

    const operations = prepItems.map(item => {
      const newStock = item.currentStock + item.quantity

      restoredItems.push({
        ingredientId: item.ingredientId,
        name: item.name,
        quantityDeducted: -item.quantity, // Negative to indicate restoration
        unit: item.unit,
        stockBefore: item.currentStock,
        stockAfter: newStock,
      })

      return db.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          currentPrepStock: { increment: item.quantity },
        },
      })
    })

    await db.$transaction(operations)

    return {
      success: true,
      deductedItems: restoredItems,
      errors: [],
    }
  } catch (error) {
    console.error('Failed to restore prep stock:', error)
    return {
      success: false,
      deductedItems: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

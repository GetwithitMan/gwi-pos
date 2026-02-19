/**
 * Recipe Costing & Ingredient Cost Calculation
 */

import { Decimal } from '@prisma/client/runtime/library'
import type { RecipeCostingResult } from './types'
import { getEffectiveCost, toNumber } from './helpers'
import { convertUnits, normalizeUnit } from './unit-conversion'

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

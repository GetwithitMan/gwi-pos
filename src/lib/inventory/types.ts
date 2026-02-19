/**
 * Shared types for inventory calculations
 */

import { Decimal } from '@prisma/client/runtime/library'

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
 * Result type for inventory deduction operations
 */
export interface InventoryDeductionResult {
  success: boolean
  itemsDeducted: number
  totalCost: number
  errors?: string[]
}

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

export interface RecipeCostingResult {
  totalCost: number
  sellPrice: number
  foodCostPercent: number
  grossProfit: number
  grossMargin: number
}

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

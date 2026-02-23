/**
 * Inventory Calculations - Barrel Re-exports
 *
 * All sub-modules are re-exported here so existing imports
 * from '@/lib/inventory-calculations' continue to work via
 * the barrel file at src/lib/inventory-calculations.ts.
 */

// Types
export type {
  InventoryItemData,
  TheoreticalUsageItem,
  TheoreticalUsageResult,
  CalculateTheoreticalUsageParams,
  PrepItemIngredient,
  PrepItemWithIngredients,
  RecipeIngredient,
  MultiplierSettings,
  InventoryDeductionResult,
  PrepStockDeductionResult,
  RecipeCostingResult,
  IngredientWithCost,
} from './types'

// Unit Conversion
export {
  normalizeUnit,
  convertUnits,
  areUnitsCompatible,
  getUnitCategory,
  unitConversion,
} from './unit-conversion'

// Helpers
export {
  getEffectiveCost,
  toNumber,
  DEFAULT_MULTIPLIERS,
  getModifierMultiplier,
  isRemovalInstruction,
  explodePrepItem,
} from './helpers'
export type { ExplodedIngredient } from './helpers'

// Theoretical Usage
export { calculateTheoreticalUsage } from './theoretical-usage'

// Recipe Costing
export { calculateRecipeCosting, calculateIngredientCosts } from './recipe-costing'

// Order Deduction
export { ORDER_INVENTORY_INCLUDE, deductInventoryForOrder } from './order-deduction'

// Void/Waste
export { WASTE_VOID_REASONS, deductInventoryForVoidedItem, restoreInventoryForRestoredItem } from './void-waste'

// Prep Stock
export { deductPrepStockForOrder, restorePrepStockForVoid } from './prep-stock'

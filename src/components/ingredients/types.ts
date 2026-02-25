export interface IngredientCategory {
  id: string
  code: number
  name: string
  description?: string | null
  icon?: string | null
  color?: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount?: number
  needsVerification?: boolean
}

export interface InventoryItemRef {
  id: string
  name: string
  storageUnit: string
}

export interface PrepItemRef {
  id: string
  name: string
  outputUnit: string
}

export interface SwapGroup {
  id: string
  name: string
}

export interface Ingredient {
  id: string
  locationId: string
  name: string
  description?: string | null
  category?: string | null // Legacy
  categoryId?: string | null
  categoryRelation?: IngredientCategory | null
  inventoryItemId?: string | null
  inventoryItem?: InventoryItemRef | null
  prepItemId?: string | null
  prepItem?: PrepItemRef | null
  standardQuantity?: number | null
  standardUnit?: string | null
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  extraPrice: number
  liteMultiplier: number
  extraMultiplier: number
  allowSwap: boolean
  swapGroupId?: string | null
  swapGroup?: SwapGroup | null
  swapUpcharge: number
  visibility: string
  sortOrder: number
  isActive: boolean
  usedByCount?: number

  // Hierarchy fields
  parentIngredientId?: string | null
  parentIngredient?: { id: string; name: string; standardQuantity?: number | null; standardUnit?: string | null } | null
  preparationType?: string | null
  yieldPercent?: number | null
  isBaseIngredient?: boolean
  childIngredients?: Ingredient[]
  childCount?: number

  // Explicit Input -> Output (for prep items)
  inputQuantity?: number | null    // How much of parent is consumed
  inputUnit?: string | null        // Unit for input (e.g., "oz")
  outputQuantity?: number | null   // How much is produced
  outputUnit?: string | null       // Unit for output (e.g., "oz" or "each")

  // Recipe batch yield (for inventory items with recipes)
  recipeYieldQuantity?: number | null  // How much one recipe batch makes
  recipeYieldUnit?: string | null      // Unit for recipe yield

  // Daily count settings (for prep items)
  isDailyCountItem?: boolean
  countPrecision?: 'whole' | 'decimal'
  currentPrepStock?: number
  lastCountedAt?: string
  lowStockThreshold?: number | null
  criticalStockThreshold?: number | null
  onlineStockThreshold?: number | null

  // Legacy fields (deprecated, use inputQuantity/inputUnit)
  portionSize?: number | null
  portionUnit?: string | null
  batchYield?: number | null
  batchYieldUnit?: string | null

  // Verification (items created from menu builder)
  needsVerification?: boolean
  verifiedAt?: string | null
  verifiedBy?: string | null

  // Linked modifier count (from Modifier.ingredientId)
  linkedModifierCount?: number

  // Source type: delivered vs made in-house
  sourceType?: string

  // Purchase info (for delivered items)
  purchaseUnit?: string | null
  purchaseCost?: number | null
  unitsPerPurchase?: number | null
  showOnQuick86?: boolean
}

export interface RestoreDestination {
  type: 'uncategorized' | 'category' | 'inventory-item'
  targetId?: string
  targetName?: string
}

export interface DeleteCategoryInfo {
  ingredientCount: number
  childCount: number
  totalCount: number
}

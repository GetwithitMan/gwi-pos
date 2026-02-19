export interface Ingredient {
  id: string
  ingredientId: string
  name: string
  category?: string | null     // Ingredient category code from API
  isIncluded: boolean
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  allowSwap: boolean
  extraPrice: number
  needsVerification?: boolean  // ← Verification status
}

export interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
  categoryName: string | null       // from categoryRelation.name
  categoryId: string | null         // actual category relation ID
  parentIngredientId: string | null  // to identify child items
  parentName: string | null         // parent ingredient's name for sub-headers
  needsVerification: boolean        // verification flag
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  allowSwap: boolean
  swapModifierGroupId: string | null
  swapUpcharge: number
}

export interface IngredientCategory {
  id: string
  code: number
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount: number
  needsVerification?: boolean
}

export interface Modifier {
  id: string
  name: string
  price: number
  allowNo?: boolean
  allowLite?: boolean
  allowOnSide?: boolean
  allowExtra?: boolean
  extraPrice?: number
  isDefault?: boolean
  sortOrder: number
  ingredientId?: string | null
  ingredientName?: string | null
  childModifierGroupId?: string | null
  childModifierGroup?: ModifierGroup | null
  isLabel?: boolean
  printerRouting?: string  // "follow" | "also" | "only"
  printerIds?: string[]    // Printer IDs for "also" or "only" mode
}

export interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  allowStacking?: boolean
  tieredPricingConfig?: any
  exclusionGroupKey?: string | null
  sortOrder: number
  modifiers: Modifier[]
}

export interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  categoryId: string
  categoryType?: string
  isActive: boolean
  isAvailable: boolean
}

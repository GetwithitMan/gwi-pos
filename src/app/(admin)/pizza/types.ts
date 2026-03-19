import { PizzaPrintSettings } from '@/types/print'

export interface PizzaConfig {
  id: string
  maxSections: number
  defaultSections: number
  sectionOptions: number[]
  pricingMode: string
  hybridPricing: Record<string, number> | null
  freeToppingsEnabled: boolean
  freeToppingsCount: number
  freeToppingsMode: string
  extraToppingPrice: number | null
  showVisualBuilder: boolean
  showToppingList: boolean
  defaultToListView: boolean
  printerIds: string[]
  printSettings: PizzaPrintSettings | null
  allowCondimentSections: boolean
  condimentDivisionMax: number  // 1=whole only, 2=halves, 3=thirds
}

export interface Printer {
  id: string
  name: string
  printerRole: 'receipt' | 'kitchen' | 'bar'
}

export interface PizzaSize {
  id: string
  name: string
  displayName: string | null
  inches: number | null
  slices: number
  basePrice: number
  priceMultiplier: number
  toppingMultiplier: number
  freeToppings: number
  inventoryMultiplier: number
  inventoryItemId: string | null
  inventoryItemName?: string | null
  usageQuantity: number | null
  usageUnit: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

export interface PizzaCrust {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  inventoryItemId: string | null
  inventoryItemName?: string | null
  usageQuantity: number | null
  usageUnit: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

export interface PizzaSauce {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
  inventoryItemId: string | null
  inventoryItemName?: string | null
  usageQuantity: number | null
  usageUnit: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

export interface PizzaCheese {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
  inventoryItemId: string | null
  inventoryItemName?: string | null
  usageQuantity: number | null
  usageUnit: string | null
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

export interface PizzaTopping {
  id: string
  name: string
  displayName: string | null
  description: string | null
  category: string
  price: number
  extraPrice: number | null
  color: string | null
  isActive: boolean
  sortOrder: number
  // Inventory linkage for cost tracking & deductions
  inventoryItemId: string | null
  inventoryItemName?: string | null
  usageQuantity: number | null
  usageUnit: string | null
}

export interface SpecialtyToppingEntry {
  toppingId: string
  name: string
  sections: number[]
  amount: string // "regular" | "extra"
}

export interface PizzaSpecialty {
  id: string
  locationId: string
  menuItemId: string
  menuItem: {
    id: string
    name: string
    price: number
  }
  defaultCrustId: string | null
  defaultCrust: PizzaCrust | null
  defaultSauceId: string | null
  defaultSauce: PizzaSauce | null
  defaultCheeseId: string | null
  defaultCheese: PizzaCheese | null
  sauceAmount: string
  cheeseAmount: string
  toppings: SpecialtyToppingEntry[]
  allowSizeChange: boolean
  allowCrustChange: boolean
  allowSauceChange: boolean
  allowCheeseChange: boolean
  allowToppingMods: boolean
}

export interface PizzaMenuItem {
  id: string
  name: string
  price: number
  description?: string
  imageUrl?: string | null
  isActive?: boolean
  showOnPOS?: boolean
  showOnline?: boolean
  categoryId?: string
  categoryName?: string
  commissionType?: string | null
  commissionValue?: number | null
  taxRate?: number | null
  isTaxExempt?: boolean
  allergens?: string[]
  prepStationId?: string | null
  prepTime?: number | null
  sortOrder?: number
}

export interface PizzaCategory {
  id: string
  name: string
  color: string
  categoryType: string
  itemCount: number
}

export const TOPPING_CATEGORIES = [
  { value: 'meat', label: 'Meats', color: '#ef4444' },
  { value: 'veggie', label: 'Vegetables', color: '#22c55e' },
  { value: 'cheese', label: 'Cheeses', color: '#eab308' },
  { value: 'premium', label: 'Premium', color: '#a855f7' },
  { value: 'specialty', label: 'Specialty', color: '#f59e0b' },
  { value: 'seafood', label: 'Seafood', color: '#3b82f6' },
  { value: 'standard', label: 'Standard', color: '#6b7280' },
]

export const AMOUNT_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'regular', label: 'Regular' },
  { value: 'extra', label: 'Extra' },
]

export const ALL_SECTIONS = Array.from({ length: 24 }, (_, i) => i)

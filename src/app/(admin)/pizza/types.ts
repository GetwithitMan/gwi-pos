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
}

export const TOPPING_CATEGORIES = [
  { value: 'meat', label: 'Meats', color: '#ef4444' },
  { value: 'veggie', label: 'Vegetables', color: '#22c55e' },
  { value: 'cheese', label: 'Cheeses', color: '#eab308' },
  { value: 'premium', label: 'Premium', color: '#a855f7' },
  { value: 'seafood', label: 'Seafood', color: '#3b82f6' },
  { value: 'standard', label: 'Standard', color: '#6b7280' },
]

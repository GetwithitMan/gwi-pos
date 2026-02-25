import type { IngredientLibraryItem } from '@/components/menu/ItemEditor'

// Re-export for convenience
export type { IngredientLibraryItem }

// Category types for reporting and item builder selection
export const CATEGORY_TYPES = [
  { value: 'food', label: 'Food', color: '#22c55e', description: 'Kitchen items, appetizers, entrees' },
  { value: 'drinks', label: 'Drinks', color: '#3b82f6', description: 'Non-alcoholic beverages' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6', description: 'Spirits, cocktails, beer — managed here and in Liquor Builder' },
  { value: 'pizza', label: 'Pizza', color: '#ef4444', description: 'Pizza items with sectional toppings builder' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316', description: 'Pool tables, darts, games - timed billing' },
  { value: 'combos', label: 'Combos', color: '#ec4899', description: 'Bundled items' },
]

export interface Category {
  id: string
  name: string
  color: string
  categoryType: string
  categoryShow: string // 'bar' | 'food' | 'entertainment' | 'all'
  itemCount: number
  isActive: boolean
  printerIds?: string[] | null
}

// Bartender view section options
export const CATEGORY_SHOW_OPTIONS = [
  { value: 'bar', label: 'Bar', color: '#3b82f6', description: 'Shows in Bar section only' },
  { value: 'food', label: 'Food', color: '#f97316', description: 'Shows in Food section only' },
  { value: 'entertainment', label: 'Entertainment', color: '#8b5cf6', description: 'Shows in Entertainment mode' },
  { value: 'all', label: 'All', color: '#22c55e', description: 'Shows in both Bar and Food sections' },
]

export interface Printer {
  id: string
  name: string
  printerRole: 'receipt' | 'kitchen' | 'bar'
  isActive: boolean
}

export interface KDSScreen {
  id: string
  name: string
  screenType: 'kds' | 'entertainment'
  isActive: boolean
}

// Combined type for print destinations (printers + KDS screens)
export interface PrintDestination {
  id: string
  name: string
  type: 'printer' | 'kds'
  role?: string
  isActive: boolean
}

export interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  description?: string
  isActive: boolean
  isAvailable: boolean
  itemType?: string
  timedPricing?: { per15Min?: number; per30Min?: number; perHour?: number; minimum?: number } | null
  minimumMinutes?: number | null
  modifierGroupCount?: number
  modifierGroups?: { id: string; showOnline: boolean }[]
  commissionType?: string | null
  commissionValue?: number | null
  // Liquor Builder fields
  isLiquorItem?: boolean
  hasRecipe?: boolean
  recipeIngredientCount?: number
  totalPourCost?: number | null
  profitMargin?: number | null
  // Pour size options (new format with labels)
  pourSizes?: Record<string, number | { label: string; multiplier: number }> | null
  defaultPourSize?: string | null
  applyPourToModifiers?: boolean
  // Entertainment fields
  entertainmentStatus?: 'available' | 'in_use' | 'maintenance' | 'reserved' | null
  currentOrderId?: string | null
  blockTimeMinutes?: number | null
  // Printer routing
  printerIds?: string[] | null
  backupPrinterIds?: string[] | null
  // Combo print mode
  comboPrintMode?: 'individual' | 'primary' | 'all' | null
}

export interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  modifierTypes: string[]
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: { id: string; name: string; price: number }[]
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

export interface MenuItemIngredient {
  id: string
  ingredientId: string
  name: string
  category: string | null
  isIncluded: boolean
  sortOrder: number
  extraPrice: number
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  allowSwap: boolean
  swapUpcharge: number
}

// Modifier type definitions for filtering
export const MODIFIER_TYPES = [
  { value: 'universal', label: 'Universal', color: '#6b7280' },
  { value: 'food', label: 'Food', color: '#22c55e' },
  { value: 'liquor', label: 'Liquor', color: '#8b5cf6' },
  { value: 'retail', label: 'Retail', color: '#f59e0b' },
  { value: 'entertainment', label: 'Entertainment', color: '#f97316' },
  { value: 'combo', label: 'Combo', color: '#ec4899' },
]

// Map category types to their primary modifier type
export const CATEGORY_TO_MODIFIER_TYPE: Record<string, string> = {
  food: 'food',
  drinks: 'food',
  liquor: 'liquor',
  entertainment: 'entertainment',
  combos: 'combo',
  retail: 'retail',
}

// Pour size configurations for liquor items
export const DEFAULT_POUR_SIZES: Record<string, { label: string; multiplier: number }> = {
  standard: { label: 'Standard Pour', multiplier: 1.0 },
  shot: { label: 'Shot', multiplier: 1.0 },
  double: { label: 'Double', multiplier: 2.0 },
  tall: { label: 'Tall', multiplier: 1.5 },
  short: { label: 'Short', multiplier: 0.75 },
}

// Helper to convert old format (Record<string, number>) to new format
export function normalizePourSizes(data: Record<string, number | { label: string; multiplier: number }> | null): Record<string, { label: string; multiplier: number }> {
  // Return empty object if no data - nothing selected by default
  if (!data) return {}

  const result: Record<string, { label: string; multiplier: number }> = {}
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number') {
      // Old format: just a multiplier number
      result[key] = {
        label: DEFAULT_POUR_SIZES[key]?.label || key.charAt(0).toUpperCase() + key.slice(1),
        multiplier: value
      }
    } else {
      // New format: { label, multiplier }
      result[key] = value
    }
  }
  return result
}

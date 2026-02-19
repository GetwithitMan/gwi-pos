// ============================================================================
// BARTENDER VIEW — DISPLAY SETTINGS & CONSTANTS
// ============================================================================

// Category display settings
export type CategoryRows = 1 | 2
export type CategorySize = 'xsmall' | 'small' | 'medium' | 'large' | 'xlarge' | 'blind'

export interface CategoryDisplaySettings {
  rows: CategoryRows
  size: CategorySize
}

export const CATEGORY_SIZES: { value: CategorySize; label: string; px: number; text: string }[] = [
  { value: 'xsmall', label: 'XS', px: 60, text: 'text-[9px]' },
  { value: 'small', label: 'S', px: 80, text: 'text-[10px]' },
  { value: 'medium', label: 'M', px: 100, text: 'text-xs' },
  { value: 'large', label: 'L', px: 125, text: 'text-sm' },
  { value: 'xlarge', label: 'XL', px: 150, text: 'text-base' },
  { value: 'blind', label: '👁️', px: 200, text: 'text-2xl' },
]

export const DEFAULT_CATEGORY_SETTINGS: CategoryDisplaySettings = { rows: 2, size: 'large' }

// Item display settings
export type ItemSize = 'compact' | 'normal' | 'large' | 'xlarge'
export type ItemsPerRow = 'auto' | 3 | 4 | 5 | 6

export interface ItemDisplaySettings {
  size: ItemSize
  itemsPerRow: ItemsPerRow
  showPrices: boolean
  showDualPricing: boolean // Show both cash and card prices from system settings
  showQuickPours: boolean // Show quick pour size buttons on liquor items
  useScrolling: boolean // Use scrolling instead of pagination
}

export interface ItemCustomization {
  backgroundColor?: string
  textColor?: string
  highlight?: 'none' | 'glow' | 'border' | 'larger'
  sortOrder?: number // Custom sort order within category
  // New fun options
  fontStyle?: 'normal' | 'bold' | 'italic' | 'boldItalic'
  fontFamily?: 'default' | 'rounded' | 'mono' | 'serif' | 'handwritten'
  glowColor?: string // Custom glow color
  borderColor?: string // Custom border color
  effect?: 'none' | 'pulse' | 'shimmer' | 'rainbow' | 'neon'
}

// Font family options
export const FONT_FAMILIES: { value: string; label: string; className: string }[] = [
  { value: 'default', label: 'Default', className: '' },
  { value: 'rounded', label: 'Rounded', className: 'font-[system-ui]' },
  { value: 'mono', label: 'Mono', className: 'font-mono' },
  { value: 'serif', label: 'Serif', className: 'font-serif' },
  { value: 'handwritten', label: 'Script', className: 'italic' },
]

// Effect presets for quick styling
export const EFFECT_PRESETS: { value: string; label: string; emoji: string }[] = [
  { value: 'none', label: 'None', emoji: '○' },
  { value: 'pulse', label: 'Pulse', emoji: '💫' },
  { value: 'shimmer', label: 'Shimmer', emoji: '✨' },
  { value: 'rainbow', label: 'Rainbow', emoji: '🌈' },
  { value: 'neon', label: 'Neon', emoji: '💡' },
]

// Quick color presets for glow/border
export const GLOW_COLORS = [
  { color: '#3b82f6', label: 'Blue' },
  { color: '#8b5cf6', label: 'Purple' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#10b981', label: 'Green' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#ef4444', label: 'Red' },
  { color: '#06b6d4', label: 'Cyan' },
  { color: '#ffffff', label: 'White' },
]

export const ITEM_SIZES: { value: ItemSize; label: string; minWidth: number; height: number; text: string }[] = [
  { value: 'compact', label: 'Compact', minWidth: 80, height: 60, text: 'text-xs' },
  { value: 'normal', label: 'Normal', minWidth: 100, height: 80, text: 'text-sm' },
  { value: 'large', label: 'Large', minWidth: 120, height: 100, text: 'text-base' },
  { value: 'xlarge', label: 'X-Large', minWidth: 150, height: 120, text: 'text-lg' },
]

export const DEFAULT_ITEM_SETTINGS: ItemDisplaySettings = {
  size: 'normal',
  itemsPerRow: 'auto',
  showPrices: true,
  showDualPricing: false, // Show both cash and card prices
  showQuickPours: true, // Show quick pour size buttons on liquor items
  useScrolling: false, // Use pagination by default
}

// Helper to determine if a color is light or dark for text contrast
export function isLightColor(hexColor: string): boolean {
  if (!hexColor || !hexColor.startsWith('#')) return false
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  // Using relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

// Local storage keys
export const getFavoritesKey = (employeeId: string) => `bartender_favorites_${employeeId}`
export const getCategorySettingsKey = (employeeId: string) => `bartender_category_settings_${employeeId}`
export const getItemSettingsKey = (employeeId: string) => `bartender_item_settings_${employeeId}`
export const getItemCustomizationsKey = (employeeId: string) => `bartender_item_customizations_${employeeId}`
export const getItemOrderKey = (employeeId: string, categoryId: string) => `bartender_item_order_${employeeId}_${categoryId}`

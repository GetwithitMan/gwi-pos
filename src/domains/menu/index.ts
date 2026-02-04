/**
 * Menu Domain
 *
 * Manages items, pricing, and availability.
 *
 * Modules:
 * - M1: Categories (menu organization)
 * - M2: Items (menu items, descriptions)
 * - M3: Modifiers (modifier groups, options)
 * - M4: Pricing (base prices, time-based)
 * - M5: Availability (86'd items, schedule)
 * - M6: Combos (combo deals, bundling)
 * - M7: Specials (happy hour, daily specials)
 */

// Types will be added as we migrate
export type MenuItem = {
  id: string
  name: string
  categoryId: string
  price: number
  isActive: boolean
}

export type MenuCategory = {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

// Constants
export const MENU_ITEM_TYPES = [
  'food',
  'beverage',
  'alcohol',
  'modifier',
  'combo',
] as const

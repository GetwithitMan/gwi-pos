/**
 * Order Management ↔ Menu Bridge
 *
 * Connects orders with menu item data.
 *
 * Use cases:
 * - Order needs menu item details (name, price, modifiers)
 * - Order needs to check item availability (86'd status)
 * - Menu needs to know item popularity (for reporting)
 */

// =============================================================================
// ORDER MANAGEMENT → MENU
// =============================================================================

export interface OrderToMenuBridge {
  /**
   * Get menu item details for adding to order
   */
  getMenuItem(itemId: string): Promise<{
    id: string
    name: string
    price: number
    categoryId: string
    isAvailable: boolean
    modifierGroups: Array<{
      id: string
      name: string
      required: boolean
      modifiers: Array<{
        id: string
        name: string
        price: number
      }>
    }>
  } | null>

  /**
   * Check if an item is available (not 86'd)
   */
  isItemAvailable(itemId: string): Promise<boolean>

  /**
   * Get current price for an item (may vary by time of day)
   */
  getCurrentPrice(itemId: string): Promise<number>

  /**
   * Validate modifier selections
   */
  validateModifiers(itemId: string, modifierIds: string[]): Promise<{
    valid: boolean
    errors: string[]
  }>
}

// =============================================================================
// MENU → ORDER MANAGEMENT
// =============================================================================

export interface MenuToOrderBridge {
  /**
   * Get recent order count for an item (for popularity)
   */
  getRecentOrderCount(itemId: string, days: number): Promise<number>

  /**
   * Get items frequently ordered together
   */
  getFrequentlyOrderedWith(itemId: string): Promise<string[]>
}

// =============================================================================
// BRIDGE IMPLEMENTATION PLACEHOLDER
// =============================================================================

export const orderToMenuBridge: OrderToMenuBridge = {
  getMenuItem: async () => null,
  isItemAvailable: async () => true,
  getCurrentPrice: async () => 0,
  validateModifiers: async () => ({ valid: true, errors: [] }),
}

export const menuToOrderBridge: MenuToOrderBridge = {
  getRecentOrderCount: async () => 0,
  getFrequentlyOrderedWith: async () => [],
}

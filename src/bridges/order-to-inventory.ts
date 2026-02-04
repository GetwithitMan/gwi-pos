/**
 * Order Management ↔ Inventory Bridge
 *
 * Connects orders with inventory tracking.
 *
 * Use cases:
 * - Deduct stock when items are sold
 * - Check stock levels before allowing order
 * - Track theoretical vs actual usage
 */

// =============================================================================
// ORDER MANAGEMENT → INVENTORY
// =============================================================================

export interface OrderToInventoryBridge {
  /**
   * Deduct inventory when an order item is completed
   */
  deductInventory(orderItemId: string, menuItemId: string, quantity: number): Promise<boolean>

  /**
   * Check if there's sufficient stock for an item
   */
  checkStock(menuItemId: string, quantity: number): Promise<{
    available: boolean
    currentStock: number
    required: number
  }>

  /**
   * Get stock status for display (ok, low, critical, out)
   */
  getStockStatus(menuItemId: string): Promise<'ok' | 'low' | 'critical' | 'out'>

  /**
   * Reverse inventory deduction (for voids)
   */
  reverseDeduction(orderItemId: string): Promise<boolean>
}

// =============================================================================
// INVENTORY → ORDER MANAGEMENT
// =============================================================================

export interface InventoryToOrderBridge {
  /**
   * Get all items that need inventory deduction for an order
   */
  getItemsRequiringDeduction(orderId: string): Promise<Array<{
    orderItemId: string
    menuItemId: string
    quantity: number
  }>>

  /**
   * Calculate theoretical cost for an order
   */
  calculateTheoreticalCost(orderId: string): Promise<number>
}

// =============================================================================
// EVENTS
// =============================================================================

export interface InventoryEvents {
  /**
   * Fired when an item goes out of stock
   */
  onItemOutOfStock(ingredientId: string, menuItemIds: string[]): void

  /**
   * Fired when stock level changes
   */
  onStockLevelChange(ingredientId: string, newLevel: number, threshold: 'ok' | 'low' | 'critical'): void
}

// =============================================================================
// BRIDGE IMPLEMENTATION PLACEHOLDER
// =============================================================================

export const orderToInventoryBridge: OrderToInventoryBridge = {
  deductInventory: async () => true,
  checkStock: async () => ({ available: true, currentStock: 999, required: 1 }),
  getStockStatus: async () => 'ok',
  reverseDeduction: async () => true,
}

export const inventoryToOrderBridge: InventoryToOrderBridge = {
  getItemsRequiringDeduction: async () => [],
  calculateTheoreticalCost: async () => 0,
}

/**
 * Floor Plan ↔ Order Management Bridge
 *
 * This bridge connects the Floor Plan domain (tables, seats, groups)
 * with the Order Management domain (orders, payments).
 *
 * Use cases:
 * - Floor Plan needs to know if a table has active orders
 * - Order Management needs to know which table/seat an order belongs to
 * - Status changes in one domain affect the other
 */

import type { TableStatus } from '@/domains/floor-plan'
import type { Order, OrderStatus } from '@/domains/order-management'

// =============================================================================
// FLOOR PLAN → ORDER MANAGEMENT
// =============================================================================

/**
 * Methods Floor Plan calls to get Order data
 */
export interface FloorToOrderBridge {
  /**
   * Get the active order for a specific seat
   */
  getActiveOrderForSeat(seatId: string): Promise<Order | null>

  /**
   * Get all active orders for a table (may have multiple for split checks)
   */
  getActiveOrdersForTable(tableId: string): Promise<Order[]>

  /**
   * Get the combined total for a table group
   */
  getOrderTotalForGroup(groupId: string): Promise<number>

  /**
   * Check if a table has any unpaid orders
   */
  hasUnpaidOrders(tableId: string): Promise<boolean>

  /**
   * Get order count for a table (for status display)
   */
  getOrderCountForTable(tableId: string): Promise<number>
}

/**
 * Events Floor Plan emits that Order Management listens to
 */
export interface FloorPlanEvents {
  /**
   * Fired when a table's status changes
   */
  onTableStatusChange(tableId: string, newStatus: TableStatus, previousStatus: TableStatus): void

  /**
   * Fired when a guest is seated at a position
   */
  onSeatAssigned(seatId: string, tableId: string, guestId?: string): void

  /**
   * Fired when seats are cleared
   */
  onSeatsCleared(tableId: string, seatIds: string[]): void

  /**
   * Fired when tables are grouped together
   */
  onGroupCreated(groupId: string, tableIds: string[], isVirtual: boolean): void

  /**
   * Fired when a group is dissolved
   */
  onGroupDissolved(groupId: string, tableIds: string[]): void

  /**
   * Fired when a table is moved to a different server's section
   */
  onTableReassigned(tableId: string, newEmployeeId: string, previousEmployeeId?: string): void
}

// =============================================================================
// ORDER MANAGEMENT → FLOOR PLAN
// =============================================================================

/**
 * Methods Order Management calls to get Floor Plan data
 */
export interface OrderToFloorBridge {
  /**
   * Get the table associated with an order
   */
  getTableForOrder(orderId: string): Promise<{
    id: string
    name: string
    number: number
    roomId: string
  } | null>

  /**
   * Get all seats for a table
   */
  getSeatsForTable(tableId: string): Promise<Array<{
    id: string
    number: number
    isOccupied: boolean
  }>>

  /**
   * Get the assigned server for a table
   */
  getServerForTable(tableId: string): Promise<{
    id: string
    firstName: string
    lastName: string
  } | null>

  /**
   * Get all tables in a group
   */
  getTablesInGroup(groupId: string): Promise<string[]>

  /**
   * Check if a table is part of a group
   */
  isTableInGroup(tableId: string): Promise<{ inGroup: boolean; groupId?: string }>
}

/**
 * Events Order Management emits that Floor Plan listens to
 */
export interface OrderManagementEvents {
  /**
   * Fired when an order is created
   */
  onOrderCreated(orderId: string, tableId?: string, seatId?: string): void

  /**
   * Fired when an order status changes
   */
  onOrderStatusChange(orderId: string, newStatus: OrderStatus, tableId?: string): void

  /**
   * Fired when an order is paid in full
   */
  onOrderPaid(orderId: string, tableId?: string): void

  /**
   * Fired when an item is sent to kitchen
   */
  onItemSentToKitchen(orderId: string, itemId: string, tableId?: string): void

  /**
   * Fired when food is ready for a table
   */
  onFoodReady(orderId: string, tableId?: string): void

  /**
   * Fired when check is printed
   */
  onCheckPrinted(orderId: string, tableId?: string): void
}

// =============================================================================
// BRIDGE IMPLEMENTATION PLACEHOLDER
// =============================================================================

/**
 * Bridge implementation will be added during migration.
 * For now, these are the contracts that both domains must respect.
 */

export const floorToOrderBridge: FloorToOrderBridge = {
  getActiveOrderForSeat: async () => null,
  getActiveOrdersForTable: async () => [],
  getOrderTotalForGroup: async () => 0,
  hasUnpaidOrders: async () => false,
  getOrderCountForTable: async () => 0,
}

export const orderToFloorBridge: OrderToFloorBridge = {
  getTableForOrder: async () => null,
  getSeatsForTable: async () => [],
  getServerForTable: async () => null,
  getTablesInGroup: async () => [],
  isTableInGroup: async () => ({ inGroup: false }),
}

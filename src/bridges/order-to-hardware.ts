/**
 * Order Management ↔ Hardware Bridge
 *
 * Connects orders with hardware (printers, KDS, terminals).
 *
 * Use cases:
 * - Print kitchen tickets when order is sent
 * - Display orders on KDS
 * - Print receipts
 */

// =============================================================================
// ORDER MANAGEMENT → HARDWARE
// =============================================================================

export interface OrderToHardwareBridge {
  /**
   * Send order to kitchen (prints tickets and/or sends to KDS)
   */
  sendToKitchen(orderId: string, items: Array<{
    id: string
    name: string
    quantity: number
    modifiers: string[]
    specialInstructions?: string
    course: number
    seat?: number
  }>): Promise<{ success: boolean; errors: string[] }>

  /**
   * Print a receipt
   */
  printReceipt(orderId: string, options: {
    includeItemized: boolean
    includeTip: boolean
    copies: number
  }): Promise<boolean>

  /**
   * Open cash drawer
   */
  openCashDrawer(terminalId: string): Promise<boolean>

  /**
   * Send to specific printer
   */
  printToStation(stationId: string, content: {
    type: 'ticket' | 'label' | 'receipt'
    data: Record<string, unknown>
  }): Promise<boolean>

  /**
   * Update KDS with item status
   */
  updateKDSItem(orderItemId: string, status: 'cooking' | 'ready' | 'served' | 'bumped'): Promise<boolean>
}

// =============================================================================
// HARDWARE → ORDER MANAGEMENT
// =============================================================================

export interface HardwareToOrderBridge {
  /**
   * Get pending orders for a KDS station
   */
  getPendingOrdersForStation(stationId: string): Promise<Array<{
    orderId: string
    orderNumber: number
    items: Array<{
      id: string
      name: string
      status: string
    }>
    tableName?: string
    createdAt: Date
  }>>

  /**
   * Mark item as ready (from KDS bump)
   */
  markItemReady(orderItemId: string): Promise<boolean>
}

// =============================================================================
// EVENTS
// =============================================================================

export interface HardwareEvents {
  /**
   * Fired when a KDS item is bumped
   */
  onKDSItemBumped(orderItemId: string, stationId: string): void

  /**
   * Fired when printer encounters error
   */
  onPrinterError(printerId: string, error: string): void

  /**
   * Fired when terminal status changes
   */
  onTerminalStatusChange(terminalId: string, status: 'online' | 'offline'): void
}

// =============================================================================
// BRIDGE IMPLEMENTATION PLACEHOLDER
// =============================================================================

export const orderToHardwareBridge: OrderToHardwareBridge = {
  sendToKitchen: async () => ({ success: true, errors: [] }),
  printReceipt: async () => true,
  openCashDrawer: async () => true,
  printToStation: async () => true,
  updateKDSItem: async () => true,
}

export const hardwareToOrderBridge: HardwareToOrderBridge = {
  getPendingOrdersForStation: async () => [],
  markItemReady: async () => true,
}

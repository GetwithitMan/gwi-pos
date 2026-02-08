/**
 * Order API Helper Functions
 *
 * Centralized functions for order operations that enforce the correct
 * API usage patterns to prevent race conditions.
 *
 * CRITICAL RULE:
 * - PUT /api/orders/[id] = Metadata ONLY (no items)
 * - POST /api/orders/[id]/items = Add/update items atomically
 */

// ============================================
// Types
// ============================================

export interface OrderMetadata {
  tabName?: string
  guestCount?: number
  notes?: string
  tipTotal?: number
  tableId?: string
  orderTypeId?: string
  customerId?: string
  status?: string
}

export interface OrderItemInput {
  menuItemId: string
  name: string
  price: number
  quantity: number
  correlationId?: string // Client-provided ID for matching response items
  modifiers: Array<{
    modifierId: string
    name: string
    price: number
    preModifier?: string
    depth?: number
    spiritTier?: string
    linkedBottleProductId?: string
    parentModifierId?: string
  }>
  ingredientModifications?: Array<{
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: {
      modifierId: string
      name: string
      price: number
    }
  }>
  specialNotes?: string
  seatNumber?: number
  courseNumber?: number
  blockTimeMinutes?: number | null
  pizzaConfig?: any
}

// ============================================
// API Functions
// ============================================

/**
 * Updates order metadata only (table, orderType, customer, etc.)
 * Does NOT update items - use appendOrderItems() for that
 *
 * @example
 * await updateOrderMetadata('order-123', { tableId: 'table-456', guestCount: 4 })
 */
export async function updateOrderMetadata(
  orderId: string,
  metadata: OrderMetadata
): Promise<Response> {
  return fetch(`/api/orders/${orderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata)
  })
}

/**
 * Adds or updates items in an order atomically
 * Safe for concurrent use - won't overwrite other changes
 *
 * @example
 * await appendOrderItems('order-123', [
 *   { menuItemId: 'item-1', name: 'Burger', price: 12.99, quantity: 1, modifiers: [] }
 * ])
 */
export async function appendOrderItems(
  orderId: string,
  items: OrderItemInput[]
): Promise<Response> {
  return fetch(`/api/orders/${orderId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
  })
}

/**
 * @deprecated Use updateOrderMetadata() and/or appendOrderItems() instead
 *
 * This function will throw an error in development if items are included.
 * In production, it logs a warning but allows the request (for backward compatibility).
 *
 * PUT with items is deprecated to prevent race conditions.
 */
export async function updateOrder(orderId: string, data: any): Promise<Response> {
  if (data.items && Array.isArray(data.items) && data.items.length > 0) {
    const errorMessage =
      'DEPRECATED: updateOrder() called with items. ' +
      'Use appendOrderItems() instead to prevent race conditions.'

    console.error(errorMessage)

    if (process.env.NODE_ENV === 'development') {
      throw new Error(errorMessage)
    }
  }

  return fetch(`/api/orders/${orderId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

/**
 * Convenience function to update both metadata and items in sequence
 *
 * @example
 * await updateOrderComplete('order-123', {
 *   metadata: { tableId: 'table-456' },
 *   items: [{ menuItemId: 'item-1', name: 'Burger', price: 12.99, quantity: 1, modifiers: [] }]
 * })
 */
export async function updateOrderComplete(
  orderId: string,
  options: {
    metadata?: OrderMetadata
    items?: OrderItemInput[]
  }
): Promise<{ metadataResponse?: Response; itemsResponse?: Response }> {
  const results: { metadataResponse?: Response; itemsResponse?: Response } = {}

  // Update metadata if provided
  if (options.metadata && Object.keys(options.metadata).length > 0) {
    results.metadataResponse = await updateOrderMetadata(orderId, options.metadata)
    if (!results.metadataResponse.ok) {
      throw new Error('Failed to update order metadata')
    }
  }

  // Add/update items if provided
  if (options.items && options.items.length > 0) {
    results.itemsResponse = await appendOrderItems(orderId, options.items)
    if (!results.itemsResponse.ok) {
      throw new Error('Failed to append order items')
    }
  }

  return results
}

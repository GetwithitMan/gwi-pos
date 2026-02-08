/**
 * Batch Update Utilities
 *
 * Helpers for batching database updates to avoid N+1 query problems.
 * FIX-010: Replaces individual updates in loops with efficient batch operations.
 */

import { db } from '@/lib/db'

// ============================================================================
// ORDER ITEM BATCH UPDATES
// ============================================================================

/**
 * Batch update multiple order items at once
 *
 * Instead of:
 *   for (const item of items) {
 *     await db.orderItem.update({ where: { id: item.id }, data: {...} })
 *   }
 *
 * Use:
 *   await batchUpdateOrderItems(items.map(item => ({
 *     id: item.id,
 *     kitchenStatus: 'sent',
 *     firedAt: now,
 *   })))
 *
 * @param updates - Array of { id, ...fields } to update
 * @returns Array of updated items
 */
export async function batchUpdateOrderItems(
  updates: Array<{ id: string; [key: string]: unknown }>
): Promise<void> {
  // Use transaction to batch updates
  await db.$transaction(
    updates.map(({ id, ...data }) =>
      db.orderItem.update({
        where: { id },
        data,
      })
    )
  )
}

/**
 * Batch update order item statuses (optimized for common case)
 *
 * @param itemIds - Array of order item IDs
 * @param status - Status to set for all items
 * @param firedAt - Optional timestamp to set
 */
export async function batchUpdateOrderItemStatus(
  itemIds: string[],
  status: string,
  firedAt?: Date
): Promise<void> {
  const data: Record<string, unknown> = { kitchenStatus: status }
  if (firedAt) {
    data.firedAt = firedAt
  }

  await db.orderItem.updateMany({
    where: { id: { in: itemIds } },
    data,
  })
}

// ============================================================================
// ENTERTAINMENT ITEM BATCH UPDATES
// ============================================================================

/**
 * Batch update menu items for entertainment status
 *
 * @param updates - Array of { menuItemId, status, orderId, orderItemId }
 */
export async function batchUpdateEntertainmentStatus(
  updates: Array<{
    menuItemId: string
    status: 'available' | 'in_use' | 'maintenance'
    currentOrderId?: string | null
    currentOrderItemId?: string | null
  }>
): Promise<void> {
  await db.$transaction(
    updates.map(({ menuItemId, status, currentOrderId, currentOrderItemId }) =>
      db.menuItem.update({
        where: { id: menuItemId },
        data: {
          entertainmentStatus: status,
          currentOrderId: currentOrderId ?? null,
          currentOrderItemId: currentOrderItemId ?? null,
        },
      })
    )
  )
}

/**
 * Batch update floor plan elements for entertainment sessions
 *
 * @param updates - Array of floor plan element updates
 */
export async function batchUpdateFloorPlanElements(
  updates: Array<{
    linkedMenuItemId: string
    status: 'available' | 'in_use' | 'reserved' | 'maintenance'
    currentOrderId?: string | null
    sessionStartedAt?: Date | null
    sessionExpiresAt?: Date | null
  }>
): Promise<void> {
  await db.$transaction(
    updates.map(({ linkedMenuItemId, ...data }) =>
      db.floorPlanElement.updateMany({
        where: {
          linkedMenuItemId,
          deletedAt: null,
        },
        data,
      })
    )
  )
}

// ============================================================================
// COMBINED ENTERTAINMENT UPDATE
// ============================================================================

/**
 * Update both menu item and floor plan element for entertainment item
 * (Convenience function for common pattern)
 *
 * @param menuItemId - Entertainment menu item ID
 * @param orderId - Order ID
 * @param orderItemId - Order item ID
 * @param sessionStart - Session start time
 * @param sessionEnd - Session end time
 */
export async function startEntertainmentSession(
  menuItemId: string,
  orderId: string,
  orderItemId: string,
  sessionStart: Date,
  sessionEnd: Date
): Promise<void> {
  await db.$transaction([
    db.menuItem.update({
      where: { id: menuItemId },
      data: {
        entertainmentStatus: 'in_use',
        currentOrderId: orderId,
        currentOrderItemId: orderItemId,
      },
    }),
    db.floorPlanElement.updateMany({
      where: {
        linkedMenuItemId: menuItemId,
        deletedAt: null,
      },
      data: {
        status: 'in_use',
        currentOrderId: orderId,
        sessionStartedAt: sessionStart,
        sessionExpiresAt: sessionEnd,
      },
    }),
  ])
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Group updates by a key to batch more efficiently
 *
 * Example:
 *   const byStatus = groupBy(items, item => item.status)
 *   // { 'sent': [...], 'held': [...] }
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const groups = {} as Record<K, T[]>
  for (const item of items) {
    const key = keyFn(item)
    if (!groups[key]) {
      groups[key] = []
    }
    groups[key].push(item)
  }
  return groups
}

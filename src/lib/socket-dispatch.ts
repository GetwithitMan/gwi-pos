/**
 * Socket Event Dispatcher
 *
 * Utility for dispatching real-time events from API routes.
 * Works with both local socket server and external services.
 *
 * Usage:
 * ```typescript
 * import { dispatchNewOrder, dispatchItemStatus } from '@/lib/socket-dispatch'
 *
 * // In order send route
 * const routingResult = await OrderRouter.resolveRouting(orderId)
 * await dispatchNewOrder(locationId, routingResult)
 * ```
 */

import type { RoutingResult } from '@/types/routing'

const SOCKET_SERVER_URL = process.env.SOCKET_SERVER_URL || 'http://localhost:3000'
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'dev-internal-secret'

interface DispatchOptions {
  /** Don't await the dispatch (fire and forget) */
  async?: boolean
  /** Log debug information */
  debug?: boolean
}

/**
 * Internal broadcast function
 */
async function broadcast(
  type: string,
  locationId: string,
  data: Record<string, unknown>,
  options: DispatchOptions = {}
): Promise<boolean> {
  const { debug = false } = options

  try {
    const response = await fetch(`${SOCKET_SERVER_URL}/api/internal/socket/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({
        type,
        locationId,
        ...data,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[SocketDispatch] Broadcast failed: ${errorText}`)
      return false
    }

    if (debug) {
      console.log(`[SocketDispatch] Broadcast ${type} to location ${locationId}`)
    }

    return true
  } catch (error) {
    // Socket dispatch failures should not block the main operation
    console.error('[SocketDispatch] Failed to dispatch:', error)
    return false
  }
}

/**
 * Dispatch new order event to KDS screens
 *
 * Called after OrderRouter.resolveRouting() completes.
 * Sends order data to each station's tag-based room.
 */
export async function dispatchNewOrder(
  locationId: string,
  routingResult: RoutingResult,
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('NEW_ORDER', locationId, { routingResult }, options)

  if (options.async) {
    // Fire and forget
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch item status change (cooking/ready/served)
 *
 * Called when an item's status is updated on a KDS screen.
 * Propagates to expo and all other listening stations.
 */
export async function dispatchItemStatus(
  locationId: string,
  payload: {
    orderId: string
    itemId: string
    status: string
    stationId: string
    updatedBy: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('ITEM_STATUS', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch order bumped event
 *
 * Called when an order is bumped from a KDS station.
 * Notifies expo and other stations to update their displays.
 */
export async function dispatchOrderBumped(
  locationId: string,
  payload: {
    orderId: string
    stationId: string
    bumpedBy: string
    allItemsServed: boolean
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('ORDER_BUMPED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch entertainment session update
 *
 * Called when entertainment timer starts/extends/stops.
 * Keeps all displays in sync (Pit Boss dashboard, POS terminals).
 */
export async function dispatchEntertainmentUpdate(
  locationId: string,
  payload: {
    sessionId: string
    tableId: string
    tableName: string
    action: 'started' | 'extended' | 'stopped' | 'warning'
    expiresAt: string | null
    addedMinutes?: number
    partyName?: string
    virtualGroupId?: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('ENTERTAINMENT_UPDATE', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch location-wide alert
 *
 * Used for system alerts (sync status, hardware failures, etc.)
 */
export async function dispatchLocationAlert(
  locationId: string,
  payload: {
    type: 'info' | 'warning' | 'error' | 'success'
    title: string
    message: string
    dismissable?: boolean
    duration?: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('LOCATION_ALERT', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch void approval status update (Skill 121)
 *
 * Called when a remote void approval is approved/rejected.
 * Notifies the requesting POS terminal to update the modal.
 */
export async function dispatchVoidApprovalUpdate(
  locationId: string,
  payload: {
    type: 'approved' | 'rejected' | 'expired'
    approvalId: string
    terminalId?: string
    approvalCode?: string
    managerName: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('VOID_APPROVAL', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch floor plan update event
 *
 * Called when tables or entertainment elements are added/updated/deleted.
 * Notifies all POS terminals to refresh their floor plan view.
 */
export async function dispatchFloorPlanUpdate(
  locationId: string,
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('FLOOR_PLAN_UPDATE', locationId, {}, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch inventory stock adjustment event (Skill 127)
 *
 * Called when ingredient stock is adjusted via Quick Stock Adjust page.
 * Notifies all terminals to update stock displays in real-time.
 */
export async function dispatchInventoryAdjustment(
  locationId: string,
  payload: {
    adjustments: Array<{
      ingredientId: string
      name: string
      previousStock: number
      newStock: number
      change: number
      unit: string
    }>
    adjustedById: string
    adjustedByName: string
    totalItems: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('INVENTORY_ADJUSTMENT', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch single stock level change (for POS menu item badges)
 *
 * Used for real-time stock level updates on menu items.
 */
export async function dispatchStockLevelChange(
  locationId: string,
  payload: {
    ingredientId: string
    name: string
    currentStock: number
    previousStock: number
    unit: string
    stockLevel: 'critical' | 'low' | 'ok' | 'good'
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('STOCK_LEVEL_CHANGE', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch menu update event
 *
 * Called when menu items are added, removed, or modified.
 * Notifies all POS terminals and admin pages to refresh menu data.
 */
export async function dispatchMenuUpdate(
  locationId: string,
  payload: {
    action: 'created' | 'updated' | 'deleted' | 'restored'
    menuItemId?: string
    bottleId?: string
    name?: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('MENU_UPDATE', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch ingredient library update event (Worker 7)
 *
 * Called when a new ingredient (inventory or prep item) is created inline.
 * Provides real-time updates to all menu builder terminals.
 */
export async function dispatchIngredientLibraryUpdate(
  locationId: string,
  payload: {
    ingredient: {
      id: string
      name: string
      categoryId: string
      parentIngredientId: string | null
      isBaseIngredient: boolean
    }
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('INGREDIENT_LIBRARY_UPDATE', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch menu item change event (for online ordering)
 *
 * Called when a menu item is created, updated, deleted, or restored.
 * Allows online ordering UI to update in real-time without polling.
 */
export async function dispatchMenuItemChanged(
  locationId: string,
  payload: {
    itemId: string
    action: 'created' | 'updated' | 'deleted' | 'restored'
    changes?: Record<string, unknown>
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('MENU_ITEM_CHANGED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch menu stock change event (for online ordering)
 *
 * Called when an item's stock status changes (e.g., in_stock → out_of_stock).
 * Allows online ordering to immediately show "Sold Out" without polling.
 */
export async function dispatchMenuStockChanged(
  locationId: string,
  payload: {
    itemId: string
    stockStatus: 'in_stock' | 'low_stock' | 'critical' | 'out_of_stock'
    isOrderableOnline: boolean
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('MENU_STOCK_CHANGED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch menu structure change event
 *
 * Called when categories or modifier groups are added/updated/deleted.
 * Notifies menu builders and admin UIs to refresh structure.
 */
export async function dispatchMenuStructureChanged(
  locationId: string,
  payload: {
    action: 'category-created' | 'category-updated' | 'category-deleted' | 'modifier-group-updated'
    entityId: string
    entityType: 'category' | 'modifier-group'
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('MENU_STRUCTURE_CHANGED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch entertainment status change event
 *
 * Called when entertainment item status changes (available → in_use, etc.).
 * Replaces polling for entertainment category status updates.
 */
export async function dispatchEntertainmentStatusChanged(
  locationId: string,
  payload: {
    itemId: string
    entertainmentStatus: 'available' | 'in_use' | 'reserved' | 'maintenance'
    currentOrderId: string | null
    expiresAt: string | null
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('ENTERTAINMENT_STATUS_CHANGED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch order totals update (FIX-011)
 *
 * Called when order totals change (items added, tip updated, discount applied).
 * Updates all connected clients with new order totals in real-time.
 *
 * @param locationId - Location ID for room scoping
 * @param orderId - Order ID that was updated
 * @param totals - Updated order totals
 * @param options - Dispatch options (async, debug)
 *
 * Example:
 *   await dispatchOrderTotalsUpdate(locationId, orderId, {
 *     subtotal: 50.00,
 *     taxTotal: 4.00,
 *     tipTotal: 8.00,
 *     discountTotal: 0,
 *     total: 62.00,
 *   }, { async: true })
 */
export async function dispatchOrderTotalsUpdate(
  locationId: string,
  orderId: string,
  totals: {
    subtotal: number
    taxTotal: number
    tipTotal: number
    discountTotal: number
    total: number
    commissionTotal?: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('ORDER_TOTALS_UPDATE', locationId, {
    orderId,
    totals,
    timestamp: new Date().toISOString(),
  }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch open orders list changed notification
 * Fired when orders are created, paid, voided, or transferred
 */
export async function dispatchOpenOrdersChanged(
  locationId: string,
  payload: {
    trigger: 'created' | 'paid' | 'voided' | 'transferred' | 'reopened'
    orderId?: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('OPEN_ORDERS_CHANGED', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async open orders dispatch failed:', err))
    return true
  }

  return promise
}

/**
 * Dispatch tip group update event (Skill 252)
 *
 * Called when tip group membership changes, group created/closed, etc.
 * Keeps all bartender terminals in sync with group state.
 */
export async function dispatchTipGroupUpdate(
  locationId: string,
  payload: {
    action: 'created' | 'member-joined' | 'member-left' | 'closed' | 'ownership-transferred' | 'tip-received'
    groupId: string
    employeeId?: string
    employeeName?: string
    newOwnerId?: string
    tipAmountCents?: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const promise = broadcast('TIP_GROUP_UPDATE', locationId, { payload }, options)

  if (options.async) {
    promise.catch((err) => console.error('[SocketDispatch] Async tip group dispatch failed:', err))
    return true
  }

  return promise
}

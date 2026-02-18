/**
 * Socket Event Dispatcher
 *
 * Utility for dispatching real-time events from API routes.
 * Calls emitToLocation/emitToTags directly (in-process) instead of
 * going through the HTTP broadcast route.
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
import { emitToLocation, emitToTags } from '@/lib/socket-server'

interface DispatchOptions {
  /** Don't await the dispatch (fire and forget) */
  async?: boolean
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
  const doEmit = async () => {
    try {
      // Emit to each station's tags
      for (const manifest of routingResult.manifests) {
        const orderEvent = {
          orderId: routingResult.order.orderId,
          orderNumber: routingResult.order.orderNumber,
          orderType: routingResult.order.orderType,
          tableName: routingResult.order.tableName,
          tabName: routingResult.order.tabName,
          employeeName: routingResult.order.employeeName,
          createdAt: routingResult.order.createdAt.toISOString(),
          primaryItems: manifest.primaryItems.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            seatNumber: item.seatNumber,
            specialNotes: item.specialNotes,
            sourceTableName: item.sourceTableName,
            modifiers: item.modifiers.map((m) => ({
              name: m.name,
              preModifier: m.preModifier,
            })),
            isPizza: item.isPizza,
            isBar: item.isBar,
            pizzaData: item.pizzaData,
          })),
          referenceItems: manifest.referenceItems.map((item) => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            stationName: manifest.stationName,
          })),
          matchedTags: manifest.matchedTags,
          stationId: manifest.stationId,
          stationName: manifest.stationName,
        }

        await emitToTags(manifest.matchedTags, 'kds:order-received', orderEvent)
      }

      // Also emit to location for general awareness
      await emitToLocation(locationId, 'order:created', {
        orderId: routingResult.order.orderId,
        orderNumber: routingResult.order.orderNumber,
        stations: routingResult.manifests.map((m) => m.stationName),
      })

      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToTags(['expo'], 'kds:item-status', payload)
      await emitToLocation(locationId, 'kds:item-status', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToTags(['expo'], 'kds:order-bumped', payload)
      await emitToLocation(locationId, 'kds:order-bumped', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToTags(['entertainment'], 'entertainment:session-update', payload)
      await emitToLocation(locationId, 'entertainment:session-update', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch location-wide alert
 *
 * Used for system alerts (sync status, hardware failures, etc.)
 * Called from health-check route. No client-side alert UI wired yet.
 * // TODO: Wire to a location-wide toast/banner component when alert UI is built
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'location:alert', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'void:approval-update', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'floor-plan:updated', { locationId })
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch inventory stock adjustment event (Skill 127)
 *
 * Called when ingredient stock is adjusted via Quick Stock Adjust page.
 * Notifies all terminals to update stock displays in real-time.
 * // TODO: Wire to inventory dashboard when built
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'inventory:adjustment', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch single stock level change (for POS menu item badges)
 *
 * Used for real-time stock level updates on menu items.
 * Client listener: SocketEventProvider forwards via onAny → subscribe('inventory:stock-change')
 * Drives 86'd item display on POS terminals.
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'inventory:stock-change', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'menu:updated', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'ingredient:library-update', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch menu item change event (for online ordering)
 *
 * Called when a menu item is created, updated, deleted, or restored.
 * Allows online ordering UI to update in real-time without polling.
 * Used alongside menu:updated (dispatchMenuUpdate) for granular item-level changes.
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'menu:item-changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch menu stock change event (for online ordering)
 *
 * Called when an item's stock status changes (e.g., in_stock -> out_of_stock).
 * Allows online ordering to immediately show "Sold Out" without polling.
 * Client listener: SocketEventProvider forwards via onAny → subscribe('menu:stock-changed')
 * Works alongside inventory:stock-change for POS 86'd item display.
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'menu:stock-changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch menu structure change event
 *
 * Called when categories or modifier groups are added/updated/deleted.
 * Notifies menu builders and admin UIs to refresh structure.
 * Used alongside menu:updated (dispatchMenuUpdate) for granular structure-level changes.
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'menu:structure-changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch entertainment status change event
 *
 * Called when entertainment item status changes (available -> in_use, etc.).
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'entertainment:status-changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order totals update (FIX-011)
 *
 * Called when order totals change (items added, tip updated, discount applied).
 * Updates all connected clients with new order totals in real-time.
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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:totals-updated', {
        orderId,
        totals,
        timestamp: new Date().toISOString(),
      })
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async dispatch failed:', err))
    return true
  }

  return doEmit()
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
    tableId?: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'orders:list-changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async open orders dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch tip group update event (Skill 252)
 *
 * Called when tip group membership changes, group created/closed, etc.
 * Keeps all bartender terminals in sync with group state.
 * // TODO: Wire to bartender tip group UI when built
 */

/**
 * Dispatch payment processed event
 *
 * Called after a successful payment DB write.
 * Notifies all terminals that a payment was processed on an order.
 */
export async function dispatchPaymentProcessed(
  locationId: string,
  data: { orderId: string; paymentId?: string; status: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'payment:processed', data)
    return true
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch payment:processed:', error)
    return false
  }
}

/**
 * Dispatch order updated event
 *
 * Called after order metadata is updated (tab name, guest count, etc.).
 * Notifies all terminals to refresh order data.
 */
export async function dispatchOrderUpdated(
  locationId: string,
  data: { orderId: string; changes?: string[] }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'order:updated', data)
    return true
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch order:updated:', error)
    return false
  }
}

/**
 * Dispatch tab updated event
 *
 * Called after tab status changes (opened, closed, captured).
 * Notifies all terminals to refresh tab state.
 */
export async function dispatchTabUpdated(
  locationId: string,
  data: { orderId: string; status?: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'tab:updated', data)
    return true
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch tab:updated:', error)
    return false
  }
}

/**
 * Dispatch table status changed event
 *
 * Called when a table's status changes (available, occupied, reserved, etc.).
 * Notifies all terminals to update floor plan table indicators.
 */
export async function dispatchTableStatusChanged(
  locationId: string,
  data: { tableId: string; status?: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'table:status-changed', data)
    return true
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch table:status-changed:', error)
    return false
  }
}

/**
 * Dispatch order item added event
 *
 * Called after new items are appended to an order.
 * Notifies all terminals to refresh order item lists.
 */
export async function dispatchOrderItemAdded(
  locationId: string,
  data: { orderId: string; itemId?: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'order:item-added', data)
    return true
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch order:item-added:', error)
    return false
  }
}

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
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'tip-group:updated', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async tip group dispatch failed:', err))
    return true
  }

  return doEmit()
}

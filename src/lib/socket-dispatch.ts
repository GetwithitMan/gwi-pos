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
import type { WeightReading } from '@/lib/scale/scale-protocol'
import { emitToLocation, emitToTags, emitToRoom, emitToTerminal, emitCriticalToLocation } from '@/lib/socket-server'
import { CFD_EVENTS, MOBILE_EVENTS } from '@/types/multi-surface'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'

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
            // Pricing option label
            pricingOptionLabel: item.pricingOptionLabel ?? null,
            // Weight-based item fields
            weight: item.weight ? Number(item.weight) : null,
            weightUnit: item.weightUnit ?? null,
            unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
            soldByWeight: item.soldByWeight ?? false,
            tareWeight: item.tareWeight ? Number(item.tareWeight) : null,
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

        await emitToTags(manifest.matchedTags, 'kds:order-received', orderEvent, locationId)
      }

      // Also emit to location for general awareness (enriched for Android)
      await emitToLocation(locationId, 'order:created', {
        orderId: routingResult.order.orderId,
        orderNumber: routingResult.order.orderNumber,
        orderType: routingResult.order.orderType,
        tableName: routingResult.order.tableName,
        tabName: routingResult.order.tabName,
        employeeName: routingResult.order.employeeName,
        createdAt: routingResult.order.createdAt.toISOString(),
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
      await emitToTags(['expo'], 'kds:item-status', payload, locationId)
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
      await emitToTags(['expo'], 'kds:order-bumped', payload, locationId)
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
      await emitToTags(['entertainment'], 'entertainment:session-update', payload, locationId)
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
 * Called from health-check route.
 * Client listener: LocationAlertListener (root layout) → toast store
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
  // Invalidate snapshot cache so next request gets fresh data
  invalidateSnapshotCache(locationId)

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
 * No client listener wired yet — reserved for future inventory admin dashboard.
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
 *
 * TODO: Wire client-side listener for 86'd badge on POS terminals.
 * The POS menu grid needs to subscribe to `inventory:stock-change` via useSocket()
 * and overlay an "86'd" badge on items whose stockLevel transitions to 'critical'
 * or when currentStock hits 0. This requires:
 *   1. A menu item state layer (Zustand store or context) to hold per-item stock status
 *   2. A socket listener in the POS layout or menu component that calls
 *      socket.on('inventory:stock-change', (payload) => updateItemStockStatus(payload))
 *   3. The menu grid component to read stock status and render the 86'd badge
 * See also: src/app/(admin)/86/page.tsx for the admin 86 management UI.
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
 * Dispatch entertainment waitlist notification
 * Emitted when a waitlist customer is added, notified, seated, cancelled, or expired
 */
export async function dispatchEntertainmentWaitlistNotify(
  locationId: string,
  payload: {
    entryId: string
    customerName: string | null
    elementId: string | null
    elementName: string | null
    partySize: number
    action: 'added' | 'notified' | 'seated' | 'cancelled' | 'expired'
    message: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'entertainment:waitlist-notify', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch waitlist notify:', error)
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
    trigger: 'created' | 'paid' | 'voided' | 'transferred' | 'reopened' | 'sent' | 'item_updated' | 'payment_updated' | 'updated' | 'cancelled'
    orderId?: string
    tableId?: string
    orderNumber?: number
    status?: string
    sourceTerminalId?: string
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
  data: { orderId: string; paymentId?: string; status: string; sourceTerminalId?: string }
): Promise<boolean> {
  try {
    // QoS 1: critical financial event — acknowledged delivery with retry
    await emitCriticalToLocation(locationId, 'payment:processed', data)
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

// Mobile: notify phone that tab was successfully closed
export function dispatchTabClosed(locationId: string, data: { orderId: string; total: number; tipAmount: number }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_CLOSED, data).catch(console.error)
}

// Mobile: update phone with current tab status
export function dispatchTabStatusUpdate(locationId: string, data: { orderId: string; status: string }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_STATUS_UPDATE, data).catch(console.error)
}

// Mobile: notify phone that tab items were updated
export function dispatchTabItemsUpdated(locationId: string, data: { orderId: string; itemCount: number }): void {
  void emitToLocation(locationId, MOBILE_EVENTS.TAB_ITEMS_UPDATED, data).catch(console.error)
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

/**
 * Dispatch order editing awareness event
 *
 * Called when a terminal opens an order for editing.
 * Notifies other terminals that this order is being edited elsewhere.
 */
export async function dispatchOrderEditing(
  locationId: string,
  payload: {
    orderId: string
    terminalId: string
    terminalName: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:editing', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:editing:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:editing dispatch failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order editing released event
 *
 * Called when a terminal stops editing an order (navigates away or closes it).
 * Clears the "editing on another terminal" banner on other terminals.
 */
export async function dispatchOrderEditingReleased(
  locationId: string,
  payload: {
    orderId: string
    terminalId: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:editing-released', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:editing-released:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:editing-released dispatch failed:', err))
    return true
  }

  return doEmit()
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

// CFD Events (P2-H03)

/**
 * Dispatch CFD show-order event
 *
 * Called when the payment modal opens with order data.
 * Sends order line items and totals to the Customer-Facing Display.
 */
export function dispatchCFDShowOrder(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  orderNumber: number
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[] }>
  subtotal: number
  tax: number
  total: number
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SHOW_ORDER, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER, data).catch(console.error)
  }
}

/**
 * Dispatch CFD show-order-detail event
 *
 * Called just before payment to show the customer a full itemized confirmation
 * on the CFD screen. Includes item names, quantities, prices, and modifiers.
 */
export function dispatchCFDShowOrderDetail(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  orderNumber: number
  items: Array<{ name: string; quantity: number; price: number; modifiers?: string[] }>
  subtotal: number
  tax: number
  total: number
  discountTotal?: number
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SHOW_ORDER_DETAIL, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SHOW_ORDER_DETAIL, data).catch(console.error)
  }
}

/**
 * Dispatch CFD payment-started event
 *
 * Called when the card reader is activated for a transaction.
 * Transitions the CFD from the order screen to the payment screen.
 */
export function dispatchCFDPaymentStarted(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  amount: number
  paymentMethod: string
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.PAYMENT_STARTED, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.PAYMENT_STARTED, data).catch(console.error)
  }
}

/**
 * Dispatch CFD tip-prompt event
 *
 * Called when the tip selection step is shown to the cashier.
 * Optionally mirrors tip options to the CFD screen.
 */
export function dispatchCFDTipPrompt(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  subtotal: number
  suggestedTips: Array<{ label: string; percent: number; amount: number }>
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.TIP_PROMPT, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.TIP_PROMPT, data).catch(console.error)
  }
}

/**
 * Dispatch CFD signature-request event
 *
 * Called when the payment terminal requires a signature from the customer.
 * Transitions the CFD to the signature capture screen.
 */
export function dispatchCFDSignatureRequest(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  transactionId?: string
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.SIGNATURE_REQUEST, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.SIGNATURE_REQUEST, data).catch(console.error)
  }
}

/**
 * Dispatch CFD receipt-sent event
 *
 * Called after a successful payment DB write when the order is fully paid.
 * Transitions the CFD to the receipt/thank-you screen.
 */
export function dispatchCFDReceiptSent(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  total: number
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.RECEIPT_SENT, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.RECEIPT_SENT, data).catch(console.error)
  }
}

/**
 * Dispatch CFD processing event
 *
 * Called when the card authorization starts (waiting for processor response).
 * Transitions the CFD to the processing spinner screen.
 */
export function dispatchCFDProcessing(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.PROCESSING, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.PROCESSING, data).catch(console.error)
  }
}

/**
 * Dispatch CFD approved event
 *
 * Called when the card payment is approved.
 * Transitions the CFD to the approved/thank-you screen.
 */
export function dispatchCFDApproved(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  last4?: string
  cardType?: string
  tipAmount?: number
  total?: number
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.APPROVED, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.APPROVED, data).catch(console.error)
  }
}

/**
 * Dispatch CFD declined event
 *
 * Called when the card payment is declined.
 * Transitions the CFD to the declined screen with reason text.
 */
export function dispatchCFDDeclined(locationId: string, cfdTerminalId: string | null, data: {
  terminalId?: string
  orderId: string
  reason: string
}): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.DECLINED, data).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.DECLINED, data).catch(console.error)
  }
}

/**
 * Dispatch CFD idle event
 *
 * Called after payment completes (success or cancel) to return CFD to idle screen.
 */
export function dispatchCFDIdle(locationId: string, cfdTerminalId: string | null): void {
  if (cfdTerminalId) {
    void emitToTerminal(cfdTerminalId, CFD_EVENTS.IDLE, {}).catch(console.error)
  } else {
    void emitToLocation(locationId, CFD_EVENTS.IDLE, {}).catch(console.error)
  }
}

// ==================== Order Summary Events (Android cross-terminal sync) ====================

/**
 * Order summary payload for cross-terminal sync.
 * Android can upsert this directly into its open-orders list.
 * All monetary values are in cents (integers) for Long compatibility.
 */
export interface OrderSummaryPayload {
  orderId: string
  orderNumber: number
  status: string
  tableId: string | null
  tableName: string | null
  tabName: string | null
  guestCount: number
  employeeId: string | null
  subtotalCents: number
  taxTotalCents: number
  discountTotalCents: number
  tipTotalCents: number
  totalCents: number
  itemCount: number
  updatedAt: string       // ISO timestamp
  locationId: string
}

/**
 * Build an OrderSummaryPayload from a Prisma order object.
 * Accepts any shape that has the required fields (Order, updatedOrder, etc.)
 */
export function buildOrderSummary(order: any): OrderSummaryPayload {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    tableId: order.tableId || null,
    tableName: order.table?.name || null,
    tabName: order.tabName || null,
    guestCount: order.guestCount ?? 0,
    employeeId: order.employeeId || null,
    subtotalCents: Math.round(Number(order.subtotal) * 100),
    taxTotalCents: Math.round(Number(order.taxTotal) * 100),
    discountTotalCents: Math.round(Number(order.discountTotal) * 100),
    tipTotalCents: Math.round(Number(order.tipTotal) * 100),
    totalCents: Math.round(Number(order.total) * 100),
    itemCount: order.itemCount ?? 0,
    updatedAt: (order.updatedAt ?? new Date()).toISOString?.() ?? new Date().toISOString(),
    locationId: order.locationId,
  }
}

/**
 * Dispatch order:summary-updated event for Android cross-terminal sync.
 *
 * Fires ALONGSIDE existing events (order:totals-updated, orders:list-changed).
 * Android terminals upsert this payload into their open-orders list.
 *
 * Called from: addItems, sendToKitchen, applyDiscount, comp/void, pay, close-tab.
 */
export async function dispatchOrderSummaryUpdated(
  locationId: string,
  summary: OrderSummaryPayload,
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:summary-updated', summary)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:summary-updated:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:summary-updated failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order:closed event when an order is paid/closed/voided/cancelled.
 *
 * Android terminals remove this order from their open-orders list.
 */
export async function dispatchOrderClosed(
  locationId: string,
  payload: {
    orderId: string
    status: string           // 'paid' | 'closed' | 'voided' | 'cancelled'
    closedAt: string         // ISO timestamp
    closedByEmployeeId: string | null
    locationId: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      // QoS 1: critical financial event — acknowledged delivery with retry
      await emitCriticalToLocation(locationId, 'order:closed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:closed:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:closed failed:', err))
    return true
  }

  return doEmit()
}

// ==================== Outage Status Events ====================

/**
 * Dispatch sync:outage-status event to all connected clients.
 *
 * Emitted by the upstream sync worker when outage state transitions:
 * - false → true: Internet lost (3 consecutive Neon failures)
 * - true → false: Internet restored
 *
 * Client listener: OutageBanner listens for this to show/hide the offline banner.
 */
export async function dispatchOutageStatus(
  locationId: string,
  isInOutage: boolean,
): Promise<void> {
  try {
    await emitToLocation(locationId, 'sync:outage-status', { isInOutage })
  } catch (error) {
    console.error('[SocketDispatch] Failed to dispatch sync:outage-status:', error)
  }
}

// ==================== HA Failover Events ====================

/**
 * Dispatch server:failover-active event to all connected clients.
 *
 * Emitted when the health API detects this NUC is running as a promoted backup
 * (pgRole === 'primary' but STATION_ROLE === 'backup'). All web POS terminals
 * show a yellow "Backup Server Active" banner.
 */
export async function dispatchFailoverActive(
  locationId: string,
  payload: {
    message: string
    since: string  // ISO timestamp of when failover was detected
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'server:failover-active', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch server:failover-active:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async failover-active failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch server:failover-resolved event to all connected clients.
 *
 * Emitted when the original primary comes back and this node returns to backup role.
 * Clears the "Backup Server Active" banner on all web POS terminals.
 */
export async function dispatchFailoverResolved(
  locationId: string,
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'server:failover-resolved', {
        resolvedAt: new Date().toISOString(),
      })
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch server:failover-resolved:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async failover-resolved failed:', err))
    return true
  }

  return doEmit()
}

// ==================== Scale Events ====================

/**
 * Dispatch scale weight reading to scale room subscribers
 *
 * Called by ScaleService on each parsed weight reading.
 * Emits to `scale:{scaleId}` room so only terminals watching this scale receive updates.
 */
export function dispatchScaleWeight(
  locationId: string,
  scaleId: string,
  reading: WeightReading
): void {
  void emitToRoom(`scale:${scaleId}`, 'scale:weight', {
    scaleId,
    weight: reading.weight,
    unit: reading.unit,
    stable: reading.stable,
    grossNet: reading.grossNet,
    overCapacity: reading.overCapacity,
    timestamp: reading.timestamp.toISOString(),
  }).catch(console.error)
}

/**
 * Dispatch scale connection status change to location room
 *
 * Called by ScaleService on connect/disconnect/error events.
 * All terminals in the location receive status updates.
 */
export function dispatchScaleStatus(
  locationId: string,
  scaleId: string,
  status: { connected: boolean; error?: string }
): void {
  void emitToLocation(locationId, 'scale:status', {
    scaleId,
    connected: status.connected,
    error: status.error ?? null,
    timestamp: new Date().toISOString(),
  }).catch(console.error)
}

// ==================== Order Claim Events ====================

/**
 * Dispatch order:claimed event when a terminal claims (soft-locks) an order.
 *
 * All terminals receive this so they can show "Order open on [terminal]" indicators.
 * Claim expires after 60 seconds if not refreshed (heartbeat).
 */
export async function dispatchOrderClaimed(
  locationId: string,
  payload: {
    orderId: string
    employeeId: string
    employeeName: string | null
    terminalId: string | null
    claimedAt: string // ISO timestamp
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:claimed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:claimed:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:claimed failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order:released event when a terminal releases its claim on an order.
 *
 * Clears the "Order open on [terminal]" indicator on all terminals.
 */
export async function dispatchOrderReleased(
  locationId: string,
  payload: {
    orderId: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:released', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch order:released:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async order:released failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch waitlist changed event
 * Emitted on any waitlist mutation (add, status change, remove)
 */
export async function dispatchWaitlistChanged(
  locationId: string,
  payload: {
    action: 'added' | 'notified' | 'seated' | 'cancelled' | 'no_show' | 'removed'
    entryId: string
    customerName: string
    partySize: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'waitlist:changed', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch waitlist:changed:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async waitlist:changed failed:', err))
    return true
  }

  return doEmit()
}

/**
 * Dispatch cover charge entry recorded event.
 *
 * Called when a new cover charge / door entry is recorded.
 * Updates the Door Count dashboard widget in real-time.
 */
export async function dispatchCoverEntryRecorded(
  locationId: string,
  payload: {
    id: string
    amount: number
    paymentMethod: string
    guestCount: number
    isVip: boolean
    isComped: boolean
    employeeId: string
    createdAt: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'cover:entry-recorded', payload)
      return true
    } catch (error) {
      console.error('[SocketDispatch] Failed to dispatch cover:entry-recorded:', error)
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => console.error('[SocketDispatch] Async cover:entry-recorded failed:', err))
    return true
  }

  return doEmit()
}

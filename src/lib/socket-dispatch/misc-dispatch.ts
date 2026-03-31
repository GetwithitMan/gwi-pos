/**
 * Miscellaneous domain socket dispatchers
 *
 * Handles: entertainment, inventory, menu, location alerts, void approval,
 * waitlist, print jobs, quick bar, membership, shift requests, venue logs,
 * reservations, cake orders, modifiers, settings.
 */

import { db } from '@/lib/db'
import {
  log,
  emitToLocation,
  emitToTags,
  type DispatchOptions,
} from './emit-helpers'

// ==================== Entertainment ====================

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
    action: 'started' | 'extended' | 'stopped' | 'warning' | 'comped' | 'voided' | 'force_stopped' | 'time_override'
    expiresAt: string | null
    startedAt?: string | null
    addedMinutes?: number
    partyName?: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const enrichedPayload = {
    ...payload,
    startedAt: payload.startedAt ?? null,
    minutesRemaining: payload.expiresAt
      ? Math.max(0, Math.round((new Date(payload.expiresAt).getTime() - Date.now()) / 60000))
      : null,
    serverTime: new Date().toISOString(),
  }

  const doEmit = async () => {
    try {
      await Promise.all([
        emitToTags(['entertainment'], 'entertainment:session-update', enrichedPayload, locationId),
        emitToLocation(locationId, 'entertainment:session-update', enrichedPayload),
      ])
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
  // Enrich payload with full item snapshot for native incremental updates
  let enrichedPayload: Record<string, unknown> = { ...payload }

  try {
    const now = new Date()

    // Fetch MenuItem + category + linked FloorPlanElement in parallel
    const [menuItem, floorPlanElement, waitlistCount] = await Promise.all([
      // eslint-disable-next-line no-restricted-syntax
      db.menuItem.findUnique({
        where: { id: payload.itemId },
        select: {
          id: true,
          name: true,
          blockTimeMinutes: true,
          currentOrderId: true,
          currentOrderItemId: true,
          category: { select: { id: true, name: true } },
        },
      }),
      db.floorPlanElement.findFirst({
        where: {
          linkedMenuItemId: payload.itemId,
          locationId,
          deletedAt: null,
          elementType: 'entertainment',
        },
        select: {
          id: true,
          name: true,
          sessionStartedAt: true,
          sessionExpiresAt: true,
          currentOrderId: true,
        },
      }),
      db.floorPlanElement.findFirst({
        where: {
          linkedMenuItemId: payload.itemId,
          locationId,
          deletedAt: null,
          elementType: 'entertainment',
        },
        select: { id: true },
      }).then(async (fpe) => {
        if (!fpe) return 0
        return db.entertainmentWaitlist.count({
          where: {
            elementId: fpe.id,
            status: 'waiting',
            deletedAt: null,
          },
        })
      }),
    ])

    // Build timeInfo from FloorPlanElement session data
    let timeInfo: Record<string, unknown> | null = null
    const fpeExpiresAt = floorPlanElement?.sessionExpiresAt
    const fpeStartedAt = floorPlanElement?.sessionStartedAt

    if (fpeExpiresAt) {
      const remaining = Math.max(0, Math.round((new Date(fpeExpiresAt).getTime() - now.getTime()) / 60000))
      timeInfo = {
        type: 'block',
        expiresAt: fpeExpiresAt.toISOString(),
        startedAt: fpeStartedAt?.toISOString() || null,
        minutesRemaining: remaining,
        blockMinutes: menuItem?.blockTimeMinutes || null,
      }
    } else if (fpeStartedAt) {
      timeInfo = {
        type: 'per_minute',
        expiresAt: null,
        startedAt: fpeStartedAt.toISOString(),
        minutesRemaining: null,
        blockMinutes: menuItem?.blockTimeMinutes || null,
      }
    }

    // Build currentOrder snapshot
    let currentOrder: Record<string, unknown> | null = null
    const orderId = floorPlanElement?.currentOrderId || payload.currentOrderId || menuItem?.currentOrderId
    if (orderId && payload.entertainmentStatus === 'in_use') {
      const order = await db.orderSnapshot.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          tabName: true,
          orderNumber: true,
          displayNumber: true,
        },
      })
      if (order) {
        currentOrder = {
          orderId: order.id,
          tabName: order.tabName || `Order #${order.displayNumber || order.orderNumber}`,
          orderNumber: order.orderNumber,
          displayNumber: order.displayNumber,
        }
      }
    }

    enrichedPayload = {
      ...payload,
      timeInfo,
      waitlistCount,
      displayName: floorPlanElement?.name || menuItem?.name || null,
      category: menuItem?.category
        ? { id: menuItem.category.id, name: menuItem.category.name }
        : null,
      currentOrder,
    }
  } catch (enrichError) {
    // If enrichment fails, still dispatch the original payload
    log.error({ err: enrichError }, 'Entertainment enrichment failed, dispatching base payload')
  }

  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'entertainment:status-changed', enrichedPayload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
    action: 'added' | 'notified' | 'seated' | 'cancelled' | 'expired' | 'deposit-collected' | 'deposit-refunded'
    message: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'entertainment:waitlist-notify', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch waitlist notify')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch entertainment waitlist count change
 * Updates all POS terminals with the new waitlist count for a menu item.
 * Called from waitlist add/remove/seat/cancel operations.
 */
export async function dispatchEntertainmentWaitlistChanged(
  locationId: string,
  payload: {
    itemId: string
    waitlistCount: number
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'entertainment:waitlist-changed', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch waitlist changed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Location Alerts ====================

/**
 * Dispatch location-wide alert
 *
 * Used for system alerts (sync status, hardware failures, etc.)
 * Called from health-check route.
 * Client listener: LocationAlertListener (root layout) -> toast store
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Void Approval ====================

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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Inventory ====================

/**
 * Dispatch inventory stock adjustment event (Skill 127)
 *
 * Called when ingredient stock is adjusted via Quick Stock Adjust page.
 * No client listener wired yet -- reserved for future inventory admin dashboard.
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Menu ====================

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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch menu stock change event (for online ordering)
 *
 * Called when an item's stock status changes (e.g., in_stock -> out_of_stock).
 * Allows online ordering to immediately show "Sold Out" without polling.
 * Client listener: SocketEventProvider forwards via onAny -> subscribe('menu:stock-changed')
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
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
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }

  return doEmit()
}

// ==================== Waitlist ====================

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
      log.error({ err: error }, 'Failed to dispatch waitlist:changed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async waitlist:changed failed'))
    return true
  }

  return doEmit()
}

// ==================== Print Jobs ====================

/**
 * Dispatch print job failure notification.
 *
 * Emitted when a kitchen print job fails after send.
 * PrinterStatusIndicator listens for this to update the red dot.
 */
export async function dispatchPrintJobFailed(
  locationId: string,
  payload: {
    orderId: string
    orderNumber?: number
    printerName: string
    printerId?: string
    error: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'print:job-failed', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch print:job-failed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async print:job-failed failed'))
    return true
  }

  return doEmit()
}

// ==================== Quick Bar Events ====================

/**
 * Dispatch quickbar:changed event to all connected clients.
 *
 * Emitted when a manager updates the location-level default quick bar layout.
 * All POS terminals refresh their quick bar to pick up the new defaults.
 */
export async function dispatchQuickBarChanged(
  locationId: string,
): Promise<void> {
  try {
    await emitToLocation(locationId, 'quickbar:changed', {})
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch quickbar:changed')
  }
}

// ==================== Membership Events ====================

export async function dispatchMembershipUpdate(
  locationId: string,
  payload: {
    action: 'enrolled' | 'charged' | 'declined' | 'paused' | 'resumed' | 'cancelled' | 'card_updated' | 'expired'
    membershipId: string
    customerId?: string
    details?: Record<string, unknown>
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'membership:updated', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch membership:updated')
      return false
    }
  }
  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }
  return doEmit()
}

// ==================== Shift Request Events ====================

export async function dispatchShiftRequestUpdate(
  locationId: string,
  payload: {
    action: 'created' | 'accepted' | 'declined' | 'approved' | 'rejected' | 'cancelled'
    requestId: string
    type: 'swap' | 'cover' | 'drop'
    requestedByEmployeeId: string
    requestedToEmployeeId?: string | null
    shiftId: string
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'shift-request:updated', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch shift-request:updated')
      return false
    }
  }
  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async dispatch failed'))
    return true
  }
  return doEmit()
}

// ==================== Venue Log Events ====================

/**
 * Dispatch a venue-log:new event to notify the diagnostics UI
 * that a new log entry has been recorded. Payload is minimal
 * (just a signal) -- the UI re-fetches on receipt.
 */
export async function dispatchVenueLogNew(
  locationId: string,
  summary: { level: string; source: string; category: string }
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'venue-log:new', summary)
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch venue-log:new')
    return false
  }
}

// ==================== Reservation Events ====================

/**
 * Dispatch reservation changed event to all connected clients.
 * Emitted on any reservation mutation (create, update, cancel, seat, check-in, etc.)
 * Host view, floor plan, and admin reservation pages listen for this.
 */
export async function dispatchReservationChanged(
  locationId: string,
  data: {
    reservationId: string
    action: string
    reservation?: any
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'reservation:changed', data)

      // Also emit specific event for new online bookings (host notification)
      if (data.action === 'created' && data.reservation?.source === 'online') {
        await emitToLocation(locationId, 'reservation:new_online', {
          reservationId: data.reservationId,
          guestName: data.reservation?.guestName,
          partySize: data.reservation?.partySize,
          reservationTime: data.reservation?.reservationTime,
          serviceDate: data.reservation?.serviceDate,
        })
      }

      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch reservation:changed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async reservation:changed failed'))
    return true
  }

  return doEmit()
}

// ==================== Cake Order Events ====================

/**
 * Dispatch cake-orders:new event
 *
 * Called when a new cake order is created (admin or public form).
 * Triggers auto-refresh on the cake orders list page.
 */
export async function dispatchCakeOrderNew(
  locationId: string,
  payload: { cakeOrderId: string; customerName: string; eventDate: string; source: string }
): Promise<void> {
  try {
    await emitToLocation(locationId, 'cake-orders:new', payload)
    await emitToLocation(locationId, 'cake-orders:list-changed', { locationId })
  } catch (err) {
    log.error({ err }, 'Failed to dispatch cake-orders:new')
  }
}

/**
 * Dispatch cake-orders:updated event
 *
 * Called on any cake order mutation: field update, status transition,
 * quote created/approved, payment recorded.
 * Triggers auto-refresh on both the detail and list pages.
 */
export async function dispatchCakeOrderUpdated(
  locationId: string,
  payload: { cakeOrderId: string; status: string; changeType: string }
): Promise<void> {
  try {
    await emitToLocation(locationId, 'cake-orders:updated', payload)
    await emitToLocation(locationId, 'cake-orders:list-changed', { locationId })
  } catch (err) {
    log.error({ err }, 'Failed to dispatch cake-orders:updated')
  }
}

// ==================== Settings Events ====================

/**
 * Dispatch settings:updated event
 *
 * Called when location settings change (tax rates, pricing model, etc.).
 * Notifies all terminals to refresh their cached settings.
 */
export async function dispatchSettingsUpdated(
  locationId: string,
  payload: {
    changedKeys: string[]
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'settings:updated', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch settings:updated')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async settings:updated failed'))
    return true
  }

  return doEmit()
}

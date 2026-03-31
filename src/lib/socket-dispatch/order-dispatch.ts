/**
 * Order domain socket dispatchers
 *
 * Handles: new orders, order updates, item mutations, totals,
 * open orders list, splits, summaries, close, claim/release, reopen, void/hold.
 */

import type { RoutingResult } from '@/types/routing'
import { invalidateSnapshotCache } from '@/lib/snapshot-cache'
import { invalidateOpenOrdersCache } from '@/app/api/orders/open/route'
import {
  log,
  crypto,
  emitToLocation,
  emitToTags,
  emitCriticalToLocation,
  type DispatchOptions,
} from './emit-helpers'

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
      // Build all station tag emissions + location emission in parallel
      const stationEmissions = routingResult.manifests.map((manifest) => {
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

        return emitToTags(manifest.matchedTags, 'kds:order-received', orderEvent, locationId)
      })

      // Emit to all stations + location for general awareness in parallel
      await Promise.all([
        ...stationEmissions,
        emitToLocation(locationId, 'order:created', {
          orderId: routingResult.order.orderId,
          orderNumber: routingResult.order.orderNumber,
          orderType: routingResult.order.orderType,
          tableName: routingResult.order.tableName,
          tabName: routingResult.order.tabName,
          employeeName: routingResult.order.employeeName,
          createdAt: routingResult.order.createdAt.toISOString(),
          stations: routingResult.manifests.map((m) => m.stationName),
        }),
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
  // Immediately invalidate the open-orders response cache so the next GET
  // fetches fresh data from the DB instead of serving stale results.
  invalidateOpenOrdersCache(locationId)

  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'orders:list-changed', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async open orders dispatch failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch split created event
 *
 * Called after a split transaction succeeds and child orders are created.
 * Sends full split context so all devices can instantly render the split
 * without an HTTP round-trip.
 */
export async function dispatchSplitCreated(
  locationId: string,
  data: {
    parentOrderId: string;
    parentStatus: string; // 'split'
    splits: Array<{
      id: string;
      orderNumber: number;
      splitIndex: number | null;
      displayNumber: string;
      total: number;
      itemCount: number;
      isPaid: boolean;
    }>;
    sourceTerminalId?: string;
  }
): Promise<boolean> {
  try {
    await emitCriticalToLocation(locationId, 'order:split-created', {
      ...data,
      _dedupKey: crypto.randomUUID(),
    })
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch order:split-created')
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
    log.error({ err: error }, 'Failed to dispatch order:updated')
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
    log.error({ err: error }, 'Failed to dispatch order:item-added')
    return false
  }
}

/**
 * Dispatch order item removed event
 *
 * Called after an item is soft-deleted from an order.
 * Notifies all terminals so they can remove the item from their local state.
 */
export async function dispatchOrderItemRemoved(
  locationId: string,
  orderId: string,
  itemId: string
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'order:item-removed', { orderId, itemId })
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch order:item-removed')
    return false
  }
}

/**
 * Dispatch order item updated event
 *
 * Called after an item's properties change (quantity, notes, seat, course, etc.).
 * Notifies all terminals with the changed fields so they can update local state.
 */
export async function dispatchOrderItemUpdated(
  locationId: string,
  orderId: string,
  itemId: string,
  changes: Record<string, unknown>
): Promise<boolean> {
  try {
    await emitToLocation(locationId, 'order:item-updated', { orderId, itemId, changes })
    return true
  } catch (error) {
    log.error({ err: error }, 'Failed to dispatch order:item-updated')
    return false
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

/** Minimal order shape required by buildOrderSummary (Prisma result or equivalent) */
interface BuildOrderSummaryInput {
  id: string
  orderNumber: number
  status: string
  tableId?: string | null
  table?: { name: string } | null
  tabName?: string | null
  guestCount?: number
  employeeId?: string | null
  subtotal: number | string | { toNumber?: () => number }
  taxTotal: number | string | { toNumber?: () => number }
  discountTotal: number | string | { toNumber?: () => number }
  tipTotal: number | string | { toNumber?: () => number }
  total: number | string | { toNumber?: () => number }
  itemCount?: number
  updatedAt?: Date | string | null
  locationId: string
}

/**
 * Build an OrderSummaryPayload from a Prisma order object.
 * Accepts any shape that has the required fields (Order, updatedOrder, etc.)
 */
export function buildOrderSummary(order: BuildOrderSummaryInput): OrderSummaryPayload {
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
    updatedAt: typeof order.updatedAt === 'string' ? order.updatedAt : (order.updatedAt ?? new Date()).toISOString(),
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
      log.error({ err: error }, 'Failed to dispatch order:summary-updated')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:summary-updated failed'))
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
      // _dedupKey allows clients to dedup if they receive the same event twice (e.g., QoS retry)
      await emitCriticalToLocation(locationId, 'order:closed', { ...payload, _dedupKey: crypto.randomUUID() })
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch order:closed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:closed failed'))
    return true
  }

  return doEmit()
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
      log.error({ err: error }, 'Failed to dispatch order:claimed')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:claimed failed'))
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
      log.error({ err: error }, 'Failed to dispatch order:released')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:released failed'))
    return true
  }

  return doEmit()
}

// ==================== Order Item Void/Hold Events ====================

/**
 * Dispatch order:item-voided event
 *
 * Called when an item is voided or comped after being sent to kitchen.
 * Notifies all terminals so they can update order displays and KDS can
 * mark the item appropriately.
 */
export async function dispatchOrderItemVoided(
  locationId: string,
  payload: {
    orderId: string
    itemId: string
    action: 'voided' | 'comped'
    reason: string | null
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:item-voided', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch order:item-voided')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:item-voided failed'))
    return true
  }

  return doEmit()
}

/**
 * Dispatch order:item-held event
 *
 * Called when an item's hold status is toggled.
 * Notifies all terminals and KDS screens to update hold indicators.
 */
export async function dispatchOrderItemHeld(
  locationId: string,
  payload: {
    orderId: string
    itemId: string
    isHeld: boolean
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:item-held', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch order:item-held')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:item-held failed'))
    return true
  }

  return doEmit()
}

// ==================== Order Reopen Events ====================

/**
 * Dispatch order:reopened event
 *
 * Called when a closed order is reopened for additional items or corrections.
 * Notifies all terminals to add the order back to the open orders list.
 */
export async function dispatchOrderReopened(
  locationId: string,
  payload: {
    orderId: string
    reason: string | null
  },
  options: DispatchOptions = {}
): Promise<boolean> {
  const doEmit = async () => {
    try {
      await emitToLocation(locationId, 'order:reopened', payload)
      return true
    } catch (error) {
      log.error({ err: error }, 'Failed to dispatch order:reopened')
      return false
    }
  }

  if (options.async) {
    doEmit().catch((err) => log.error({ err }, 'Async order:reopened failed'))
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
    log.error({ err: error }, 'Failed to dispatch table:status-changed')
    return false
  }
}

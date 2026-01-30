/**
 * Table Events - Realtime event abstraction for table status changes
 *
 * This module provides a simple abstraction layer for table-related events.
 * Currently implemented as no-ops, but designed for easy WebSocket/Pusher integration.
 *
 * Future implementation:
 * - Replace no-ops with pusher.trigger() calls
 * - Subscribe to channels like `tables-${locationId}`
 * - Handle real-time updates across all connected clients
 */

export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty' | 'in_use'

export interface TableStatusChangedEvent {
  tableId: string
  locationId: string
  previousStatus: TableStatus
  newStatus: TableStatus
  timestamp: string
  triggeredBy?: string // Employee ID
}

export interface TablesCombinedEvent {
  sourceTableId: string
  targetTableId: string
  locationId: string
  combinedName: string
  timestamp: string
  triggeredBy?: string
}

export interface TablesSplitEvent {
  primaryTableId: string
  restoredTableIds: string[]
  locationId: string
  splitMode: 'even' | 'by_seat'
  timestamp: string
  triggeredBy?: string
}

export interface TableOrderUpdatedEvent {
  tableId: string
  locationId: string
  orderId: string | null
  orderTotal: number
  guestCount: number
  timestamp: string
}

/**
 * Table events emitter - abstraction for real-time updates
 *
 * Usage:
 * ```typescript
 * // Emit event when table status changes
 * tableEvents.statusChanged({
 *   tableId: 'table_123',
 *   locationId: 'loc_456',
 *   previousStatus: 'available',
 *   newStatus: 'occupied',
 *   timestamp: new Date().toISOString(),
 *   triggeredBy: employee.id
 * })
 * ```
 *
 * Future WebSocket implementation:
 * ```typescript
 * statusChanged: (event) => {
 *   pusher.trigger(`tables-${event.locationId}`, 'status-changed', event)
 * }
 * ```
 */
export const tableEvents = {
  /**
   * Emit when a table's status changes
   */
  statusChanged: (event: TableStatusChangedEvent): void => {
    // Today: No-op - just log for debugging
    console.log('[TableEvents] Status changed:', event)

    // Tomorrow: Real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'status-changed', event)
  },

  /**
   * Emit when two tables are combined
   */
  tablesCombined: (event: TablesCombinedEvent): void => {
    // Today: No-op - just log for debugging
    console.log('[TableEvents] Tables combined:', event)

    // Tomorrow: Real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'tables-combined', event)
  },

  /**
   * Emit when a combined table is split apart
   */
  tablesSplit: (event: TablesSplitEvent): void => {
    // Today: No-op - just log for debugging
    console.log('[TableEvents] Tables split:', event)

    // Tomorrow: Real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'tables-split', event)
  },

  /**
   * Emit when a table's order is updated (new order, closed, total changed)
   */
  orderUpdated: (event: TableOrderUpdatedEvent): void => {
    // Today: No-op - just log for debugging
    console.log('[TableEvents] Order updated:', event)

    // Tomorrow: Real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'order-updated', event)
  },
}

/**
 * Table events listener - abstraction for receiving real-time updates
 *
 * Future implementation will use Pusher/Socket.io subscriptions:
 * ```typescript
 * const channel = pusher.subscribe(`tables-${locationId}`)
 * channel.bind('status-changed', callback)
 * ```
 */
export const tableEventListeners = {
  /**
   * Subscribe to table status changes for a location
   */
  onStatusChanged: (
    locationId: string,
    _callback: (event: TableStatusChangedEvent) => void
  ): (() => void) => {
    // Today: No-op - return empty unsubscribe function
    console.log('[TableEvents] Subscribed to status changes for location:', locationId)

    // Tomorrow: Pusher subscription
    // const channel = pusher.subscribe(`tables-${locationId}`)
    // channel.bind('status-changed', callback)
    // return () => channel.unbind('status-changed', callback)

    return () => {
      console.log('[TableEvents] Unsubscribed from status changes')
    }
  },

  /**
   * Subscribe to table combine events for a location
   */
  onTablesCombined: (
    locationId: string,
    _callback: (event: TablesCombinedEvent) => void
  ): (() => void) => {
    console.log('[TableEvents] Subscribed to combine events for location:', locationId)
    return () => {}
  },

  /**
   * Subscribe to table split events for a location
   */
  onTablesSplit: (
    locationId: string,
    _callback: (event: TablesSplitEvent) => void
  ): (() => void) => {
    console.log('[TableEvents] Subscribed to split events for location:', locationId)
    return () => {}
  },

  /**
   * Subscribe to table order updates for a location
   */
  onOrderUpdated: (
    locationId: string,
    _callback: (event: TableOrderUpdatedEvent) => void
  ): (() => void) => {
    console.log('[TableEvents] Subscribed to order updates for location:', locationId)
    return () => {}
  },
}

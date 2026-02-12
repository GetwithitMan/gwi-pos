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
  statusChanged: (_event: TableStatusChangedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'status-changed', event)
  },

  /**
   * Emit when a table's order is updated (new order, closed, total changed)
   */
  orderUpdated: (_event: TableOrderUpdatedEvent): void => {
    // No-op placeholder for future real-time push
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
    // No-op placeholder for future Pusher subscription
    // const channel = pusher.subscribe(`tables-${locationId}`)
    // channel.bind('status-changed', callback)
    // return () => channel.unbind('status-changed', callback)

    return () => {}
  },

  /**
   * Subscribe to table order updates for a location
   */
  onOrderUpdated: (
    _locationId: string,
    _callback: (event: TableOrderUpdatedEvent) => void
  ): (() => void) => {
    return () => {}
  },
}

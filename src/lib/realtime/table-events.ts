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

// Virtual Group Events
export interface VirtualGroupCreatedEvent {
  virtualGroupId: string
  primaryTableId: string
  tableIds: string[]
  groupColor: string
  locationId: string
  timestamp: string
  triggeredBy?: string
}

export interface VirtualGroupDissolvedEvent {
  virtualGroupId: string
  tableIds: string[]
  locationId: string
  timestamp: string
  triggeredBy?: string
}

export interface VirtualGroupMemberAddedEvent {
  virtualGroupId: string
  tableId: string
  locationId: string
  timestamp: string
  triggeredBy?: string
}

export interface VirtualGroupMemberRemovedEvent {
  virtualGroupId: string
  tableId: string
  locationId: string
  timestamp: string
  triggeredBy?: string
}

export interface VirtualGroupPrimaryChangedEvent {
  virtualGroupId: string
  previousPrimaryId: string
  newPrimaryId: string
  locationId: string
  timestamp: string
  triggeredBy?: string
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
   * Emit when two tables are combined
   */
  tablesCombined: (_event: TablesCombinedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'tables-combined', event)
  },

  /**
   * Emit when a combined table is split apart
   */
  tablesSplit: (_event: TablesSplitEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'tables-split', event)
  },

  /**
   * Emit when a table's order is updated (new order, closed, total changed)
   */
  orderUpdated: (_event: TableOrderUpdatedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'order-updated', event)
  },

  /**
   * Emit when a virtual table group is created
   */
  virtualGroupCreated: (_event: VirtualGroupCreatedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'virtual-group-created', event)
  },

  /**
   * Emit when a virtual table group is dissolved
   */
  virtualGroupDissolved: (_event: VirtualGroupDissolvedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'virtual-group-dissolved', event)
  },

  /**
   * Emit when a table is added to a virtual group
   */
  virtualGroupMemberAdded: (_event: VirtualGroupMemberAddedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'virtual-group-member-added', event)
  },

  /**
   * Emit when a table is removed from a virtual group
   */
  virtualGroupMemberRemoved: (_event: VirtualGroupMemberRemovedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'virtual-group-member-removed', event)
  },

  /**
   * Emit when the primary table of a virtual group is changed
   */
  virtualGroupPrimaryChanged: (_event: VirtualGroupPrimaryChangedEvent): void => {
    // No-op placeholder for future real-time push
    // pusher.trigger(`tables-${event.locationId}`, 'virtual-group-primary-changed', event)
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
   * Subscribe to table combine events for a location
   */
  onTablesCombined: (
    _locationId: string,
    _callback: (event: TablesCombinedEvent) => void
  ): (() => void) => {
    return () => {}
  },

  /**
   * Subscribe to table split events for a location
   */
  onTablesSplit: (
    _locationId: string,
    _callback: (event: TablesSplitEvent) => void
  ): (() => void) => {
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

/**
 * Event Types for GWI POS Real-time System
 *
 * Defines all event types that can be emitted and subscribed to.
 * These types are provider-agnostic and work with Socket.io, Pusher, or Ably.
 */

import type { OrderStatus } from '@/types'

// ==================== Event Payloads ====================

// Order Events
export interface OrderCreatedEvent {
  orderId: string
  orderNumber: string
  tableId?: string
  tabId?: string
  employeeId: string
  employeeName: string
  status: OrderStatus
  total: number
  itemCount: number
}

export interface OrderUpdatedEvent {
  orderId: string
  status: OrderStatus
  total?: number
  itemCount?: number
  paidAt?: string
}

export interface OrderItemAddedEvent {
  orderId: string
  itemId: string
  menuItemId: string
  name: string
  quantity: number
  price: number
  modifiers: Array<{ id: string; name: string; price: number }>
}

export interface OrderItemUpdatedEvent {
  orderId: string
  itemId: string
  status: 'pending' | 'sent' | 'preparing' | 'ready' | 'served' | 'voided' | 'comped'
  voidReason?: string
}

// Table Events
export type TableStatus = 'available' | 'occupied' | 'reserved' | 'dirty' | 'in_use'

export interface TableStatusChangedEvent {
  tableId: string
  tableName: string
  previousStatus: TableStatus
  newStatus: TableStatus
  orderId?: string
  guestCount?: number
}

export interface TableCombinedEvent {
  primaryTableId: string
  secondaryTableId: string
  combinedName: string
}

export interface TableSplitEvent {
  tableId: string
  restoredTableIds: string[]
}

// KDS Events
export interface KDSTicketNewEvent {
  ticketId: string
  orderId: string
  orderNumber: string
  station: string
  items: Array<{
    id: string
    name: string
    quantity: number
    modifiers: string[]
  }>
  priority: 'normal' | 'rush' | 'vip'
}

export interface KDSTicketBumpedEvent {
  ticketId: string
  station: string
  bumpedBy: string
  bumpedAt: string
}

export interface KDSItemBumpedEvent {
  ticketId: string
  itemId: string
  station: string
  bumpedBy: string
}

// Sync Events
export interface SyncConflictEvent {
  entityType: 'order' | 'table' | 'menu_item' | 'employee' | 'payment'
  entityId: string
  localVersion: number
  serverVersion: number
  conflictType: 'update' | 'delete'
}

export interface SyncCompletedEvent {
  pushed: number
  pulled: number
  conflicts: number
  duration: number
}

// Employee Events
export interface EmployeeClockEvent {
  employeeId: string
  employeeName: string
  action: 'clock_in' | 'clock_out' | 'break_start' | 'break_end'
}

// Payment Events
export interface PaymentProcessedEvent {
  orderId: string
  paymentId: string
  method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account'
  amount: number
  tipAmount: number
  status: 'approved' | 'declined' | 'pending'
}

// Tab Events
export interface TabUpdatedEvent {
  tabId: string
  tabName: string
  status: 'open' | 'paid' | 'closed'
  total: number
  itemCount: number
}

// ==================== Event Map ====================

/**
 * Complete mapping of event names to their payload types
 */
export interface EventMap {
  // Orders
  'order:created': OrderCreatedEvent
  'order:updated': OrderUpdatedEvent
  'order:item-added': OrderItemAddedEvent
  'order:item-updated': OrderItemUpdatedEvent

  // Tables
  'table:status-changed': TableStatusChangedEvent
  'table:combined': TableCombinedEvent
  'table:split': TableSplitEvent

  // KDS
  'kds:ticket-new': KDSTicketNewEvent
  'kds:ticket-bumped': KDSTicketBumpedEvent
  'kds:item-bumped': KDSItemBumpedEvent

  // Sync
  'sync:conflict': SyncConflictEvent
  'sync:completed': SyncCompletedEvent

  // Employees
  'employee:clock': EmployeeClockEvent

  // Payments
  'payment:processed': PaymentProcessedEvent

  // Tabs
  'tab:updated': TabUpdatedEvent
}

export type EventName = keyof EventMap

// ==================== Channel Types ====================

/**
 * Channel types for scoped subscriptions
 */
export type ChannelType =
  | 'location'    // location:{locationId} - All events for a location
  | 'table'       // table:{tableId} - Table-specific events
  | 'kds'         // kds:{station} - Kitchen display station events
  | 'employee'    // employee:{employeeId} - Personal notifications
  | 'order'       // order:{orderId} - Order-specific updates

export interface Channel {
  type: ChannelType
  id: string
}

/**
 * Build a channel name from type and id
 */
export function buildChannelName(type: ChannelType, id: string): string {
  return `${type}:${id}`
}

/**
 * Parse a channel name into type and id
 */
export function parseChannelName(channelName: string): Channel | null {
  const [type, ...idParts] = channelName.split(':')
  const id = idParts.join(':')

  if (!type || !id) return null
  if (!['location', 'table', 'kds', 'employee', 'order'].includes(type)) return null

  return { type: type as ChannelType, id }
}

// ==================== Callback Types ====================

export type EventCallback<T extends EventName> = (data: EventMap[T]) => void
export type UnsubscribeFn = () => void

// ==================== Connection Status ====================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface ConnectionState {
  status: ConnectionStatus
  lastConnected?: Date
  reconnectAttempts: number
  error?: string
}

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

  // KDS (Legacy)
  'kds:ticket-new': KDSTicketNewEvent
  'kds:ticket-bumped': KDSTicketBumpedEvent
  'kds:item-bumped': KDSItemBumpedEvent

  // KDS (Tag-Based Routing - New)
  'kds:order-received': KDSOrderReceivedEvent      // New order routed to this station
  'kds:item-status': KDSItemStatusUpdateEvent      // Item status changed (cooking/ready/served)
  'kds:order-bumped': KDSOrderBumpedEvent          // Order bumped from station

  // Entertainment
  'entertainment:session-update': EntertainmentSessionUpdateEvent

  // Floor Plan
  'floor-plan:updated': FloorPlanUpdatedEvent

  // Open Orders (cross-terminal table status updates)
  'orders:list-changed': OrdersListChangedEvent

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

// KDS Order Routing Events (Tag-Based)
export interface KDSOrderReceivedEvent {
  orderId: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string
  createdAt: string
  // Virtual group info
  virtualGroupId: string | null
  virtualGroupColor: string | null
  primaryTableName: string | null
  memberTables: Array<{ id: string; name: string; abbreviation: string | null }>
  // Items for this station
  primaryItems: Array<{
    id: string
    name: string
    quantity: number
    seatNumber: number | null
    specialNotes: string | null
    sourceTableName: string | null
    modifiers: Array<{ name: string; preModifier: string | null }>
    isPizza: boolean
    isBar: boolean
    pizzaData?: unknown
  }>
  // Other items in order (reference)
  referenceItems: Array<{
    id: string
    name: string
    quantity: number
    stationName: string
  }>
  matchedTags: string[]
  stationId: string
  stationName: string
}

export interface KDSItemStatusUpdateEvent {
  orderId: string
  itemId: string
  status: 'pending' | 'cooking' | 'ready' | 'served' | 'bumped'
  updatedBy: string
  updatedAt: string
  stationId: string
}

export interface KDSOrderBumpedEvent {
  orderId: string
  stationId: string
  bumpedBy: string
  bumpedAt: string
  allItemsServed: boolean
}

// Entertainment Session Events
export interface EntertainmentSessionUpdateEvent {
  sessionId: string
  tableId: string
  tableName: string
  action: 'started' | 'extended' | 'stopped' | 'warning'
  expiresAt: string | null
  addedMinutes?: number
  partyName?: string
  virtualGroupId?: string
}

// Floor Plan Events
export interface FloorPlanUpdatedEvent {
  locationId: string
}

// Open Orders Events
export interface OrdersListChangedEvent {
  locationId: string
  trigger: string
  orderId?: string
}

// ==================== Channel Types ====================

/**
 * Channel types for scoped subscriptions
 *
 * Room Architecture:
 * - location:{id} - Global venue alerts (sync status, hardware failures)
 * - tag:{tagName} - Prep stations (pizza KDS only hears tag:pizza)
 * - terminal:{id} - Direct messages to specific handheld
 */
export type ChannelType =
  | 'location'    // location:{locationId} - All events for a location
  | 'table'       // table:{tableId} - Table-specific events
  | 'kds'         // kds:{station} - Kitchen display station events
  | 'tag'         // tag:{tagName} - Tag-based routing (pizza, bar, grill, expo)
  | 'terminal'    // terminal:{terminalId} - Direct terminal messages
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
  if (!['location', 'table', 'kds', 'tag', 'terminal', 'employee', 'order'].includes(type)) return null

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

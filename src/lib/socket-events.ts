/**
 * Socket Event Registry -- Single source of truth for all real-time events.
 *
 * RULE: Every socket event MUST be defined here. No ad-hoc string literals.
 * Emitters import the event name constant. Consumers import the payload type.
 *
 * Organization follows the domain model:
 *   - Order lifecycle
 *   - Payment
 *   - KDS / kitchen
 *   - Entertainment / timed rentals
 *   - Menu / inventory
 *   - Floor plan / tables
 *   - Tabs
 *   - CFD (customer-facing display)
 *   - Mobile (bartender phone)
 *   - Pay-at-table
 *   - Terminal / device
 *   - Scale / hardware
 *   - System / sync / infrastructure
 *   - Delivery
 *   - Reservations
 *   - Misc (waitlist, print, membership, etc.)
 *
 * NOTE: CFD_EVENTS, MOBILE_EVENTS, and PAT_EVENTS remain in
 * `src/types/multi-surface.ts` for backward compatibility. They are
 * re-exported here so consumers can import from a single location.
 */

import {
  CFD_EVENTS as _CFD_EVENTS,
  MOBILE_EVENTS as _MOBILE_EVENTS,
  PAT_EVENTS as _PAT_EVENTS,
} from '@/types/multi-surface'

// Re-export multi-surface event constants for single-import convenience
export const CFD_EVENTS = _CFD_EVENTS
export const MOBILE_EVENTS = _MOBILE_EVENTS
export const PAT_EVENTS = _PAT_EVENTS

// ---------------------------------------------------------------------------
// Event Names
// ---------------------------------------------------------------------------

export const SOCKET_EVENTS = {
  // ── Order Lifecycle ─────────────────────────────────────────────────────
  ORDER_CREATED:          'order:created',
  ORDER_UPDATED:          'order:updated',
  ORDER_CLOSED:           'order:closed',
  ORDER_CLAIMED:          'order:claimed',
  ORDER_RELEASED:         'order:released',
  ORDER_SPLIT_CREATED:    'order:split-created',
  ORDER_EDITING:          'order:editing',
  ORDER_EDITING_RELEASED: 'order:editing-released',
  ORDERS_LIST_CHANGED:    'orders:list-changed',
  ORDER_SUMMARY_UPDATED:  'order:summary-updated',
  ORDER_TOTALS_UPDATED:   'order:totals-updated',

  // ── Order Items ─────────────────────────────────────────────────────────
  ORDER_ITEM_ADDED:       'order:item-added',
  ORDER_ITEM_REMOVED:     'order:item-removed',
  ORDER_ITEM_UPDATED:     'order:item-updated',
  ORDER_ITEM_VOIDED:      'order:item-voided',
  ORDER_ITEM_HELD:        'order:item-held',

  // ── Order Reopening ───────────────────────────────────────────────────
  ORDER_REOPENED:          'order:reopened',

  // ── Payment ─────────────────────────────────────────────────────────────
  PAYMENT_PROCESSED:      'payment:processed',
  PAYMENT_VOIDED:         'payment:voided',
  PAYMENT_REFUNDED:       'payment:refunded',

  // ── KDS / Kitchen ──────────────────────────────────────────────────────
  KDS_ORDER_RECEIVED:     'kds:order-received',
  KDS_ITEM_STATUS:        'kds:item-status',
  KDS_ORDER_BUMPED:       'kds:order-bumped',

  // ── Entertainment / Timed Rentals ──────────────────────────────────────
  ENTERTAINMENT_SESSION_UPDATE:    'entertainment:session-update',
  ENTERTAINMENT_SESSION_STARTED:   'entertainment:session-started',
  ENTERTAINMENT_SESSION_STOPPED:   'entertainment:session-stopped',
  ENTERTAINMENT_SESSION_EXTENDED:  'entertainment:session-extended',
  ENTERTAINMENT_STATUS_CHANGED:    'entertainment:status-changed',
  ENTERTAINMENT_WAITLIST_NOTIFY:   'entertainment:waitlist-notify',
  ENTERTAINMENT_WAITLIST_CHANGED:  'entertainment:waitlist-changed',

  // ── Menu / Inventory ───────────────────────────────────────────────────
  MENU_UPDATED:            'menu:updated',
  MENU_ITEM_CHANGED:       'menu:item-changed',
  MENU_STOCK_CHANGED:      'menu:stock-changed',
  MENU_STRUCTURE_CHANGED:  'menu:structure-changed',
  MENU_MODIFIER_CHANGED:   'menu:modifier-changed',
  INGREDIENT_LIBRARY_UPDATE: 'ingredient:library-update',
  INVENTORY_ADJUSTMENT:    'inventory:adjustment',
  INVENTORY_STOCK_CHANGE:  'inventory:stock-change',

  // ── Floor Plan / Tables ────────────────────────────────────────────────
  FLOOR_PLAN_UPDATED:      'floor-plan:updated',
  TABLE_STATUS_CHANGED:    'table:status-changed',

  // ── Tabs ───────────────────────────────────────────────────────────────
  TAB_UPDATED:             'tab:updated',
  TAB_TRANSFER_COMPLETE:   'tab:transfer-complete',
  TAB_ERROR:               'tab:error',
  TAB_MANAGER_ALERT:       'tab:manager-alert',

  // ── Tip Groups ─────────────────────────────────────────────────────────
  TIP_GROUP_UPDATED:       'tip-group:updated',

  // ── Terminal / Device ──────────────────────────────────────────────────
  TERMINAL_STATUS_CHANGED:    'terminal:status_changed',
  TERMINAL_PAYMENT_REQUEST:   'terminal:payment_request',
  TERMINAL_PAYMENT_COMPLETE:  'terminal:payment_complete',
  TERMINAL_PING:              'terminal:ping',
  TERMINAL_CONFIG_UPDATE:     'terminal:config-update',

  // ── Void Approval ──────────────────────────────────────────────────────
  VOID_APPROVAL_UPDATE:    'void:approval-update',

  // ── Location / Alerts ──────────────────────────────────────────────────
  LOCATION_ALERT:          'location:alert',

  // ── Scale / Hardware ───────────────────────────────────────────────────
  SCALE_WEIGHT:            'scale:weight',
  SCALE_STATUS:            'scale:status',

  // ── Print ──────────────────────────────────────────────────────────────
  PRINT_JOB:               'print:job',
  PRINT_STATUS:            'print:status',
  PRINT_JOB_FAILED:        'print:job-failed',

  // ── Sync / Infrastructure ──────────────────────────────────────────────
  SYNC_COMPLETED:          'sync:completed',
  SYNC_OUTAGE_STATUS:      'sync:outage-status',
  SERVER_FAILOVER_ACTIVE:  'server:failover-active',
  SERVER_FAILOVER_RESOLVED: 'server:failover-resolved',

  // ── Settings ───────────────────────────────────────────────────────────
  SETTINGS_UPDATED:        'settings:updated',

  // ── Quick Bar ──────────────────────────────────────────────────────────
  QUICKBAR_CHANGED:        'quickbar:changed',

  // ── Membership ─────────────────────────────────────────────────────────
  MEMBERSHIP_UPDATED:      'membership:updated',

  // ── Shift Requests ─────────────────────────────────────────────────────
  SHIFT_REQUEST_UPDATED:   'shift-request:updated',

  // ── Venue Log ──────────────────────────────────────────────────────────
  VENUE_LOG_NEW:           'venue-log:new',

  // ── Reservations ───────────────────────────────────────────────────────
  RESERVATION_CHANGED:     'reservation:changed',
  RESERVATION_NEW_ONLINE:  'reservation:new_online',

  // ── Settings (additional) ──────────────────────────────────────────────
  ORDER_TYPES_UPDATED:     'order-types:updated',

  // ── Employees ─────────────────────────────────────────────────────────
  EMPLOYEES_CHANGED:       'employees:changed',
  EMPLOYEE_CLOCK_CHANGED:  'employee:clock-changed',

  // ── Shifts ────────────────────────────────────────────────────────────
  SHIFTS_CHANGED:          'shifts:changed',

  // ── Cash Drawers ──────────────────────────────────────────────────────
  DRAWER_PAID_IN_OUT:      'drawer:paid_in_out',

  // ── Inventory (legacy alias) ──────────────────────────────────────────
  INVENTORY_CHANGED:       'inventory:changed',

  // ── EOD ───────────────────────────────────────────────────────────────
  EOD_RESET_COMPLETE:      'eod:reset-complete',

  // ── System ────────────────────────────────────────────────────────────
  SYSTEM_RELOAD:           'system:reload',
  SYSTEM_UPDATE_REQUIRED:  'system:update-required',

  // ── Cover Tracking ────────────────────────────────────────────────────
  COVER_ENTRY_RECORDED:    'cover:entry-recorded',

  // ── Cellular ──────────────────────────────────────────────────────────
  CELLULAR_DEVICE_REVOKED: 'cellular:device-revoked',

  // ── Waitlist ───────────────────────────────────────────────────────────
  WAITLIST_CHANGED:        'waitlist:changed',

  // ── Walkout ────────────────────────────────────────────────────────────
  WALKOUT_POTENTIAL_DETECTED: 'walkout:potential-detected',

  // ── Cake Orders ────────────────────────────────────────────────────────
  CAKE_ORDERS_NEW:           'cake-orders:new',
  CAKE_ORDERS_UPDATED:       'cake-orders:updated',
  CAKE_ORDERS_LIST_CHANGED:  'cake-orders:list-changed',

  // ── Gift Cards ─────────────────────────────────────────────────────────
  GIFT_CARD_BALANCE_CHANGED:   'gift-card:balance-changed',

  // ── Delivery ───────────────────────────────────────────────────────────
  DELIVERY_STATUS_CHANGED:     'delivery:status_changed',
  DELIVERY_UPDATED:            'delivery:updated',
  DELIVERY_RUN_CREATED:        'delivery:run_created',
  DELIVERY_RUN_COMPLETED:      'delivery:run_completed',
  DELIVERY_EXCEPTION_CREATED:  'delivery:exception_created',
  DELIVERY_EXCEPTION_RESOLVED: 'delivery:exception_resolved',
  DRIVER_STATUS_CHANGED:       'driver:status_changed',
  DRIVER_LOCATION_UPDATE:      'driver:location_update',

  // ── Handshake / Connection ─────────────────────────────────────────────
  CONNECTED:               'connected',
  SUBSCRIBED:              'subscribed',

  // ── Client-to-Server (inbound) ─────────────────────────────────────────
  // These are received via socket.on() in socket-server.ts, not emitted.
  // Listed here so the registry is complete.
  _CLIENT_SUBSCRIBE:       'subscribe',
  _CLIENT_UNSUBSCRIBE:     'unsubscribe',
  _CLIENT_ACK:             'ack',
  _CLIENT_JOIN_STATION:    'join_station',
  _CLIENT_LEAVE_STATION:   'leave_station',
  _CLIENT_VERSION:         'client:version',
  _CLIENT_CATCH_UP:        'catch-up',
  _CLIENT_SYNC_COMPLETED:  'sync_completed',
  _CLIENT_TERMINAL_MESSAGE: 'terminal_message',
} as const

/** Union of all event name string literals */
export type SocketEventName = typeof SOCKET_EVENTS[keyof typeof SOCKET_EVENTS]

// ---------------------------------------------------------------------------
// Payload Types
// ---------------------------------------------------------------------------

// ── Handshake / Connection ───────────────────────────────────────────────

export interface ConnectedPayload {
  authenticated: boolean
  terminalId: string | null
  employeeId: string | null
  locationId: string | null
  platform: string | null
  serverTime: string  // ISO 8601
}

export interface SubscribedPayload {
  channel: string
  success: boolean
}

// ── Order Lifecycle ──────────────────────────────────────────────────────

export interface OrderCreatedPayload {
  orderId: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string | null
  createdAt: string
  stations: string[]
}

export interface OrderUpdatedPayload {
  orderId: string
  changes?: string[]
}

export interface OrderClosedPayload {
  orderId: string
  status: string   // 'paid' | 'closed' | 'voided' | 'cancelled'
  closedAt: string // ISO timestamp
  closedByEmployeeId: string | null
  locationId: string
  _dedupKey?: string
}

export interface OrderClaimedPayload {
  orderId: string
  employeeId: string
  employeeName: string | null
  terminalId: string | null
  claimedAt: string
}

export interface OrderReleasedPayload {
  orderId: string
}

export interface OrderSplitCreatedPayload {
  parentOrderId: string
  parentStatus: string
  splits: Array<{
    id: string
    orderNumber: number
    splitIndex: number | null
    displayNumber: string
    total: number
    itemCount: number
    isPaid: boolean
  }>
  sourceTerminalId?: string
  _dedupKey?: string
}

export interface OrderEditingPayload {
  orderId: string
  terminalId: string
  terminalName: string
}

export interface OrderEditingReleasedPayload {
  orderId: string
  terminalId: string
}

export interface OrdersListChangedPayload {
  trigger: 'created' | 'paid' | 'voided' | 'transferred' | 'reopened' | 'sent' | 'item_updated' | 'payment_updated' | 'updated' | 'cancelled'
  orderId?: string
  tableId?: string
  orderNumber?: number
  status?: string
  sourceTerminalId?: string
}

export interface OrderSummaryUpdatedPayload {
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
  updatedAt: string
  locationId: string
}

export interface OrderTotalsUpdatedPayload {
  orderId: string
  totals: {
    subtotal: number
    taxTotal: number
    tipTotal: number
    discountTotal: number
    total: number
    commissionTotal?: number
  }
  timestamp: string
}

// ── Order Items ──────────────────────────────────────────────────────────

export interface OrderItemAddedPayload {
  orderId: string
  itemId?: string
}

export interface OrderItemRemovedPayload {
  orderId: string
  itemId: string
}

export interface OrderItemUpdatedPayload {
  orderId: string
  itemId: string
  changes: Record<string, unknown>
}

export interface OrderItemVoidedPayload {
  orderId: string
  itemId: string
  action: 'voided' | 'comped'
  reason: string | null
}

export interface OrderItemHeldPayload {
  orderId: string
  itemId: string
  isHeld: boolean
}

export interface OrderReopenedPayload {
  orderId: string
  reason: string | null
}

// ── Payment ──────────────────────────────────────────────────────────────

export interface PaymentProcessedPayload {
  orderId: string
  paymentId?: string
  status: string
  sourceTerminalId?: string
  method?: string
  amount?: number
  tipAmount?: number
  totalAmount?: number
  employeeId?: string | null
  isClosed?: boolean
  cardBrand?: string | null
  cardLast4?: string | null
  parentOrderId?: string | null
  allSiblingsPaid?: boolean
  parentAutoClose?: boolean
  _dedupKey?: string
}

export interface PaymentVoidedPayload {
  orderId: string
  paymentId: string
}

export interface PaymentRefundedPayload {
  orderId: string
  paymentId: string
  amount: number
}

// ── KDS / Kitchen ────────────────────────────────────────────────────────

export interface KdsOrderReceivedPayload {
  orderId: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string | null
  createdAt: string
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
    pizzaData: unknown
    pricingOptionLabel: string | null
    weight: number | null
    weightUnit: string | null
    unitPrice: number | null
    soldByWeight: boolean
    tareWeight: number | null
  }>
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

export interface KdsItemStatusPayload {
  orderId: string
  itemId: string
  status: string
  stationId: string
  updatedBy: string
}

export interface KdsOrderBumpedPayload {
  orderId: string
  stationId: string
  bumpedBy: string
  allItemsServed: boolean
}

// ── Entertainment / Timed Rentals ────────────────────────────────────────

export interface EntertainmentSessionUpdatePayload {
  sessionId: string
  tableId: string
  tableName: string
  action: 'started' | 'extended' | 'stopped' | 'warning' | 'comped' | 'voided' | 'force_stopped' | 'time_override'
  expiresAt: string | null
  startedAt: string | null
  addedMinutes?: number
  partyName?: string
  minutesRemaining: number | null
  serverTime: string
}

export interface EntertainmentStatusChangedPayload {
  itemId: string
  entertainmentStatus: 'available' | 'in_use' | 'reserved' | 'maintenance'
  currentOrderId: string | null
  expiresAt: string | null
  timeInfo?: {
    type: 'block' | 'per_minute'
    expiresAt: string | null
    startedAt: string | null
    minutesRemaining: number | null
    blockMinutes: number | null
  } | null
  waitlistCount?: number
  displayName?: string | null
  category?: { id: string; name: string } | null
  currentOrder?: {
    orderId: string
    tabName: string
    orderNumber: number
    displayNumber: number | null
  } | null
}

export interface EntertainmentWaitlistNotifyPayload {
  entryId: string
  customerName: string | null
  elementId: string | null
  elementName: string | null
  partySize: number
  action: 'added' | 'notified' | 'seated' | 'cancelled' | 'expired' | 'deposit-collected' | 'deposit-refunded'
  message: string
}

export interface EntertainmentWaitlistChangedPayload {
  itemId: string
  waitlistCount: number
}

// ── Menu / Inventory ─────────────────────────────────────────────────────

export interface MenuUpdatedPayload {
  action: 'created' | 'updated' | 'deleted' | 'restored'
  menuItemId?: string
  bottleId?: string
  name?: string
}

export interface MenuItemChangedPayload {
  itemId: string
  action: 'created' | 'updated' | 'deleted' | 'restored'
  changes?: Record<string, unknown>
}

export interface MenuStockChangedPayload {
  itemId: string
  stockStatus: 'in_stock' | 'low_stock' | 'critical' | 'out_of_stock'
  isOrderableOnline: boolean
}

export interface MenuStructureChangedPayload {
  action: 'category-created' | 'category-updated' | 'category-deleted' | 'modifier-group-updated'
  entityId: string
  entityType: 'category' | 'modifier-group'
}

export interface MenuModifierChangedPayload {
  menuItemId: string | null
  modifierGroupId: string
}

export interface IngredientLibraryUpdatePayload {
  ingredient: {
    id: string
    name: string
    categoryId: string
    parentIngredientId: string | null
    isBaseIngredient: boolean
  }
}

export interface InventoryAdjustmentPayload {
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
}

export interface InventoryStockChangePayload {
  ingredientId: string
  name: string
  currentStock: number
  previousStock: number
  unit: string
  stockLevel: 'critical' | 'low' | 'ok' | 'good'
}

// ── Floor Plan / Tables ──────────────────────────────────────────────────

export interface FloorPlanUpdatedPayload {
  locationId: string
}

export interface TableStatusChangedPayload {
  tableId: string
  status?: string
}

// ── Tabs ─────────────────────────────────────────────────────────────────

export interface TabUpdatedPayload {
  orderId: string
  status?: string
}

export interface TabTransferCompletePayload {
  orderId: string
}

export interface TabErrorPayload {
  orderId: string
  message: string
}

export interface TabManagerAlertPayload {
  orderId: string
  employeeId: string
  locationId: string
}

// ── Tip Groups ───────────────────────────────────────────────────────────

export interface TipGroupUpdatedPayload {
  action: 'created' | 'member-joined' | 'member-left' | 'closed' | 'ownership-transferred' | 'tip-received'
  groupId: string
  employeeId?: string
  employeeName?: string
  newOwnerId?: string
  tipAmountCents?: number
}

// ── Terminal / Device ────────────────────────────────────────────────────

export interface TerminalStatusChangedPayload {
  terminalId: string
  isOnline: boolean
  lastSeenAt: string | null
  source: 'socket_disconnect' | 'socket_reconnect'
  reason?: string
}

export interface TerminalPaymentRequestPayload {
  orderId: string
  targetTerminalId: string
  fromTerminalId: string
  totalCents: number
  tipSuggestions: number[]
  items: unknown[]
}

export interface TerminalPaymentCompletePayload {
  orderId: string
  fromTerminalId: string
  toTerminalId: string
  approvedAmountCents: number
  tipCents: number
  success: boolean
  declineReason?: string
}

// ── Void Approval ────────────────────────────────────────────────────────

export interface VoidApprovalUpdatePayload {
  type: 'approved' | 'rejected' | 'expired'
  approvalId: string
  terminalId?: string
  approvalCode?: string
  managerName: string
}

// ── Location / Alerts ────────────────────────────────────────────────────

export interface LocationAlertPayload {
  type: 'info' | 'warning' | 'error' | 'success'
  title: string
  message: string
  dismissable?: boolean
  duration?: number
}

// ── Scale / Hardware ─────────────────────────────────────────────────────

export interface ScaleWeightPayload {
  scaleId: string
  weight: number
  unit: string
  stable: boolean
  grossNet: 'gross' | 'net'
  overCapacity: boolean
  timestamp: string
}

export interface ScaleStatusPayload {
  scaleId: string
  connected: boolean
  error: string | null
  timestamp: string
}

// ── Print ────────────────────────────────────────────────────────────────

export interface PrintJobFailedPayload {
  orderId: string
  orderNumber?: number
  printerName: string
  printerId?: string
  error: string
}

// ── Sync / Infrastructure ────────────────────────────────────────────────

export interface SyncCompletedPayload {
  pushed: number
  pulled: number
  conflicts: number
}

export interface SyncOutageStatusPayload {
  isInOutage: boolean
}

export interface ServerFailoverActivePayload {
  message: string
  since: string
}

export interface ServerFailoverResolvedPayload {
  resolvedAt: string
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface SettingsUpdatedPayload {
  changedKeys: string[]
}

// ── Quick Bar ────────────────────────────────────────────────────────────

// quickbar:changed carries no payload (empty object)
export type QuickBarChangedPayload = Record<string, never>

// ── Membership ───────────────────────────────────────────────────────────

export interface MembershipUpdatedPayload {
  action: 'enrolled' | 'charged' | 'declined' | 'paused' | 'resumed' | 'cancelled' | 'card_updated' | 'expired'
  membershipId: string
  customerId?: string
  details?: Record<string, unknown>
}

// ── Shift Requests ───────────────────────────────────────────────────────

export interface ShiftRequestUpdatedPayload {
  action: 'created' | 'accepted' | 'declined' | 'approved' | 'rejected' | 'cancelled'
  requestId: string
  type: 'swap' | 'cover' | 'drop'
  requestedByEmployeeId: string
  requestedToEmployeeId?: string | null
  shiftId: string
}

// ── Venue Log ────────────────────────────────────────────────────────────

export interface VenueLogNewPayload {
  level: string
  source: string
  category: string
}

// ── Reservations ─────────────────────────────────────────────────────────

export interface ReservationChangedPayload {
  reservationId: string
  action: string
  reservation?: Record<string, unknown>
}

export interface ReservationNewOnlinePayload {
  reservationId: string
  guestName: string
  partySize: number
  reservationTime: string
  serviceDate: string
}

// ── Waitlist ─────────────────────────────────────────────────────────────

export interface WaitlistChangedPayload {
  action: 'added' | 'notified' | 'seated' | 'cancelled' | 'no_show' | 'removed'
  entryId: string
  customerName: string
  partySize: number
}

// ── Walkout ──────────────────────────────────────────────────────────────

export interface WalkoutPotentialDetectedPayload {
  orderId: string
  orderNumber: number
  tabName: string | null
  tableName: string | null
  total: number
  idleMinutes: number
}

// ── Cake Orders ──────────────────────────────────────────────────────────

export interface CakeOrdersNewPayload {
  cakeOrderId: string
  customerName: string
  eventDate: string
  source: string
}

export interface CakeOrdersUpdatedPayload {
  cakeOrderId: string
  status: string
  changeType: string
}

export interface CakeOrdersListChangedPayload {
  locationId: string
}

// ── Gift Cards ───────────────────────────────────────────────────────────

export interface GiftCardBalanceChangedPayload {
  giftCardId: string
  newBalance: number
  locationId: string
}

// ── Delivery ─────────────────────────────────────────────────────────────

export interface DeliveryStatusChangedPayload {
  deliveryOrderId: string
  orderId: string
  status: string
  driverId: string | null
  runId: string | null
  updatedAt: string
}

export interface DeliveryUpdatedPayload {
  deliveryOrderId: string
  orderId: string
  status: string
}

export interface DeliveryRunPayload {
  runId: string
  driverId: string
  status: string
  orderSequence: unknown
  updatedAt: string
}

export interface DeliveryExceptionPayload {
  exceptionId: string
  deliveryOrderId: string
  runId: string | null
  driverId: string | null
  type: string
  severity: string
  status: string
}

export interface DriverStatusChangedPayload {
  sessionId: string
  employeeId: string
  driverId: string
  status: string
  lastLocationLat: number | null
  lastLocationLng: number | null
}

export interface DriverLocationUpdatePayload {
  driverId: string
  lat: number
  lng: number
  accuracy?: number
  speed?: number
  recordedAt: string
}

// ---------------------------------------------------------------------------
// Event-to-Payload Type Map
// ---------------------------------------------------------------------------
// Used for type-safe socket.on() / socket.emit() wrappers if desired.

export interface SocketEventPayloadMap {
  // Handshake / Connection
  [SOCKET_EVENTS.CONNECTED]: ConnectedPayload
  [SOCKET_EVENTS.SUBSCRIBED]: SubscribedPayload

  // Order lifecycle
  [SOCKET_EVENTS.ORDER_CREATED]: OrderCreatedPayload
  [SOCKET_EVENTS.ORDER_UPDATED]: OrderUpdatedPayload
  [SOCKET_EVENTS.ORDER_CLOSED]: OrderClosedPayload
  [SOCKET_EVENTS.ORDER_CLAIMED]: OrderClaimedPayload
  [SOCKET_EVENTS.ORDER_RELEASED]: OrderReleasedPayload
  [SOCKET_EVENTS.ORDER_SPLIT_CREATED]: OrderSplitCreatedPayload
  [SOCKET_EVENTS.ORDER_EDITING]: OrderEditingPayload
  [SOCKET_EVENTS.ORDER_EDITING_RELEASED]: OrderEditingReleasedPayload
  [SOCKET_EVENTS.ORDERS_LIST_CHANGED]: OrdersListChangedPayload
  [SOCKET_EVENTS.ORDER_SUMMARY_UPDATED]: OrderSummaryUpdatedPayload
  [SOCKET_EVENTS.ORDER_TOTALS_UPDATED]: OrderTotalsUpdatedPayload

  // Order items
  [SOCKET_EVENTS.ORDER_ITEM_ADDED]: OrderItemAddedPayload
  [SOCKET_EVENTS.ORDER_ITEM_REMOVED]: OrderItemRemovedPayload
  [SOCKET_EVENTS.ORDER_ITEM_UPDATED]: OrderItemUpdatedPayload
  [SOCKET_EVENTS.ORDER_ITEM_VOIDED]: OrderItemVoidedPayload
  [SOCKET_EVENTS.ORDER_ITEM_HELD]: OrderItemHeldPayload

  // Order reopening
  [SOCKET_EVENTS.ORDER_REOPENED]: OrderReopenedPayload

  // Payment
  [SOCKET_EVENTS.PAYMENT_PROCESSED]: PaymentProcessedPayload
  [SOCKET_EVENTS.PAYMENT_VOIDED]: PaymentVoidedPayload
  [SOCKET_EVENTS.PAYMENT_REFUNDED]: PaymentRefundedPayload

  // KDS
  [SOCKET_EVENTS.KDS_ORDER_RECEIVED]: KdsOrderReceivedPayload
  [SOCKET_EVENTS.KDS_ITEM_STATUS]: KdsItemStatusPayload
  [SOCKET_EVENTS.KDS_ORDER_BUMPED]: KdsOrderBumpedPayload

  // Entertainment
  [SOCKET_EVENTS.ENTERTAINMENT_SESSION_UPDATE]: EntertainmentSessionUpdatePayload
  [SOCKET_EVENTS.ENTERTAINMENT_SESSION_STARTED]: EntertainmentSessionUpdatePayload
  [SOCKET_EVENTS.ENTERTAINMENT_SESSION_STOPPED]: EntertainmentSessionUpdatePayload
  [SOCKET_EVENTS.ENTERTAINMENT_SESSION_EXTENDED]: EntertainmentSessionUpdatePayload
  [SOCKET_EVENTS.ENTERTAINMENT_STATUS_CHANGED]: EntertainmentStatusChangedPayload
  [SOCKET_EVENTS.ENTERTAINMENT_WAITLIST_NOTIFY]: EntertainmentWaitlistNotifyPayload
  [SOCKET_EVENTS.ENTERTAINMENT_WAITLIST_CHANGED]: EntertainmentWaitlistChangedPayload

  // Menu / Inventory
  [SOCKET_EVENTS.MENU_UPDATED]: MenuUpdatedPayload
  [SOCKET_EVENTS.MENU_ITEM_CHANGED]: MenuItemChangedPayload
  [SOCKET_EVENTS.MENU_STOCK_CHANGED]: MenuStockChangedPayload
  [SOCKET_EVENTS.MENU_STRUCTURE_CHANGED]: MenuStructureChangedPayload
  [SOCKET_EVENTS.MENU_MODIFIER_CHANGED]: MenuModifierChangedPayload
  [SOCKET_EVENTS.INGREDIENT_LIBRARY_UPDATE]: IngredientLibraryUpdatePayload
  [SOCKET_EVENTS.INVENTORY_ADJUSTMENT]: InventoryAdjustmentPayload
  [SOCKET_EVENTS.INVENTORY_STOCK_CHANGE]: InventoryStockChangePayload

  // Floor plan / Tables
  [SOCKET_EVENTS.FLOOR_PLAN_UPDATED]: FloorPlanUpdatedPayload
  [SOCKET_EVENTS.TABLE_STATUS_CHANGED]: TableStatusChangedPayload

  // Tabs
  [SOCKET_EVENTS.TAB_UPDATED]: TabUpdatedPayload
  [SOCKET_EVENTS.TAB_TRANSFER_COMPLETE]: TabTransferCompletePayload
  [SOCKET_EVENTS.TAB_ERROR]: TabErrorPayload
  [SOCKET_EVENTS.TAB_MANAGER_ALERT]: TabManagerAlertPayload

  // Tip groups
  [SOCKET_EVENTS.TIP_GROUP_UPDATED]: TipGroupUpdatedPayload

  // Terminal
  [SOCKET_EVENTS.TERMINAL_STATUS_CHANGED]: TerminalStatusChangedPayload
  [SOCKET_EVENTS.TERMINAL_PAYMENT_REQUEST]: TerminalPaymentRequestPayload
  [SOCKET_EVENTS.TERMINAL_PAYMENT_COMPLETE]: TerminalPaymentCompletePayload

  // Void
  [SOCKET_EVENTS.VOID_APPROVAL_UPDATE]: VoidApprovalUpdatePayload

  // Alerts
  [SOCKET_EVENTS.LOCATION_ALERT]: LocationAlertPayload

  // Scale
  [SOCKET_EVENTS.SCALE_WEIGHT]: ScaleWeightPayload
  [SOCKET_EVENTS.SCALE_STATUS]: ScaleStatusPayload

  // Print
  [SOCKET_EVENTS.PRINT_JOB_FAILED]: PrintJobFailedPayload

  // Sync
  [SOCKET_EVENTS.SYNC_COMPLETED]: SyncCompletedPayload
  [SOCKET_EVENTS.SYNC_OUTAGE_STATUS]: SyncOutageStatusPayload
  [SOCKET_EVENTS.SERVER_FAILOVER_ACTIVE]: ServerFailoverActivePayload
  [SOCKET_EVENTS.SERVER_FAILOVER_RESOLVED]: ServerFailoverResolvedPayload

  // Settings
  [SOCKET_EVENTS.SETTINGS_UPDATED]: SettingsUpdatedPayload

  // Quick bar
  [SOCKET_EVENTS.QUICKBAR_CHANGED]: QuickBarChangedPayload

  // Membership
  [SOCKET_EVENTS.MEMBERSHIP_UPDATED]: MembershipUpdatedPayload

  // Shift requests
  [SOCKET_EVENTS.SHIFT_REQUEST_UPDATED]: ShiftRequestUpdatedPayload

  // Venue log
  [SOCKET_EVENTS.VENUE_LOG_NEW]: VenueLogNewPayload

  // Reservations
  [SOCKET_EVENTS.RESERVATION_CHANGED]: ReservationChangedPayload
  [SOCKET_EVENTS.RESERVATION_NEW_ONLINE]: ReservationNewOnlinePayload

  // Waitlist
  [SOCKET_EVENTS.WAITLIST_CHANGED]: WaitlistChangedPayload

  // Walkout
  [SOCKET_EVENTS.WALKOUT_POTENTIAL_DETECTED]: WalkoutPotentialDetectedPayload

  // Cake orders
  [SOCKET_EVENTS.CAKE_ORDERS_NEW]: CakeOrdersNewPayload
  [SOCKET_EVENTS.CAKE_ORDERS_UPDATED]: CakeOrdersUpdatedPayload
  [SOCKET_EVENTS.CAKE_ORDERS_LIST_CHANGED]: CakeOrdersListChangedPayload

  // Gift cards
  [SOCKET_EVENTS.GIFT_CARD_BALANCE_CHANGED]: GiftCardBalanceChangedPayload

  // Delivery
  [SOCKET_EVENTS.DELIVERY_STATUS_CHANGED]: DeliveryStatusChangedPayload
  [SOCKET_EVENTS.DELIVERY_UPDATED]: DeliveryUpdatedPayload
  [SOCKET_EVENTS.DELIVERY_RUN_CREATED]: DeliveryRunPayload
  [SOCKET_EVENTS.DELIVERY_RUN_COMPLETED]: DeliveryRunPayload
  [SOCKET_EVENTS.DELIVERY_EXCEPTION_CREATED]: DeliveryExceptionPayload
  [SOCKET_EVENTS.DELIVERY_EXCEPTION_RESOLVED]: DeliveryExceptionPayload
  [SOCKET_EVENTS.DRIVER_STATUS_CHANGED]: DriverStatusChangedPayload
  [SOCKET_EVENTS.DRIVER_LOCATION_UPDATE]: DriverLocationUpdatePayload
}

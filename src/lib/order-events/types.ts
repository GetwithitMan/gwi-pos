/**
 * Order Event Sourcing — Domain Types
 *
 * These types mirror the Android domain model exactly.
 * Field names match the Android payload JSON for cross-platform compatibility.
 * All monetary values are integer cents (number).
 */

// ── Event Type Constants ─────────────────────────────────────────────

export const ORDER_EVENT_TYPES = [
  'ORDER_CREATED',
  'ITEM_ADDED',
  'ITEM_REMOVED',
  'ITEM_UPDATED',
  'ORDER_SENT',
  'PAYMENT_APPLIED',
  'PAYMENT_VOIDED',
  'ORDER_CLOSED',
  'ORDER_REOPENED',
  'DISCOUNT_APPLIED',
  'DISCOUNT_REMOVED',
  'TAB_OPENED',
  'TAB_CLOSED',
  'GUEST_COUNT_CHANGED',
  'NOTE_CHANGED',
  'ORDER_METADATA_UPDATED',
  'COMP_VOID_APPLIED',
] as const

export type OrderEventType = (typeof ORDER_EVENT_TYPES)[number]

// ── Event Payloads (match Android OrderEventPayload sealed interface) ─

export interface OrderCreatedPayload {
  locationId: string
  employeeId: string
  orderType: string
  tableId?: string | null
  tabName?: string | null
  guestCount: number
  orderNumber: number
  displayNumber?: string | null
}

export interface ItemAddedPayload {
  lineItemId: string
  menuItemId: string
  name: string
  priceCents: number
  quantity: number
  modifiersJson?: string | null
  specialNotes?: string | null
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld: boolean
  soldByWeight: boolean
  weight?: number | null
  weightUnit?: string | null
  unitPriceCents?: number | null
  grossWeight?: number | null
  tareWeight?: number | null
  pricingOptionId?: string | null
  pricingOptionLabel?: string | null
  costAtSaleCents?: number | null
  pourSize?: string | null
  pourMultiplier?: number | null
}

export interface ItemRemovedPayload {
  lineItemId: string
  reason?: string | null
}

export interface ItemUpdatedPayload {
  lineItemId: string
  isHeld?: boolean | null
  specialNotes?: string | null
  courseNumber?: number | null
  seatNumber?: number | null
  quantity?: number | null
  delayMinutes?: number | null
  kitchenStatus?: string | null
  status?: string | null
  isCompleted?: boolean | null
  resendCount?: number | null
}

export interface OrderSentPayload {
  sentItemIds: string[]
}

export interface PaymentAppliedPayload {
  paymentId: string
  method: string
  amountCents: number
  tipCents: number
  totalCents: number
  cardBrand?: string | null
  cardLast4?: string | null
  status: string
}

export interface PaymentVoidedPayload {
  paymentId: string
  reason?: string | null
  employeeId?: string | null
}

export interface OrderClosedPayload {
  reason?: string | null
  closedStatus: string
}

export interface OrderReopenedPayload {
  reason?: string | null
}

export interface DiscountAppliedPayload {
  discountId: string
  type: string
  value: number
  amountCents: number
  reason?: string | null
  lineItemId?: string | null
}

export interface DiscountRemovedPayload {
  discountId: string
  lineItemId?: string | null
}

export interface TabOpenedPayload {
  cardLast4?: string | null
  preAuthId?: string | null
  tabName?: string | null
}

export interface TabClosedPayload {
  employeeId: string
  tipCents?: number | null
  adjustedAmountCents?: number | null
}

export interface GuestCountChangedPayload {
  count: number
}

export interface NoteChangedPayload {
  note?: string | null
}

export interface OrderMetadataUpdatedPayload {
  tabName?: string | null
  tableId?: string | null
  tableName?: string | null
  employeeId?: string | null
}

export interface CompVoidAppliedPayload {
  lineItemId?: string | null
  action: string
  reason?: string | null
  employeeId: string
  approvedById?: string | null
}

// ── Union type for dispatching ──────────────────────────────────────

export type OrderEventPayload =
  | { type: 'ORDER_CREATED'; payload: OrderCreatedPayload }
  | { type: 'ITEM_ADDED'; payload: ItemAddedPayload }
  | { type: 'ITEM_REMOVED'; payload: ItemRemovedPayload }
  | { type: 'ITEM_UPDATED'; payload: ItemUpdatedPayload }
  | { type: 'ORDER_SENT'; payload: OrderSentPayload }
  | { type: 'PAYMENT_APPLIED'; payload: PaymentAppliedPayload }
  | { type: 'PAYMENT_VOIDED'; payload: PaymentVoidedPayload }
  | { type: 'ORDER_CLOSED'; payload: OrderClosedPayload }
  | { type: 'ORDER_REOPENED'; payload: OrderReopenedPayload }
  | { type: 'DISCOUNT_APPLIED'; payload: DiscountAppliedPayload }
  | { type: 'DISCOUNT_REMOVED'; payload: DiscountRemovedPayload }
  | { type: 'TAB_OPENED'; payload: TabOpenedPayload }
  | { type: 'TAB_CLOSED'; payload: TabClosedPayload }
  | { type: 'GUEST_COUNT_CHANGED'; payload: GuestCountChangedPayload }
  | { type: 'NOTE_CHANGED'; payload: NoteChangedPayload }
  | { type: 'ORDER_METADATA_UPDATED'; payload: OrderMetadataUpdatedPayload }
  | { type: 'COMP_VOID_APPLIED'; payload: CompVoidAppliedPayload }

// ── State Models (match Android OrderState) ─────────────────────────

export interface ItemDiscount {
  discountId: string
  amountCents: number
  percent?: number | null
  reason?: string | null
}

export interface OrderDiscount {
  discountId: string
  type: string
  value: number
  amountCents: number
  reason?: string | null
}

export interface OrderPayment {
  paymentId: string
  method: string
  amountCents: number
  tipCents: number
  totalCents: number
  cardBrand?: string | null
  cardLast4?: string | null
  status: string
}

export interface OrderLineItem {
  lineItemId: string
  menuItemId: string
  name: string
  priceCents: number
  quantity: number
  modifiersJson?: string | null
  specialNotes?: string | null
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld: boolean
  kitchenStatus?: string | null
  soldByWeight: boolean
  weight?: number | null
  weightUnit?: string | null
  unitPriceCents?: number | null
  grossWeight?: number | null
  tareWeight?: number | null
  status: string
  isCompleted: boolean
  resendCount: number
  delayMinutes?: number | null
  pricingOptionId?: string | null
  pricingOptionLabel?: string | null
  costAtSaleCents?: number | null
  pourSize?: string | null
  pourMultiplier?: number | null
  itemDiscounts: Record<string, ItemDiscount>
}

export interface OrderState {
  orderId: string
  locationId: string
  employeeId: string
  orderType: string
  tableId?: string | null
  tableName?: string | null
  tabName?: string | null
  tabStatus?: string | null
  guestCount: number
  orderNumber: number
  displayNumber?: string | null
  status: string
  notes?: string | null
  hasPreAuth: boolean
  cardLast4?: string | null
  taxTotalCents: number
  items: Record<string, OrderLineItem>
  payments: Record<string, OrderPayment>
  discounts: Record<string, OrderDiscount>
  isClosed: boolean
}

// ── Computed helpers (pure functions on OrderState) ──────────────────

export function getItemTotalCents(item: OrderLineItem): number {
  let base: number
  if (item.soldByWeight && item.weight != null && item.unitPriceCents != null) {
    base = Math.round(item.weight * item.unitPriceCents)
  } else {
    base = item.priceCents * item.quantity
  }
  const discountSum = Object.values(item.itemDiscounts).reduce(
    (sum, d) => sum + d.amountCents,
    0
  )
  return Math.max(0, base - discountSum)
}

function isActiveItem(item: OrderLineItem): boolean {
  return item.status !== 'voided' && item.status !== 'comped'
}

export function getSubtotalCents(state: OrderState): number {
  return Object.values(state.items)
    .filter(isActiveItem)
    .reduce((sum, item) => sum + getItemTotalCents(item), 0)
}

export function getDiscountTotalCents(state: OrderState): number {
  const orderLevelDiscounts = Object.values(state.discounts).reduce(
    (sum, d) => sum + d.amountCents,
    0
  )
  const itemLevelDiscounts = Object.values(state.items)
    .filter(isActiveItem)
    .reduce(
      (sum, item) =>
        sum +
        Object.values(item.itemDiscounts).reduce(
          (s, d) => s + d.amountCents,
          0
        ),
      0
    )
  return orderLevelDiscounts + itemLevelDiscounts
}

export function getTotalCents(state: OrderState): number {
  return Math.max(
    0,
    getSubtotalCents(state) -
      getDiscountTotalCents(state) +
      state.taxTotalCents
  )
}

export function getPaidAmountCents(state: OrderState): number {
  return Object.values(state.payments)
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + p.totalCents, 0)
}

export function getTipTotalCents(state: OrderState): number {
  return Object.values(state.payments)
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + p.tipCents, 0)
}

export function getItemCount(state: OrderState): number {
  return Object.values(state.items)
    .filter(isActiveItem)
    .reduce((sum, item) => sum + item.quantity, 0)
}

export function getHasHeldItems(state: OrderState): boolean {
  return Object.values(state.items).some(
    (item) => item.isHeld && isActiveItem(item)
  )
}

// ── API Types ───────────────────────────────────────────────────────

export interface BatchEventInput {
  eventId: string
  orderId: string
  deviceId: string
  deviceCounter: number
  type: OrderEventType
  payloadJson: Record<string, unknown>
  schemaVersion?: number
  correlationId?: string | null
  deviceCreatedAt: number // epoch ms from device
}

export interface BatchEventResponse {
  accepted: Array<{ eventId: string; serverSequence: number }>
  rejected: Array<{ eventId: string; reason: string }>
}

export interface EventReplayResponse {
  events: Array<{
    eventId: string
    orderId: string
    serverSequence: number
    type: string
    payloadJson: Record<string, unknown>
    schemaVersion: number
    deviceId: string
    deviceCounter: number
    correlationId?: string | null
    deviceCreatedAt: string // ISO 8601
  }>
  hasMore: boolean
}

// ── Empty state factory ─────────────────────────────────────────────

export function emptyOrderState(orderId: string): OrderState {
  return {
    orderId,
    locationId: '',
    employeeId: '',
    orderType: 'dine_in',
    tableId: null,
    tableName: null,
    tabName: null,
    tabStatus: null,
    guestCount: 1,
    orderNumber: 0,
    displayNumber: null,
    status: 'open',
    notes: null,
    hasPreAuth: false,
    cardLast4: null,
    taxTotalCents: 0,
    items: {},
    payments: {},
    discounts: {},
    isClosed: false,
  }
}

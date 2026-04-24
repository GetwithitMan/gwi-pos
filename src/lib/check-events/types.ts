/**
 * Check Event Sourcing — Domain Types
 *
 * These types define the check aggregate's event-sourced lifecycle.
 * Field names match the Android payload JSON for cross-platform compatibility.
 * All monetary values are integer cents (number).
 *
 * Check lifecycle:
 *   Pre-commit (draft) → CHECK_COMMITTED (exactly one) → Post-commit events
 */

// ── Event Type Constants ─────────────────────────────────────────────

export const CHECK_EVENT_TYPES = [
  // Pre-commit (draft state)
  'CHECK_OPENED',
  'CHECK_TABLE_REBOUND',
  'CHECK_ITEM_ADDED',
  'CHECK_ITEM_REMOVED',
  'CHECK_ITEM_UPDATED',
  'CHECK_GUEST_COUNT_CHANGED',
  'CHECK_LEASE_ACQUIRED',
  'CHECK_LEASE_RELEASED',
  'CHECK_ABANDONED',
  // Commit (exactly one per check)
  'CHECK_COMMITTED',
  'CHECK_COMP_VOID_APPLIED',
  // Post-commit
  'ORDER_SENT',
  'TAB_OPENED',
  'PAYMENT_AUTHORIZED',
  'PAYMENT_APPLIED',
  'CHECK_CLOSED',
] as const

export type CheckEventType = (typeof CHECK_EVENT_TYPES)[number]

// ── Event Payloads ───────────────────────────────────────────────────

export interface CheckOpenedPayload {
  locationId: string
  employeeId: string
  orderType: string
  tableId?: string | null
  tabName?: string | null
  guestCount: number
  terminalId: string
}

export interface CheckTableReboundPayload {
  previousTableId: string
  newTableId: string
  employeeId: string
}

export interface CheckItemAddedPayload {
  lineItemId: string
  menuItemId: string
  name: string
  priceCents: number
  quantity: number
  modifiers?: Array<Record<string, unknown>> | null
  specialNotes?: string | null
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld: boolean
  soldByWeight: boolean
  weight?: number | null
  weightUnit?: string | null
  unitPriceCents?: number | null
  itemType?: string | null
  blockTimeMinutes?: number | null
  pricingOptionId?: string | null
  pricingOptionLabel?: string | null
  pourSize?: string | null
  pourMultiplier?: number | null
  isTaxInclusive: boolean
  pizzaConfigJson?: string | null
  comboSelectionsJson?: string | null
}

export interface CheckItemRemovedPayload {
  lineItemId: string
  reason?: string | null
}

export interface CheckItemUpdatedPayload {
  lineItemId: string
  quantity?: number | null
  priceCents?: number | null
  name?: string | null
  modifiers?: Array<Record<string, unknown>> | null
  specialNotes?: string | null
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld?: boolean | null
  status?: string | null
  delayMinutes?: number | null
  blockTimeMinutes?: number | null
  blockTimeStartedAt?: string | null
  blockTimeExpiresAt?: string | null
  ratePerMinute?: number | null
  minimumCharge?: number | null
  incrementMinutes?: number | null
  graceMinutes?: number | null
  itemType?: string | null
  price?: number | null
}

export interface CheckGuestCountChangedPayload {
  previousCount: number
  newCount: number
}

export interface CheckLeaseAcquiredPayload {
  terminalId: string
  employeeName: string
}

export interface CheckLeaseReleasedPayload {
  terminalId: string
  reason: 'timeout' | 'disconnect' | 'handoff' | 'admin'
}

export interface CheckAbandonedPayload {
  reason: 'manual' | 'timeout' | 'stale_cleanup'
  employeeId?: string | null
}

export interface CheckCommittedPayload {
  orderNumber: number
  displayNumber?: string | null
  businessDate: string
  employeeId: string
}

export interface OrderSentPayload {
  itemIds: string[]
  stationTags?: string[] | null
}

export interface TabOpenedPayload {
  tabId: string
  tabName: string
  cardLast4?: string | null
}

export interface PaymentAuthorizedPayload {
  paymentId: string
  method: string
  amountCents: number
  cardBrand?: string | null
  cardLast4?: string | null
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

export interface CheckCompVoidAppliedPayload {
  lineItemId: string
  action: 'comp' | 'void'
  reason?: string | null
  employeeId: string
  approvedById?: string | null
  wasMade?: boolean | null
}

export interface CheckClosedPayload {
  reason: string
  employeeId: string
  finalTotalCents: number
}

// ── Union type for dispatching ──────────────────────────────────────

export type CheckEventPayload =
  | { type: 'CHECK_OPENED'; payload: CheckOpenedPayload }
  | { type: 'CHECK_TABLE_REBOUND'; payload: CheckTableReboundPayload }
  | { type: 'CHECK_ITEM_ADDED'; payload: CheckItemAddedPayload }
  | { type: 'CHECK_ITEM_REMOVED'; payload: CheckItemRemovedPayload }
  | { type: 'CHECK_ITEM_UPDATED'; payload: CheckItemUpdatedPayload }
  | { type: 'CHECK_GUEST_COUNT_CHANGED'; payload: CheckGuestCountChangedPayload }
  | { type: 'CHECK_LEASE_ACQUIRED'; payload: CheckLeaseAcquiredPayload }
  | { type: 'CHECK_LEASE_RELEASED'; payload: CheckLeaseReleasedPayload }
  | { type: 'CHECK_ABANDONED'; payload: CheckAbandonedPayload }
  | { type: 'CHECK_COMMITTED'; payload: CheckCommittedPayload }
  | { type: 'CHECK_COMP_VOID_APPLIED'; payload: CheckCompVoidAppliedPayload }
  | { type: 'ORDER_SENT'; payload: OrderSentPayload }
  | { type: 'TAB_OPENED'; payload: TabOpenedPayload }
  | { type: 'PAYMENT_AUTHORIZED'; payload: PaymentAuthorizedPayload }
  | { type: 'PAYMENT_APPLIED'; payload: PaymentAppliedPayload }
  | { type: 'CHECK_CLOSED'; payload: CheckClosedPayload }

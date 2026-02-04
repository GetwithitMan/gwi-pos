/**
 * Order Management Domain Types
 */

// =============================================================================
// O1: TICKET LIFECYCLE
// =============================================================================

export interface Order {
  id: string
  locationId: string
  orderNumber: number
  type: OrderType
  status: OrderStatus

  // Links (via bridge)
  tableId?: string
  tabId?: string
  customerId?: string
  employeeId: string

  // Totals
  subtotal: number
  taxTotal: number
  discountTotal: number
  tipTotal: number
  total: number

  // Guest info
  guestCount: number
  guestName?: string

  // Timing
  createdAt: Date
  sentAt?: Date
  closedAt?: Date

  // Items
  items: OrderItem[]
  payments: Payment[]
}

export type OrderStatus =
  | 'open'
  | 'sent'
  | 'in_progress'
  | 'ready'
  | 'served'
  | 'check_printed'
  | 'paid'
  | 'closed'
  | 'voided'

export type OrderType =
  | 'dine_in'
  | 'takeout'
  | 'delivery'
  | 'bar'
  | 'tab'
  | 'catering'
  | 'event'

// =============================================================================
// O2: ITEM MANAGEMENT
// =============================================================================

export interface OrderItem {
  id: string
  orderId: string
  menuItemId: string

  // Display
  name: string
  quantity: number

  // Pricing
  unitPrice: number
  modifierTotal: number
  discountAmount: number
  totalPrice: number

  // Status
  status: OrderItemStatus
  course: number
  seatNumber?: number

  // Kitchen
  sentAt?: Date
  firedAt?: Date
  readyAt?: Date
  servedAt?: Date

  // Customization
  modifiers: OrderModifier[]
  specialInstructions?: string

  // Void/Comp
  voidedAt?: Date
  voidedBy?: string
  voidReason?: string
  compedAt?: Date
  compedBy?: string
  compReason?: string
}

export type OrderItemStatus =
  | 'pending'
  | 'sent'
  | 'cooking'
  | 'ready'
  | 'served'
  | 'voided'
  | 'comped'

// =============================================================================
// O3: MODIFIERS
// =============================================================================

export interface OrderModifier {
  id: string
  orderItemId: string
  modifierId: string
  name: string
  price: number
  quantity: number

  // Type
  type: ModifierType

  // For ingredient modifiers
  ingredientId?: string
  ingredientAction?: IngredientAction
}

export type ModifierType =
  | 'add'
  | 'remove'
  | 'substitute'
  | 'option'
  | 'ingredient'

export type IngredientAction =
  | 'no'
  | 'lite'
  | 'regular'
  | 'extra'
  | 'on_side'

// =============================================================================
// O4: COURSING
// =============================================================================

export interface CourseConfig {
  id: string
  locationId: string
  name: string
  number: number
  autoFire: boolean
  fireDelay?: number  // minutes after previous course
}

// =============================================================================
// O5: SPLITTING
// =============================================================================

export interface Split {
  id: string
  orderId: string
  type: SplitType

  // For even split
  ways?: number

  // For item split
  splitItems?: SplitItem[]

  createdAt: Date
  createdBy: string
}

export type SplitType =
  | 'even'
  | 'by_item'
  | 'by_seat'
  | 'custom_amount'

export interface SplitItem {
  orderItemId: string
  splitIndex: number  // which split check this item goes to
  portion: number     // fraction of item (1 = full, 0.5 = half)
}

// =============================================================================
// O6: PAYMENT
// =============================================================================

export interface Payment {
  id: string
  orderId: string
  splitIndex?: number

  method: PaymentMethod
  status: PaymentStatus

  // Amounts
  amount: number
  tipAmount: number
  totalAmount: number

  // Card details (if applicable)
  cardLast4?: string
  cardBrand?: string
  authCode?: string
  transactionId?: string

  // Gift card (if applicable)
  giftCardId?: string
  giftCardNumber?: string

  // House account (if applicable)
  houseAccountId?: string

  // Timing
  processedAt?: Date
  voidedAt?: Date

  employeeId: string
}

export type PaymentMethod =
  | 'cash'
  | 'credit'
  | 'debit'
  | 'gift_card'
  | 'house_account'
  | 'comp'
  | 'split'

export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'approved'
  | 'declined'
  | 'voided'
  | 'refunded'

// =============================================================================
// O8: COMPS & VOIDS
// =============================================================================

export interface Void {
  id: string
  type: 'order' | 'item' | 'payment'
  targetId: string
  reason: VoidReason
  customReason?: string
  amount: number

  requestedBy: string
  approvedBy: string
  approvedAt: Date

  // For remote approval
  approvalToken?: string
  approvalMethod?: 'pin' | 'sms' | 'app'
}

export type VoidReason =
  | 'customer_changed_mind'
  | 'wrong_item'
  | 'quality_issue'
  | 'long_wait'
  | 'duplicate_order'
  | 'manager_comp'
  | 'other'

export interface Comp {
  id: string
  type: 'order' | 'item'
  targetId: string
  reason: CompReason
  customReason?: string
  amount: number
  percentage?: number

  approvedBy: string
  approvedAt: Date
}

export type CompReason =
  | 'service_issue'
  | 'food_quality'
  | 'long_wait'
  | 'regular_customer'
  | 'manager_discretion'
  | 'employee_meal'
  | 'promotion'
  | 'other'

// =============================================================================
// O9: TABS
// =============================================================================

export interface Tab {
  id: string
  locationId: string
  name: string
  status: TabStatus

  // Owner
  customerId?: string
  employeeId?: string

  // Card on file
  cardLast4?: string
  cardBrand?: string
  preAuthId?: string

  // Totals
  runningTotal: number
  limit?: number

  // Orders
  orderIds: string[]

  createdAt: Date
  closedAt?: Date
}

export type TabStatus =
  | 'open'
  | 'at_limit'
  | 'closed'
  | 'transferred'

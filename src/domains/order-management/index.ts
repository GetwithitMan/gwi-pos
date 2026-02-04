/**
 * Order Management Domain
 *
 * Manages WHAT was ordered and HOW it's paid.
 *
 * Modules:
 * - O1: Ticket Lifecycle (create, open, close, void)
 * - O2: Item Management (add, remove, modify items)
 * - O3: Modifiers (item customizations)
 * - O4: Coursing (fire timing, course management)
 * - O5: Splitting (split checks, move items)
 * - O6: Payment (tender, tips, change)
 * - O7: Kitchen Routing (send to kitchen, KDS)
 * - O8: Comps & Voids (manager approval)
 * - O9: Tabs (bar tabs, running totals)
 * - O10: Order History (search, reports)
 *
 * This domain NEVER handles table layout directly.
 * It communicates with Floor Plan through the floor-to-order bridge.
 */

// =============================================================================
// PUBLIC TYPES
// =============================================================================

export type { Order, OrderStatus, OrderType } from './types'
export type { OrderItem, OrderItemStatus } from './types'
export type { OrderModifier } from './types'
export type { Payment, PaymentMethod, PaymentStatus } from './types'
export type { Split, SplitType } from './types'
export type { Tab, TabStatus } from './types'
export type { Void, VoidReason, Comp, CompReason } from './types'

// =============================================================================
// PUBLIC HOOKS
// =============================================================================

// These will be implemented as we migrate existing hooks
// export { useOrder } from './hooks/useOrder'
// export { useOrderItems } from './hooks/useOrderItems'
// export { usePayment } from './hooks/usePayment'
// export { useSplitCheck } from './hooks/useSplitCheck'
// export { useTab } from './hooks/useTab'

// =============================================================================
// PUBLIC COMPONENTS
// =============================================================================

// These will be implemented as we migrate existing components
// export { OrderPanel } from './components/OrderPanel'
// export { PaymentModal } from './components/PaymentModal'
// export { SplitCheckModal } from './components/SplitCheckModal'
// export { CompVoidModal } from './components/CompVoidModal'

// =============================================================================
// PUBLIC SERVICES
// =============================================================================

// These will be implemented as we migrate existing lib functions
// export { OrderService } from './services/OrderService'
// export { PaymentService } from './services/PaymentService'
// export { SplitService } from './services/SplitService'
// export { KitchenRouter } from './services/KitchenRouter'

// =============================================================================
// CONSTANTS
// =============================================================================

export const ORDER_STATUSES = [
  'open',
  'sent',
  'in_progress',
  'ready',
  'served',
  'check_printed',
  'paid',
  'closed',
  'voided',
] as const

export const ORDER_TYPES = [
  'dine_in',
  'takeout',
  'delivery',
  'bar',
  'tab',
  'catering',
  'event',
] as const

export const PAYMENT_METHODS = [
  'cash',
  'credit',
  'debit',
  'gift_card',
  'house_account',
  'comp',
  'split',
] as const

export const VOID_REASONS = [
  'customer_changed_mind',
  'wrong_item',
  'quality_issue',
  'long_wait',
  'duplicate_order',
  'manager_comp',
  'other',
] as const

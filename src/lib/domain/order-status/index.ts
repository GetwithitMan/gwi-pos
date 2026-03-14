/**
 * Order Status Domain Module
 *
 * Single source of truth for order lifecycle status rules.
 * All status transitions, guards, and categories are defined here.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type { OrderStatus, TransitionResult } from './types'

// ─── Transition Map & Categories ─────────────────────────────────────────────

export {
  VALID_TRANSITIONS,
  PAYABLE_STATUSES,
  SPLITTABLE_STATUSES,
  MODIFIABLE_STATUSES,
  DISCOUNTABLE_STATUSES,
  OPEN_ORDER_STATUSES,
  TERMINAL_STATUSES,
  CLOSED_STATUSES,
} from './transitions'

// ─── Guard Predicates ────────────────────────────────────────────────────────

export {
  isPayable,
  isSplittable,
  isModifiable,
  isDiscountable,
  isTerminal,
  isOpen,
  isClosed,
} from './transitions'

// ─── Transition Validation ───────────────────────────────────────────────────

export { validateTransition } from './transitions'

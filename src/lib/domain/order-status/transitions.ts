/**
 * Order Status Transitions — Single Source of Truth
 *
 * PURE POLICY: No DB, no side effects, no framework types.
 *
 * All order status transition rules are defined here.
 * Routes import these instead of duplicating inline.
 */

import type { OrderStatus, TransitionResult } from './types'

// ─── Valid Transitions Map ───────────────────────────────────────────────────

/**
 * Defines which status transitions are allowed via direct updates (PUT/PATCH).
 * Typed as Record<OrderStatus, ...> — compiler enforces exhaustiveness.
 * Note: 'paid' is NOT reachable via PUT — only through the payment flow.
 */
export const VALID_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft:       ['open', 'closed', 'voided', 'cancelled'],
  open:        ['closed', 'voided', 'cancelled'],
  sent:        ['open', 'closed', 'voided', 'cancelled'],
  in_progress: ['open', 'closed', 'voided', 'cancelled'],
  split:       ['open', 'closed', 'voided', 'cancelled'],
  received:    ['open', 'cancelled'],      // online/third-party orders: accept or reject
  pending:     ['open', 'cancelled'],      // queued orders: accept or reject
  closed:      ['voided'],                 // needs manager auth
  voided:      ['open'],                   // reopen via manager override (MGR_VOID_ORDERS)
  paid:        [],                         // terminal — only via payment flow (reopen bypasses this map)
  cancelled:   [],                         // terminal
  completed:   [],                         // terminal archival state
  merged:      [],                         // terminal — order absorbed into another
}

// ─── Status Categories ───────────────────────────────────────────────────────

/** Statuses from which a payment can be processed */
export const PAYABLE_STATUSES: readonly OrderStatus[] = ['open', 'sent', 'in_progress', 'draft', 'split'] as const

/** Statuses from which an order can be split */
export const SPLITTABLE_STATUSES: readonly OrderStatus[] = ['open', 'in_progress', 'sent'] as const

/** Statuses that allow order metadata modifications (items, notes, guest count, etc.) */
export const MODIFIABLE_STATUSES: readonly OrderStatus[] = ['open', 'draft', 'sent', 'in_progress', 'split'] as const

/** Statuses that allow discounts — excludes 'split' because split parents must be discounted on individual splits */
export const DISCOUNTABLE_STATUSES: readonly OrderStatus[] = ['open', 'draft', 'sent', 'in_progress'] as const

/** Statuses representing an open order (visible in open orders list, blocks shift close) */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['open', 'sent', 'in_progress', 'split'] as const

/** Terminal statuses — no further transitions allowed (except voided→open with manager auth) */
export const TERMINAL_STATUSES: readonly OrderStatus[] = ['voided', 'paid', 'cancelled', 'completed', 'merged'] as const

/** Statuses where the order is considered "done" (paid, closed, voided, or archived) */
export const CLOSED_STATUSES: readonly OrderStatus[] = ['paid', 'closed', 'cancelled', 'voided', 'completed', 'merged'] as const

// ─── Guard Predicates ────────────────────────────────────────────────────────

// Sets for O(1) lookup in guards
const PAYABLE_SET = new Set<string>(PAYABLE_STATUSES)
const SPLITTABLE_SET = new Set<string>(SPLITTABLE_STATUSES)
const MODIFIABLE_SET = new Set<string>(MODIFIABLE_STATUSES)
const DISCOUNTABLE_SET = new Set<string>(DISCOUNTABLE_STATUSES)
const OPEN_SET = new Set<string>(OPEN_ORDER_STATUSES)
const TERMINAL_SET = new Set<string>(TERMINAL_STATUSES)
const CLOSED_SET = new Set<string>(CLOSED_STATUSES)

/** Can this order accept a payment? */
export function isPayable(status: string): boolean {
  return PAYABLE_SET.has(status)
}

/** Can this order be split? */
export function isSplittable(status: string): boolean {
  return SPLITTABLE_SET.has(status)
}

/** Can this order's metadata be modified? */
export function isModifiable(status: string): boolean {
  return MODIFIABLE_SET.has(status)
}

/** Can a discount be applied to this order? (split parents excluded — discount individual splits instead) */
export function isDiscountable(status: string): boolean {
  return DISCOUNTABLE_SET.has(status)
}

/** Is this a terminal status (no further transitions)? */
export function isTerminal(status: string): boolean {
  return TERMINAL_SET.has(status)
}

/** Is this order still open (not yet paid/closed)? */
export function isOpen(status: string): boolean {
  return OPEN_SET.has(status)
}

/** Is this order in a closed/done state? */
export function isClosed(status: string): boolean {
  return CLOSED_SET.has(status)
}

// ─── Transition Validation ───────────────────────────────────────────────────

/**
 * Validate a status transition via direct update (PUT/PATCH).
 * Returns a TransitionResult with error details if invalid.
 *
 * Note: This does NOT cover payment-driven transitions (→ 'paid').
 * Those are handled by the payment flow's own guards.
 */
export function validateTransition(currentStatus: string, targetStatus: string): TransitionResult {
  // Never allow direct transition to 'paid' via PUT/PATCH
  if (targetStatus === 'paid') {
    return {
      valid: false,
      error: 'Cannot set status to "paid" directly. Use the payment flow (/api/orders/[id]/pay).',
    }
  }

  const allowedNext = VALID_TRANSITIONS[currentStatus as OrderStatus]

  if (!allowedNext) {
    return {
      valid: false,
      error: `Unknown order status: "${currentStatus}"`,
    }
  }

  if (!allowedNext.includes(targetStatus as OrderStatus)) {
    return {
      valid: false,
      error: `Invalid status transition: "${currentStatus}" → "${targetStatus}". Allowed: ${allowedNext.length ? allowedNext.join(', ') : 'none (terminal state)'}`,
      allowedNext: [...allowedNext],
    }
  }

  return { valid: true }
}

/**
 * Order Status Transitions — Single Source of Truth
 *
 * PURE POLICY: No DB, no side effects, no framework types.
 *
 * All order status transition rules are defined here.
 * Routes import these instead of duplicating inline.
 */

import type { TransitionResult } from './types'

// ─── Valid Transitions Map ───────────────────────────────────────────────────

/**
 * Defines which status transitions are allowed via direct updates (PUT/PATCH).
 * Note: 'paid' is NOT reachable via PUT — only through the payment flow.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ['closed', 'void', 'cancelled'],
  draft: ['open', 'closed', 'void', 'cancelled'],
  sent: ['open', 'closed', 'void', 'cancelled'],
  in_progress: ['open', 'closed', 'void', 'cancelled'],
  split: ['open', 'closed', 'void', 'cancelled'],
  closed: ['void'],       // needs manager auth
  void: ['open'],         // reopen via manager override (MGR_VOID_ORDERS)
  voided: ['open'],       // reopen via manager override (MGR_VOID_ORDERS)
  paid: [],               // terminal state — only via payment flow (reopen bypasses transition map)
  cancelled: [],          // terminal state
}

// ─── Status Categories ───────────────────────────────────────────────────────

/** Statuses from which a payment can be processed */
export const PAYABLE_STATUSES: readonly string[] = ['open', 'sent', 'in_progress', 'draft', 'split'] as const

/** Statuses from which an order can be split */
export const SPLITTABLE_STATUSES: readonly string[] = ['open', 'in_progress', 'sent'] as const

/** Statuses that allow order metadata modifications (items, notes, guest count, etc.) */
export const MODIFIABLE_STATUSES: readonly string[] = ['open', 'draft', 'sent', 'in_progress', 'split'] as const

/** Statuses that allow discounts — excludes 'split' because split parents must be discounted on individual splits */
export const DISCOUNTABLE_STATUSES: readonly string[] = ['open', 'draft', 'sent', 'in_progress'] as const

/** Statuses representing an open order (visible in open orders list, blocks shift close) */
export const OPEN_ORDER_STATUSES: readonly string[] = ['open', 'sent', 'in_progress', 'split'] as const

/** Terminal statuses — no further transitions allowed */
export const TERMINAL_STATUSES: readonly string[] = ['void', 'voided', 'paid', 'cancelled'] as const

/** Statuses where the order is considered "done" (paid, closed, or cancelled) */
export const CLOSED_STATUSES: readonly string[] = ['paid', 'closed', 'cancelled', 'voided', 'void'] as const

// ─── Guard Predicates ────────────────────────────────────────────────────────

/** Can this order accept a payment? */
export function isPayable(status: string): boolean {
  return (PAYABLE_STATUSES as readonly string[]).includes(status)
}

/** Can this order be split? */
export function isSplittable(status: string): boolean {
  return (SPLITTABLE_STATUSES as readonly string[]).includes(status)
}

/** Can this order's metadata be modified? */
export function isModifiable(status: string): boolean {
  return (MODIFIABLE_STATUSES as readonly string[]).includes(status)
}

/** Can a discount be applied to this order? (split parents excluded — discount individual splits instead) */
export function isDiscountable(status: string): boolean {
  return (DISCOUNTABLE_STATUSES as readonly string[]).includes(status)
}

/** Is this a terminal status (no further transitions)? */
export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Is this order still open (not yet paid/closed)? */
export function isOpen(status: string): boolean {
  return (OPEN_ORDER_STATUSES as readonly string[]).includes(status)
}

/** Is this order in a closed/done state? */
export function isClosed(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status)
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

  const allowedNext = VALID_TRANSITIONS[currentStatus] ?? []

  if (!allowedNext.includes(targetStatus)) {
    return {
      valid: false,
      error: `Invalid status transition: "${currentStatus}" → "${targetStatus}". Allowed: ${allowedNext.length ? allowedNext.join(', ') : 'none (terminal state)'}`,
      allowedNext,
    }
  }

  return { valid: true }
}

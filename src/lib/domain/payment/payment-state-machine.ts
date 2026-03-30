/**
 * Payment State Machine — formal states and valid transitions.
 *
 * RULE: Payments can ONLY transition through valid states.
 * No route should set payment.status directly — use transitionPaymentState().
 *
 * ## Prisma enum (PaymentStatus):
 *   pending | processing | completed | declined | failed | refunded | voided
 *
 * ## How states are used:
 *   - pending:    Created but not yet submitted (e.g., offline SAF queue, walkout retry)
 *   - processing: Submitted to Datacap, awaiting processor response
 *   - completed:  Approved by processor or cash payment recorded in DB
 *   - declined:   Processor declined the charge (terminal)
 *   - failed:     Unrecoverable processor/network error (terminal)
 *   - voided:     Void confirmed by processor or manager-approved cash void (terminal)
 *   - refunded:   Full refund confirmed by processor (terminal; partial refunds keep 'completed')
 *
 * ## Planned states (require future Prisma migration):
 *   - void_pending:    Void requested, awaiting processor confirmation
 *   - refund_pending:  Refund requested, awaiting processor confirmation
 *   - partial_refund:  At least one partial refund applied (currently stays 'completed')
 */

// ─── States ──────────────────────────────────────────────────────────────────

export const PAYMENT_STATES = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  FAILED: 'failed',
  VOIDED: 'voided',
  REFUNDED: 'refunded',

  // Planned — uncomment after Prisma migration adds these to PaymentStatus enum
  // VOID_PENDING: 'void_pending',
  // REFUND_PENDING: 'refund_pending',
  // PARTIAL_REFUND: 'partial_refund',
} as const

export type PaymentState = (typeof PAYMENT_STATES)[keyof typeof PAYMENT_STATES]

// ─── Valid Transitions ───────────────────────────────────────────────────────
//
// If a transition is NOT in this map, it is ILLEGAL.
//
// Transition diagram:
//
//   pending ──┬──► processing ──┬──► completed ──┬──► voided     (terminal)
//             │                 │        │        │
//             │                 │        │        └──► refunded   (terminal)
//             │                 │        │
//             │                 │        └──► completed (self: partial refund)
//             │                 │
//             │                 ├──► declined     (terminal)
//             │                 ├──► failed       (terminal)
//             │                 └──► voided       (terminal)
//             │
//             ├──► completed    (instant cash/offline approval)
//             ├──► voided       (pre-auth cancel / SAF reject)
//             ├──► declined     (instant rejection)
//             └──► failed       (instant failure)
//
// Note: partial refunds currently keep status = 'completed' and track
// refundedAmount separately. The state machine validates this by allowing
// completed → completed (self-transition for partial refund recording).

const VALID_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  pending: ['processing', 'completed', 'voided', 'declined', 'failed'],
  processing: ['completed', 'declined', 'failed', 'voided'],
  completed: ['voided', 'refunded', 'completed'], // completed→completed = partial refund (status unchanged)
  declined: [],  // terminal — no transitions out
  failed: [],    // terminal — no transitions out
  voided: [],    // terminal — no transitions out
  refunded: [],  // terminal — no transitions out
}

// ─── Transition Functions ────────────────────────────────────────────────────

/**
 * Check whether a state transition is allowed.
 */
export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * Perform a state transition with validation.
 *
 * @throws Error if the transition is invalid
 * @returns The new state (always === targetState on success)
 */
export function transitionPaymentState(
  currentState: PaymentState,
  targetState: PaymentState,
  context?: { paymentId?: string; orderId?: string; reason?: string }
): PaymentState {
  if (!canTransition(currentState, targetState)) {
    const ctx = [
      context?.paymentId ? `payment=${context.paymentId}` : '',
      context?.orderId ? `order=${context.orderId}` : '',
      context?.reason ? `reason=${context.reason}` : '',
    ]
      .filter(Boolean)
      .join(', ')

    throw new Error(
      `Invalid payment state transition: ${currentState} → ${targetState}` +
        (ctx ? ` (${ctx})` : '')
    )
  }
  return targetState
}

// ─── State Classification ────────────────────────────────────────────────────

/**
 * Terminal states — payments in these states MUST NOT contribute to active totals.
 * A payment in a terminal state cannot transition to any other state.
 */
export const TERMINAL_PAYMENT_STATES: readonly PaymentState[] = ['voided', 'refunded', 'declined', 'failed'] as const

/**
 * Active states — payments that contribute to order totals and financial sums.
 *
 * NOTE: 'processing' is active because the charge is in-flight at the processor.
 * It represents money that is expected to settle.
 *
 * NOTE: 'completed' with refundedAmount > 0 is a partial refund. The payment is
 * still active but its effective amount is (amount - refundedAmount). Callers
 * computing totals MUST subtract refundedAmount from completed payments.
 */
export const ACTIVE_PAYMENT_STATES: readonly PaymentState[] = ['pending', 'processing', 'completed'] as const

/**
 * Check if a payment status represents an active (non-terminal) payment.
 *
 * Use this instead of `payment.status === 'completed'` when filtering payments
 * for totals, tip calculations, or split resolution.
 *
 * IMPORTANT: 'pending' is active because SAF (store-and-forward) payments are
 * pending until uploaded. They represent real money owed.
 */
export function isPaymentActive(status: string): boolean {
  return (ACTIVE_PAYMENT_STATES as readonly string[]).includes(status)
}

/**
 * Check if a payment status represents a terminal (irreversible) payment.
 *
 * Payments in terminal states:
 * - Must NOT be included in revenue totals
 * - Must NOT be eligible for tip adjustments
 * - Must NOT be counted in split payment resolution
 */
export function isPaymentTerminal(status: string): boolean {
  return (TERMINAL_PAYMENT_STATES as readonly string[]).includes(status)
}

/**
 * Check if a payment is settled (completed and contributing to revenue).
 *
 * This is stricter than isPaymentActive() — it excludes 'pending' payments
 * that haven't been confirmed by the processor yet. Use this for financial
 * reports and revenue calculations.
 */
export function isPaymentSettled(status: string): boolean {
  return status === PAYMENT_STATES.COMPLETED
}

// ─── Prisma-Compatible Filters ───────────────────────────────────────────────

/**
 * Prisma `where` clause fragment for active (non-terminal) payments.
 *
 * Usage: db.payment.findMany({ where: { ...ACTIVE_PAYMENT_FILTER, orderId } })
 */
export const ACTIVE_PAYMENT_FILTER = {
  status: { in: [...ACTIVE_PAYMENT_STATES] },
  deletedAt: null,
} as const

/**
 * Prisma `where` clause fragment for settled payments only.
 *
 * Usage: db.payment.findMany({ where: { ...SETTLED_PAYMENT_FILTER, orderId } })
 */
export const SETTLED_PAYMENT_FILTER = {
  status: 'completed' as const,
  deletedAt: null,
} as const

/**
 * Prisma `where` clause fragment for terminal (voided/refunded) payments.
 */
export const TERMINAL_PAYMENT_FILTER = {
  status: { in: [...TERMINAL_PAYMENT_STATES] },
  deletedAt: null,
} as const

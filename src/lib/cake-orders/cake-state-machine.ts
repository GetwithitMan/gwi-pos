/**
 * Cake Order State Machine
 *
 * PURE POLICY: No DB, no side effects, no framework types.
 *
 * 11-state lifecycle for custom cake orders.
 * All status transition rules, guards, and permission checks defined here.
 * Routes import these instead of duplicating inline.
 *
 * See plan: zesty-forging-hopcroft.md "State Machine (Canonical)"
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type CakeOrderStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'quoted'
  | 'approved'
  | 'deposit_paid'
  | 'in_production'
  | 'ready'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export interface TransitionContext {
  order: {
    status: string
    balanceDue: number
    depositPaid: number
    depositRequired: number
    customerId: string | null
  }
  quote?: { status: string; version: number; updatedAt: Date } | null
  hasDepositPayment: boolean
  hasBalancePayments: boolean
  requireDeposit: boolean
  reason?: string
  permission: string
}

export interface TransitionResult {
  valid: boolean
  error?: string
  code?: string
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const ALL_STATUSES: readonly CakeOrderStatus[] = [
  'draft', 'submitted', 'under_review', 'quoted', 'approved',
  'deposit_paid', 'in_production', 'ready', 'delivered',
  'completed', 'cancelled',
] as const

export const TERMINAL_STATUSES: readonly CakeOrderStatus[] = ['completed', 'cancelled'] as const

/** Statuses before any deposit has been collected */
export const PRE_DEPOSIT_STATUSES: readonly CakeOrderStatus[] = [
  'draft', 'submitted', 'under_review', 'quoted', 'approved',
] as const

/** Statuses after deposit has been collected (or skipped) */
export const POST_DEPOSIT_STATUSES: readonly CakeOrderStatus[] = [
  'deposit_paid', 'in_production', 'ready', 'delivered',
] as const

/** Statuses where order details (config, delivery, notes) can still be edited */
export const EDITABLE_STATUSES: readonly CakeOrderStatus[] = [
  'draft', 'submitted', 'under_review', 'quoted', 'approved',
  'deposit_paid', 'in_production',
] as const

/** Statuses visible on the baker production page */
export const PRODUCTION_STATUSES: readonly CakeOrderStatus[] = [
  'in_production', 'ready',
] as const

// ─── Valid Transitions Map ──────────────────────────────────────────────────

/**
 * Defines which status transitions are allowed.
 * Guards are enforced separately in validateCakeTransition().
 */
export const VALID_TRANSITIONS: Record<CakeOrderStatus, CakeOrderStatus[]> = {
  draft:          ['submitted', 'cancelled'],
  submitted:      ['under_review', 'quoted', 'cancelled'],
  under_review:   ['quoted', 'cancelled'],
  quoted:         ['approved', 'cancelled'],
  approved:       ['deposit_paid', 'in_production', 'cancelled'],
  deposit_paid:   ['in_production', 'cancelled'],
  in_production:  ['ready', 'deposit_paid', 'cancelled'],
  ready:          ['delivered', 'cancelled'],
  delivered:      ['completed', 'cancelled'],
  completed:      [],   // terminal
  cancelled:      [],   // terminal
}

// ─── Permission Map ─────────────────────────────────────────────────────────

/**
 * Required permission for each transition.
 * Key format: "from:to"
 */
const PERMISSION_MAP: Record<string, string> = {
  // Forward transitions
  'draft:submitted':           'cake.create',
  'submitted:under_review':    'cake.edit',
  'submitted:quoted':          'cake.quote',
  'under_review:quoted':       'cake.quote',
  'quoted:approved':           'cake.quote_approve',
  'approved:deposit_paid':     'cake.payment',
  'approved:in_production':    'cake.edit',       // requireDeposit=false path
  'deposit_paid:in_production':'cake.edit',
  'in_production:ready':       'cake.edit',
  'ready:delivered':           'cake.edit',
  'delivered:completed':       'cake.edit',

  // Rollback
  'in_production:deposit_paid':'cake.edit',

  // Cancellations — pre-deposit use cake.edit, post-deposit use cake.cancel
  'draft:cancelled':           'cake.edit',
  'submitted:cancelled':       'cake.edit',
  'under_review:cancelled':    'cake.edit',
  'quoted:cancelled':          'cake.edit',
  'approved:cancelled':        'cake.edit',
  'deposit_paid:cancelled':    'cake.cancel',
  'in_production:cancelled':   'cake.cancel',
  'ready:cancelled':           'cake.cancel',
  'delivered:cancelled':       'cake.cancel',
}

// ─── Timestamp Field Map ────────────────────────────────────────────────────

const TIMESTAMP_FIELDS: Record<CakeOrderStatus, string | null> = {
  draft:          null,
  submitted:      'submittedAt',
  under_review:   null,
  quoted:         'quotedAt',
  approved:       'approvedAt',
  deposit_paid:   'depositPaidAt',
  in_production:  'productionStartedAt',
  ready:          'readyAt',
  delivered:      'deliveredAt',
  completed:      'completedAt',
  cancelled:      'cancelledAt',
}

// ─── Guard Predicates ───────────────────────────────────────────────────────

/** Is this a terminal status (no further transitions)? */
export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

/** Is this order in a pre-deposit state? */
export function isPreDeposit(status: string): boolean {
  return (PRE_DEPOSIT_STATUSES as readonly string[]).includes(status)
}

/** Is this order in a post-deposit state? */
export function isPostDeposit(status: string): boolean {
  return (POST_DEPOSIT_STATUSES as readonly string[]).includes(status)
}

/** Can order details be edited in this status? */
export function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status)
}

// ─── Transition Validation ──────────────────────────────────────────────────

/**
 * Validate a cake order status transition with full guard checks.
 *
 * PURE FUNCTION: No DB access, no side effects.
 * All data needed for guards is passed via TransitionContext.
 */
export function validateCakeTransition(
  current: CakeOrderStatus,
  target: CakeOrderStatus,
  ctx: TransitionContext
): TransitionResult {
  // 1. Check if transition is structurally allowed
  const allowedNext = VALID_TRANSITIONS[current] ?? []
  if (!allowedNext.includes(target)) {
    return {
      valid: false,
      error: `Invalid status transition: "${current}" -> "${target}". Allowed: ${
        allowedNext.length ? allowedNext.join(', ') : 'none (terminal state)'
      }`,
      code: 'INVALID_TRANSITION',
    }
  }

  // 2. Permission check
  const requiredPermission = getRequiredPermission(current, target)
  if (ctx.permission !== requiredPermission) {
    return {
      valid: false,
      error: `Transition "${current}" -> "${target}" requires permission "${requiredPermission}", but actor has "${ctx.permission}"`,
      code: 'PERMISSION_DENIED',
    }
  }

  // 3. Guard: draft -> submitted requires customerId
  if (current === 'draft' && target === 'submitted') {
    if (!ctx.order.customerId) {
      return {
        valid: false,
        error: 'Customer is required before submitting. Use customer lookup/create first.',
        code: 'CUSTOMER_REQUIRED',
      }
    }
  }

  // 4. Guard: -> approved requires quote with status='approved'
  if (target === 'approved') {
    if (!ctx.quote) {
      return {
        valid: false,
        error: 'Cannot approve without an active quote.',
        code: 'QUOTE_REQUIRED',
      }
    }
    if (ctx.quote.status !== 'approved') {
      return {
        valid: false,
        error: `Quote must have status "approved", but has "${ctx.quote.status}". Quote may have been voided or expired.`,
        code: 'QUOTE_NOT_APPROVED',
      }
    }
  }

  // 5. Guard: -> deposit_paid requires hasDepositPayment
  if (target === 'deposit_paid') {
    // Rollback from in_production is allowed without new deposit
    if (current !== 'in_production' && !ctx.hasDepositPayment) {
      return {
        valid: false,
        error: 'Deposit payment must be recorded before transitioning to deposit_paid.',
        code: 'DEPOSIT_PAYMENT_REQUIRED',
      }
    }
  }

  // 6. Guard: approved -> in_production only if requireDeposit=false
  if (current === 'approved' && target === 'in_production') {
    if (ctx.requireDeposit) {
      return {
        valid: false,
        error: 'Deposit is required. Transition to deposit_paid first, then to in_production.',
        code: 'DEPOSIT_REQUIRED',
      }
    }
  }

  // 7. Guard: rollback in_production -> deposit_paid blocks if hasBalancePayments
  if (current === 'in_production' && target === 'deposit_paid') {
    if (ctx.hasBalancePayments) {
      return {
        valid: false,
        error: 'Cannot rollback — order has balance payments. Refund first.',
        code: 'ROLLBACK_BLOCKED_BY_PAYMENTS',
      }
    }
    if (!ctx.reason || ctx.reason.trim().length === 0) {
      return {
        valid: false,
        error: 'Reason is required for production rollback.',
        code: 'REASON_REQUIRED',
      }
    }
  }

  // 8. Guard: delivered -> completed requires balanceDue <= 0
  if (current === 'delivered' && target === 'completed') {
    if (ctx.order.balanceDue > 0) {
      return {
        valid: false,
        error: `Cannot complete — balance due is $${ctx.order.balanceDue.toFixed(2)}. Collect remaining balance first.`,
        code: 'BALANCE_DUE',
      }
    }
  }

  // 9. Guard: all cancellations require reason
  if (target === 'cancelled') {
    if (!ctx.reason || ctx.reason.trim().length === 0) {
      return {
        valid: false,
        error: 'Cancellation reason is required.',
        code: 'REASON_REQUIRED',
      }
    }
  }

  return { valid: true }
}

// ─── Exported Helpers ───────────────────────────────────────────────────────

/**
 * Returns the timestamp field name that should be set when transitioning to the given status.
 * Returns null if no timestamp field is associated (e.g., draft, under_review).
 */
export function getTimestampField(status: CakeOrderStatus): string | null {
  return TIMESTAMP_FIELDS[status] ?? null
}

/**
 * Returns the permission key required for a given transition.
 * Throws if the transition is not in the map (invalid transition).
 */
export function getRequiredPermission(current: CakeOrderStatus, target: CakeOrderStatus): string {
  const key = `${current}:${target}`
  const permission = PERMISSION_MAP[key]
  if (!permission) {
    throw new Error(`No permission defined for transition "${current}" -> "${target}". Is this a valid transition?`)
  }
  return permission
}

/**
 * Get all valid target statuses from a given status.
 */
export function validTargets(from: CakeOrderStatus): CakeOrderStatus[] {
  return VALID_TRANSITIONS[from] ?? []
}

/**
 * Check if a transition is structurally valid (ignores guards).
 */
export function canTransition(from: CakeOrderStatus, to: CakeOrderStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to)
}

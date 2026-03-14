/**
 * Order Status Domain Types
 *
 * Single source of truth for order lifecycle statuses,
 * valid transitions, and status guard predicates.
 */

export type OrderStatus =
  | 'draft'
  | 'open'
  | 'sent'
  | 'in_progress'
  | 'split'
  | 'paid'
  | 'closed'
  | 'void'
  | 'voided'
  | 'cancelled'

export interface TransitionResult {
  valid: boolean
  error?: string
  allowedNext?: string[]
}

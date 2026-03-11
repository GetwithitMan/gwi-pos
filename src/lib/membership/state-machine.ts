/**
 * Membership state machine — validates status and billing transitions.
 */
import { MembershipStatus, BillingStatus } from './types'

const VALID_STATUS_TRANSITIONS: Record<MembershipStatus, MembershipStatus[]> = {
  [MembershipStatus.TRIAL]:     [MembershipStatus.ACTIVE, MembershipStatus.CANCELLED],
  [MembershipStatus.ACTIVE]:    [MembershipStatus.PAUSED, MembershipStatus.CANCELLED, MembershipStatus.EXPIRED],
  [MembershipStatus.PAUSED]:    [MembershipStatus.ACTIVE, MembershipStatus.CANCELLED],
  [MembershipStatus.CANCELLED]: [MembershipStatus.ACTIVE], // re-enrollment
  [MembershipStatus.EXPIRED]:   [],
}

const VALID_BILLING_TRANSITIONS: Record<BillingStatus, BillingStatus[]> = {
  [BillingStatus.CURRENT]:         [BillingStatus.PAST_DUE, BillingStatus.RETRY_SCHEDULED],
  [BillingStatus.PAST_DUE]:        [BillingStatus.RETRY_SCHEDULED, BillingStatus.CURRENT, BillingStatus.UNCOLLECTIBLE],
  [BillingStatus.RETRY_SCHEDULED]: [BillingStatus.CURRENT, BillingStatus.PAST_DUE, BillingStatus.UNCOLLECTIBLE],
  [BillingStatus.UNCOLLECTIBLE]:   [BillingStatus.CURRENT], // card update
}

export function assertStatusTransition(from: MembershipStatus, to: MembershipStatus): void {
  const allowed = VALID_STATUS_TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid membership status transition: ${from} → ${to}`)
  }
}

export function assertBillingTransition(from: BillingStatus, to: BillingStatus): void {
  const allowed = VALID_BILLING_TRANSITIONS[from]
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid billing status transition: ${from} → ${to}`)
  }
}

export function canTransitionStatus(from: MembershipStatus, to: MembershipStatus): boolean {
  const allowed = VALID_STATUS_TRANSITIONS[from]
  return !!allowed && allowed.includes(to)
}

export function canTransitionBilling(from: BillingStatus, to: BillingStatus): boolean {
  const allowed = VALID_BILLING_TRANSITIONS[from]
  return !!allowed && allowed.includes(to)
}

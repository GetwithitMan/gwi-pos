/**
 * Membership system types — canonical type definitions.
 * All membership files import from here.
 */

// ── Enums ───────────────────────────────────────────────────────────────────

export enum BillingCycle {
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ANNUAL = 'annual',
}

export enum MembershipStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export enum BillingStatus {
  CURRENT = 'current',
  PAST_DUE = 'past_due',
  RETRY_SCHEDULED = 'retry_scheduled',
  UNCOLLECTIBLE = 'uncollectible',
}

export enum ChargeStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DECLINED = 'declined',
  VOIDED = 'voided',
  REFUNDED = 'refunded',
}

export enum ChargeType {
  SETUP_FEE = 'setup_fee',
  INITIAL = 'initial',
  RENEWAL = 'renewal',
  RETRY = 'retry',
  PRORATION = 'proration',
  MANUAL = 'manual',
}

export enum FailureType {
  DECLINE = 'decline',
  PROCESSOR_ERROR = 'processor_error',
  TIMEOUT = 'timeout',
  CONFIG_ERROR = 'config_error',
}

export enum MembershipEventType {
  CREATED = 'created',
  TRIAL_STARTED = 'trial_started',
  ACTIVATED = 'activated',
  CHARGE_SUCCESS = 'charge_success',
  CHARGE_FAILED = 'charge_failed',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  CARD_UPDATED = 'card_updated',
  PLAN_CHANGED = 'plan_changed',
  PRICE_CHANGED = 'price_changed',
  REACTIVATED = 'reactivated',
  DUNNING_STARTED = 'dunning_started',
  DUNNING_ESCALATED = 'dunning_escalated',
  MARKED_UNCOLLECTIBLE = 'marked_uncollectible',
}

// ── Decline Classification ──────────────────────────────────────────────────

export type DeclineCategory =
  | 'hard_decline'
  | 'soft_decline'
  | 'processor_error'
  | 'config_error'
  | 'unknown'

export interface DeclineClassification {
  category: DeclineCategory
  retryable: boolean
  message: string
}

// ── Table Interfaces ────────────────────────────────────────────────────────

export interface MembershipPlan {
  id: string
  locationId: string
  name: string
  description: string | null
  price: number // stored as DECIMAL(10,2)
  billingCycle: BillingCycle
  billingDayOfMonth: number | null
  billingDayOfWeek: number | null
  trialDays: number
  setupFee: number
  benefits: Record<string, unknown> | null
  maxMembers: number | null
  isActive: boolean
  sortOrder: number
  currency: string
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  syncedAt: Date | null
}

export interface Membership {
  id: string
  locationId: string
  customerId: string
  planId: string
  savedCardId: string | null

  status: MembershipStatus
  billingStatus: BillingStatus
  statusReason: string | null

  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  nextBillingDate: Date | null
  trialEndsAt: Date | null

  priceAtSignup: number | null
  billingCycle: BillingCycle | null
  currency: string
  billingTimezone: string | null

  recurringData: string | null
  lastToken: string | null

  version: number

  startedAt: Date | null
  endedAt: Date | null
  lastChargedAt: Date | null
  lastChargeId: string | null

  failedAttempts: number
  lastFailedAt: Date | null
  lastFailReason: string | null
  nextRetryAt: Date | null

  pausedAt: Date | null
  pauseResumeDate: Date | null

  cancelledAt: Date | null
  cancellationReason: string | null
  cancelAtPeriodEnd: boolean
  cancelEffectiveAt: Date | null

  billingLockedAt: Date | null
  billingLockId: string | null
  billingLockExpiresAt: Date | null

  enrolledByEmployeeId: string | null

  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  syncedAt: Date | null
}

export interface MembershipCharge {
  id: string
  locationId: string
  membershipId: string

  subtotalAmount: number | null
  taxAmount: number | null
  totalAmount: number | null

  status: ChargeStatus
  chargeType: ChargeType
  failureType: FailureType | null
  attemptNumber: number
  retryNumber: number

  periodStart: Date | null
  periodEnd: Date | null

  isProrated: boolean
  proratedFromAmount: number | null

  datacapRefNo: string | null
  datacapAuthCode: string | null
  datacapToken: string | null
  recurringDataSent: string | null
  recurringDataReceived: string | null
  invoiceNo: string | null

  declineReason: string | null
  returnCode: string | null
  processorResponseMessage: string | null

  idempotencyKey: string | null

  requestStartedAt: Date | null
  responseReceivedAt: Date | null
  processedAt: Date | null

  createdAt: Date
  updatedAt: Date
}

export interface MembershipEvent {
  id: string
  locationId: string
  membershipId: string
  eventType: MembershipEventType
  details: Record<string, unknown> | null
  employeeId: string | null
  createdAt: Date
}

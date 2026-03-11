/**
 * Idempotency key generation for membership charges.
 * Prevents duplicate charges on retry / cron overlap.
 */
import { ChargeType } from './types'

interface RenewalParams {
  membershipId: string
  periodStart: Date
}

interface SetupFeeParams {
  membershipId: string
  signupAt: Date
}

interface RetryParams {
  membershipId: string
  chargeId: string
  attempt: number
}

interface ProrationParams {
  membershipId: string
  effectiveDate: Date
}

interface ManualParams {
  membershipId: string
  requestId: string
}

interface InitialParams {
  membershipId: string
  periodStart: Date
}

type IdempotencyParams =
  | { type: ChargeType.RENEWAL; params: RenewalParams }
  | { type: ChargeType.SETUP_FEE; params: SetupFeeParams }
  | { type: ChargeType.RETRY; params: RetryParams }
  | { type: ChargeType.PRORATION; params: ProrationParams }
  | { type: ChargeType.MANUAL; params: ManualParams }
  | { type: ChargeType.INITIAL; params: InitialParams }

function isoDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

export function buildIdempotencyKey(input: IdempotencyParams): string {
  switch (input.type) {
    case ChargeType.RENEWAL:
      return `mbr_${input.params.membershipId}_renewal_${isoDate(input.params.periodStart)}`
    case ChargeType.SETUP_FEE:
      return `mbr_${input.params.membershipId}_setup_${isoDate(input.params.signupAt)}`
    case ChargeType.RETRY:
      return `mbr_${input.params.membershipId}_retry_${input.params.chargeId}_${input.params.attempt}`
    case ChargeType.PRORATION:
      return `mbr_${input.params.membershipId}_proration_${isoDate(input.params.effectiveDate)}`
    case ChargeType.MANUAL:
      return `mbr_${input.params.membershipId}_manual_${input.params.requestId}`
    case ChargeType.INITIAL:
      return `mbr_${input.params.membershipId}_initial_${isoDate(input.params.periodStart)}`
  }
}

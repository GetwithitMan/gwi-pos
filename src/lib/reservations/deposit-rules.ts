/**
 * Deposit Rules Engine — evaluate, snapshot, refund, and manage deposit tokens
 *
 * Uses the DepositRules interface from settings.ts.
 * Amounts are in cents throughout (matching defaultAmountCents / perGuestAmountCents).
 */

import { PrismaClient } from '@prisma/client'
import { DepositRules } from '../settings'
import crypto from 'crypto'

// ─── Evaluation ─────────────────────────────────────────────────────────────

interface DepositEvaluation {
  required: boolean
  amount: number // in cents
  reasons: string[] // why deposit triggered
}

/**
 * Evaluate whether a deposit is required for a reservation.
 * OR logic: any matching condition triggers the requirement.
 */
export function evaluateDepositRequired(params: {
  partySize: number
  reservationDate: string // YYYY-MM-DD
  reservationTime: string // HH:MM
  isOnlineBooking?: boolean
  rules: DepositRules
}): DepositEvaluation {
  const { partySize, reservationDate, rules, isOnlineBooking } = params

  if (!rules.enabled) {
    return { required: false, amount: 0, reasons: [] }
  }

  const reasons: string[] = []

  // Party size threshold (0 = require for all)
  if (rules.partySizeThreshold > 0 && partySize >= rules.partySizeThreshold) {
    reasons.push('party_size')
  } else if (rules.partySizeThreshold === 0) {
    reasons.push('all_reservations')
  }

  // Large party override
  if (rules.forceForLargeParty && partySize >= rules.largePartyThreshold) {
    if (!reasons.includes('party_size')) {
      reasons.push('large_party')
    }
  }

  // Weekend check (Fri=5, Sat=6, Sun=0)
  const date = new Date(reservationDate + 'T12:00:00') // noon to avoid TZ issues
  const dayOfWeek = date.getDay()
  if (dayOfWeek === 0 || dayOfWeek === 5 || dayOfWeek === 6) {
    // Weekend — only add reason if threshold matched (weekend alone doesn't force deposit
    // unless partySizeThreshold is 0, meaning all reservations require deposit)
  }

  // Online booking override
  if (rules.forceForOnline && isOnlineBooking) {
    reasons.push('online_booking')
  }

  if (reasons.length === 0) {
    return { required: false, amount: 0, reasons: [] }
  }

  // Calculate amount based on deposit mode
  let amount = 0
  switch (rules.depositMode) {
    case 'flat':
      amount = rules.defaultAmountCents
      break
    case 'per_guest':
      amount = rules.perGuestAmountCents * partySize
      break
    case 'percentage':
      // Percentage mode requires an estimated spend — fall back to flat if not available
      amount = rules.defaultAmountCents
      break
  }

  return { required: true, amount, reasons }
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface DepositRulesSnapshot {
  rules: DepositRules
  evaluatedAt: string // ISO timestamp
  reasons: string[]
  amountCents: number
}

/**
 * Capture a point-in-time snapshot of the deposit rules + evaluation.
 * Stored on the reservation for audit trail (rules may change after booking).
 */
export function snapshotDepositRules(
  rules: DepositRules,
  evaluation: DepositEvaluation
): DepositRulesSnapshot {
  return {
    rules,
    evaluatedAt: new Date().toISOString(),
    reasons: evaluation.reasons,
    amountCents: evaluation.amount,
  }
}

// ─── Refund Calculation ─────────────────────────────────────────────────────

interface RefundResult {
  refundAmountCents: number
  refundPercent: number
  tier: 'full' | 'partial' | 'none'
}

/**
 * Calculate refund amount based on cancellation timing and deposit rules.
 *
 * Tiers (based on refundableBefore):
 * - 'always'  → 100% refund minus nonRefundablePercent
 * - 'cutoff'  → full if before cutoff hours, none after
 * - 'never'   → 0% refund always
 */
export function calculateRefund(params: {
  depositAmountCents: number
  hoursUntilReservation: number
  rules: DepositRules
}): RefundResult {
  const { depositAmountCents, hoursUntilReservation, rules } = params

  if (depositAmountCents <= 0) {
    return { refundAmountCents: 0, refundPercent: 0, tier: 'none' }
  }

  switch (rules.refundableBefore) {
    case 'always': {
      // Always refundable, minus nonRefundablePercent
      const refundPercent = 100 - rules.nonRefundablePercent
      const refundAmountCents = Math.round(depositAmountCents * (refundPercent / 100))
      return {
        refundAmountCents,
        refundPercent,
        tier: refundPercent === 100 ? 'full' : 'partial',
      }
    }

    case 'cutoff': {
      if (hoursUntilReservation >= rules.refundCutoffHours) {
        // Before cutoff — full refund minus nonRefundablePercent
        const refundPercent = 100 - rules.nonRefundablePercent
        const refundAmountCents = Math.round(depositAmountCents * (refundPercent / 100))
        return {
          refundAmountCents,
          refundPercent,
          tier: refundPercent === 100 ? 'full' : 'partial',
        }
      }
      // After cutoff — no refund
      return { refundAmountCents: 0, refundPercent: 0, tier: 'none' }
    }

    case 'never':
      return { refundAmountCents: 0, refundPercent: 0, tier: 'none' }

    default:
      return { refundAmountCents: 0, refundPercent: 0, tier: 'none' }
  }
}

// ─── Deposit Tokens ─────────────────────────────────────────────────────────

/**
 * Generate a unique deposit payment token with expiration.
 * Used for text-to-pay deposit links.
 */
export async function generateDepositToken(
  reservationId: string,
  holdMinutes: number,
  db: PrismaClient
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + holdMinutes * 60 * 1000)

  await db.reservationDepositToken.create({
    data: {
      token,
      reservationId,
      expiresAt,
    },
  })

  return { token, expiresAt }
}

/**
 * Validate a deposit token — check existence, expiry, usage, and reservation status.
 */
export async function validateDepositToken(
  token: string,
  db: PrismaClient
): Promise<{
  valid: boolean
  reservation?: any
  reason?: 'expired' | 'used' | 'not_found' | 'reservation_cancelled'
}> {
  const record = await db.reservationDepositToken.findUnique({
    where: { token },
    include: { reservation: true },
  })

  if (!record) {
    return { valid: false, reason: 'not_found' }
  }

  if (record.usedAt) {
    return { valid: false, reason: 'used' }
  }

  if (record.expiresAt < new Date()) {
    return { valid: false, reason: 'expired' }
  }

  if (record.reservation.status === 'cancelled' || record.reservation.status === 'no_show') {
    return { valid: false, reason: 'reservation_cancelled' }
  }

  return { valid: true, reservation: record.reservation }
}

/**
 * Mark a deposit token as used (after successful payment).
 */
export async function markDepositTokenUsed(token: string, db: PrismaClient): Promise<void> {
  await db.reservationDepositToken.update({
    where: { token },
    data: { usedAt: new Date() },
  })
}

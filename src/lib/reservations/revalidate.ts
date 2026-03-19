/**
 * Reservation Revalidation Engine
 *
 * Used by admin modify, guest modify, and host seating change flows.
 * Checks: availability, deposit delta, refund amount, turn time, table fit,
 * cutoff enforcement, and staff override requirements.
 */

import type { PrismaClient } from '@/generated/prisma/client'
import type { ReservationSettings, DepositRules } from '@/lib/settings'
import { checkSlotAvailability, type OperatingHours } from './availability'
import { evaluateDepositRequired } from './deposit-rules'
import { calculateRefund } from './deposit-rules'
import { suggestTables } from './table-suggestion'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RevalidationParams {
  reservationId: string
  locationId: string
  /** Proposed changes (only fields being modified) */
  proposed: {
    date?: string          // YYYY-MM-DD
    time?: string          // HH:MM
    partySize?: number
    duration?: number
    tableId?: string | null
    sectionPreference?: string | null
  }
  /** Current reservation data */
  current: {
    reservationDate: Date
    reservationTime: string
    partySize: number
    duration: number
    tableId: string | null
    depositStatus: string | null
    depositAmountCents: number | null
    status: string
  }
  actor: { type: 'guest' | 'staff' | 'cron' | 'integration'; id?: string }
  db: PrismaClient
  settings: ReservationSettings
  depositRules: DepositRules
  operatingHours?: OperatingHours | null
}

export interface RevalidationResult {
  allowed: boolean
  staffOverrideRequired: boolean
  reasons: string[]
  warnings: string[]
  /** Slot availability check result */
  slotAvailable: boolean
  /** Table suggestion if table changed or none assigned */
  suggestedTableId?: string | null
  suggestedTableName?: string
  /** Deposit impact */
  depositDelta: number          // cents: positive = additional deposit needed, negative = refund
  currentDepositCents: number
  newDepositCents: number
  refundAmountCents: number
  refundTier: 'full' | 'partial' | 'none'
  /** Cutoff info */
  hoursUntilReservation: number
  withinModificationCutoff: boolean
  withinCancellationCutoff: boolean
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function repriceAndRevalidate(
  params: RevalidationParams
): Promise<RevalidationResult> {
  const {
    reservationId,
    locationId,
    proposed,
    current,
    actor,
    db,
    settings,
    depositRules,
    operatingHours,
  } = params

  const reasons: string[] = []
  const warnings: string[] = []
  let staffOverrideRequired = false
  let slotAvailable = true
  let suggestedTableId: string | null | undefined
  let suggestedTableName: string | undefined

  // ── Effective values (current merged with proposed) ──
  const effectiveDate = proposed.date || formatDate(current.reservationDate)
  const effectiveTime = proposed.time || current.reservationTime
  const effectivePartySize = proposed.partySize ?? current.partySize
  const effectiveDuration = proposed.duration ?? current.duration
  const effectiveTableId = proposed.tableId !== undefined ? proposed.tableId : current.tableId

  // ── Cutoff calculations ──
  const reservationDateTime = new Date(`${effectiveDate}T${effectiveTime}:00`)
  const now = new Date()
  const hoursUntilReservation = Math.max(0, (reservationDateTime.getTime() - now.getTime()) / (1000 * 60 * 60))
  const withinModificationCutoff = hoursUntilReservation < settings.modificationCutoffHours
  const withinCancellationCutoff = hoursUntilReservation < settings.cancellationCutoffHours

  // ── Guest cutoff enforcement ──
  if (actor.type === 'guest') {
    if (withinModificationCutoff) {
      reasons.push(`Cannot modify within ${settings.modificationCutoffHours} hours of reservation`)
    }

    // Guest cannot change party size in MVP (only date/time)
    if (proposed.partySize !== undefined && proposed.partySize !== current.partySize) {
      reasons.push('Party size changes require staff assistance')
      staffOverrideRequired = true
    }
  }

  // ── Availability check (for date/time/partySize changes) ──
  const hasTimingChange = proposed.date !== undefined || proposed.time !== undefined
  const hasPartySizeChange = proposed.partySize !== undefined && proposed.partySize !== current.partySize

  if (hasTimingChange || hasPartySizeChange) {
    const avail = await checkSlotAvailability({
      locationId,
      date: effectiveDate,
      time: effectiveTime,
      partySize: effectivePartySize,
      durationMinutes: effectiveDuration,
      db,
      settings,
      operatingHours,
      excludeReservationId: reservationId,
    })

    slotAvailable = avail.available
    if (!avail.available) {
      reasons.push(avail.reason || 'Slot no longer available')
    }
  }

  // ── Table fit check ──
  if (hasPartySizeChange || proposed.tableId !== undefined) {
    // Re-suggest table for new party size
    const suggestions = await suggestTables({
      locationId,
      date: effectiveDate,
      time: effectiveTime,
      partySize: effectivePartySize,
      durationMinutes: effectiveDuration,
      db,
      settings,
      operatingHours,
      sectionPreference: proposed.sectionPreference ?? undefined,
      excludeReservationId: reservationId,
    })

    if (suggestions.length > 0) {
      // Check if current table still fits
      const currentTableStillFits = effectiveTableId
        ? suggestions.some(s => s.table.id === effectiveTableId)
        : false

      if (!currentTableStillFits) {
        suggestedTableId = suggestions[0].table.id
        suggestedTableName = suggestions[0].table.name
        if (effectiveTableId) {
          warnings.push(`Current table may not fit party of ${effectivePartySize}. Suggested: ${suggestedTableName}`)
        }
      } else {
        suggestedTableId = effectiveTableId
      }
    } else if (hasPartySizeChange && !slotAvailable) {
      // Already captured in availability check
    } else if (suggestions.length === 0) {
      warnings.push('No suitable table found for the proposed changes')
    }
  }

  // ── Deposit recalculation ──
  const currentDepositCents = current.depositAmountCents || 0
  const newEval = evaluateDepositRequired({
    partySize: effectivePartySize,
    reservationDate: effectiveDate,
    reservationTime: effectiveTime,
    rules: depositRules,
  })
  const newDepositCents = newEval.required ? newEval.amount : 0
  const depositDelta = newDepositCents - currentDepositCents

  // Refund calculation for existing deposit
  let refundAmountCents = 0
  let refundTier: 'full' | 'partial' | 'none' = 'none'

  if (currentDepositCents > 0 && depositDelta < 0) {
    // Deposit decreased — calculate refund for the difference
    const refund = calculateRefund({
      depositAmountCents: Math.abs(depositDelta),
      hoursUntilReservation,
      rules: depositRules,
    })
    refundAmountCents = refund.refundAmountCents
    refundTier = refund.tier
  } else if (currentDepositCents > 0 && current.depositStatus === 'paid') {
    // Even with no delta, provide refund info in case of cancellation
    const refund = calculateRefund({
      depositAmountCents: currentDepositCents,
      hoursUntilReservation,
      rules: depositRules,
    })
    refundAmountCents = refund.refundAmountCents
    refundTier = refund.tier
  }

  // ── Deposit increase on same-day → staff override ──
  if (depositDelta > 0 && hoursUntilReservation < 24) {
    staffOverrideRequired = true
    warnings.push('Additional deposit required for same-day modification — staff approval needed')
  }

  // ── Final determination ──
  const allowed = reasons.length === 0

  return {
    allowed,
    staffOverrideRequired,
    reasons,
    warnings,
    slotAvailable,
    suggestedTableId,
    suggestedTableName,
    depositDelta,
    currentDepositCents,
    newDepositCents,
    refundAmountCents,
    refundTier,
    hoursUntilReservation,
    withinModificationCutoff,
    withinCancellationCutoff,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  const d = new Date(date)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

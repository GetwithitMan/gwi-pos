/**
 * Reservation State Machine
 *
 * THE canonical state transition function. ALL status changes MUST go through this.
 * Validates transitions, enforces guards, writes events, and fires socket dispatch.
 */

import type { PrismaClient } from '@prisma/client'
// Socket dispatch is caller's responsibility — import removed to enforce post-commit pattern

// ─── Types ──────────────────────────────────────────────────────────────────

export type ReservationStatus = 'pending' | 'confirmed' | 'checked_in' | 'seated' | 'completed' | 'cancelled' | 'no_show'

export type ActorType = 'guest' | 'staff' | 'cron' | 'integration'
export interface Actor {
  type: ActorType
  id?: string
}

export const OVERRIDE_TYPES = [
  'late_arrival', 'did_not_dine', 'manager_force_book', 'deposit_override',
  'block_override', 'blacklist_override', 'no_show_reversal',
] as const
export type OverrideType = typeof OVERRIDE_TYPES[number]

export const TERMINAL_STATUSES: ReservationStatus[] = ['completed', 'cancelled', 'no_show']

export const EVENT_TYPES = [
  'created', 'modified', 'confirmed', 'checked_in', 'seated', 'completed',
  'cancelled', 'no_show_marked', 'no_show_overridden', 'deposit_requested',
  'deposit_paid', 'deposit_refunded', 'deposit_forfeited', 'deposit_auto_refunded_after_cancel',
  'confirmation_sent', 'reminder_24h_sent', 'reminder_2h_sent', 'cancellation_sent',
  'thank_you_sent', 'custom_message_sent', 'table_assigned', 'table_changed',
  'party_size_changed', 'override_applied', 'block_conflict_warning',
  'slot_offered', 'slot_claimed', 'checkin_ambiguous',
  'integration_sync_in', 'integration_sync_out',
] as const
export type EventType = typeof EVENT_TYPES[number]

export const SOURCE_TYPES = ['staff', 'online', 'waitlist', 'opentable', 'resy', 'google', 'yelp', 'import', 'other'] as const
export type SourceType = typeof SOURCE_TYPES[number]

// ─── Transition Table ───────────────────────────────────────────────────────

interface TransitionRule {
  requireStaff?: boolean
  requireReason?: boolean
  eventType: EventType
  /** For guest cancellations: check cancellationCutoffHours */
  checkCutoff?: boolean
  /** Deposit handling on cancel */
  autoRefundDeposit?: boolean
}

/**
 * Map of allowed transitions: `from:to` → guards.
 */
const TRANSITIONS: Record<string, TransitionRule> = {
  'pending:confirmed':    { eventType: 'confirmed' },
  'pending:cancelled':    { eventType: 'cancelled', autoRefundDeposit: true },
  'confirmed:checked_in': { eventType: 'checked_in' },
  'confirmed:seated':     { eventType: 'seated' },
  'checked_in:seated':    { eventType: 'seated' },
  'confirmed:cancelled':  { eventType: 'cancelled', checkCutoff: true, autoRefundDeposit: true },
  'confirmed:no_show':    { eventType: 'no_show_marked' },
  'seated:completed':     { eventType: 'completed' },
  'seated:cancelled':     { eventType: 'cancelled', requireStaff: true, requireReason: true },
  'no_show:confirmed':    { eventType: 'no_show_overridden', requireStaff: true, requireReason: true, requireOverride: true },
  'no_show:seated':       { eventType: 'seated', requireStaff: true, requireReason: true, requireOverride: true },
}

// ─── Transition Function ────────────────────────────────────────────────────

export class TransitionError extends Error {
  constructor(message: string, public code: string = 'INVALID_TRANSITION') {
    super(message)
    this.name = 'TransitionError'
  }
}

export async function transition(params: {
  reservationId: string
  to: ReservationStatus
  actor: Actor
  reason?: string
  overrideType?: OverrideType
  db: PrismaClient
  locationId: string
}): Promise<any> {
  const { reservationId, to, actor, reason, overrideType, db: txDb, locationId } = params

  // 1. Load reservation with row lock (within caller's transaction)
  const rows: any[] = await txDb.$queryRaw`
    SELECT * FROM "Reservation"
    WHERE id = ${reservationId} AND "locationId" = ${locationId}
    FOR UPDATE
  `

  if (rows.length === 0) {
    throw new TransitionError('Reservation not found', 'NOT_FOUND')
  }

  const reservation = rows[0]
  const from = reservation.status as ReservationStatus

  // 2. Validate transition is allowed
  const key = `${from}:${to}`
  const rule = TRANSITIONS[key]
  if (!rule) {
    throw new TransitionError(
      `Invalid transition: ${from} → ${to}`,
      'INVALID_TRANSITION'
    )
  }

  // 3. Check guards
  if (rule.requireStaff && actor.type !== 'staff') {
    throw new TransitionError(
      `Only staff can transition ${from} → ${to}`,
      'STAFF_REQUIRED'
    )
  }

  if (rule.requireReason && (!reason || reason.trim().length === 0)) {
    throw new TransitionError(
      `Reason required for ${from} → ${to}`,
      'REASON_REQUIRED'
    )
  }

  if ((rule as any).requireOverride && !overrideType) {
    throw new TransitionError(
      `Override type required for ${from} → ${to}`,
      'OVERRIDE_REQUIRED'
    )
  }

  // Cutoff check for guest cancellations
  if (rule.checkCutoff && actor.type === 'guest') {
    const settings = await loadReservationSettings(txDb, locationId)
    const cutoffHours = settings.cancellationCutoffHours ?? 2
    const reservationDateTime = combineDateAndTime(
      reservation.reservationDate,
      reservation.reservationTime
    )
    const cutoffMs = cutoffHours * 60 * 60 * 1000
    const now = new Date()
    if (reservationDateTime.getTime() - now.getTime() < cutoffMs) {
      throw new TransitionError(
        `Cannot cancel within ${cutoffHours} hours of reservation time`,
        'PAST_CUTOFF'
      )
    }
  }

  // 4. Build status-specific timestamp updates
  const now = new Date()
  const timestampUpdates: Record<string, Date> = { statusUpdatedAt: now }

  if (to === 'confirmed') timestampUpdates.confirmedAt = now
  if (to === 'checked_in') timestampUpdates.checkedInAt = now
  if (to === 'seated') timestampUpdates.seatedAt = now
  if (to === 'completed') timestampUpdates.completedAt = now
  if (to === 'cancelled') timestampUpdates.cancelledAt = now

  // Update reservation using Prisma (safe from SQL injection)
  const updateData: Record<string, any> = {
    status: to,
    updatedAt: now,
    ...timestampUpdates,
  }
  if (to === 'cancelled' && reason) {
    updateData.cancelReason = reason
  }

  await txDb.reservation.update({
    where: { id: reservationId },
    data: updateData,
  })

  // 5. Write ReservationEvent
  await txDb.reservationEvent.create({
    data: {
      locationId,
      reservationId,
      eventType: rule.eventType,
      actor: actor.type,
      actorId: actor.id || null,
      details: {
        from,
        to,
        ...(reason ? { reason } : {}),
        ...(overrideType ? { overrideType } : {}),
      },
    },
  })

  // Write override event if applicable
  if (overrideType) {
    await txDb.reservationEvent.create({
      data: {
        locationId,
        reservationId,
        eventType: 'override_applied',
        actor: actor.type,
        actorId: actor.id || null,
        details: {
          overrideType,
          transition: key,
          ...(reason ? { reason } : {}),
        },
      },
    })
  }

  // Handle deposit auto-refund on cancel
  if (rule.autoRefundDeposit && reservation.depositStatus === 'paid') {
    await txDb.reservation.update({
      where: { id: reservationId },
      data: { depositStatus: 'refund_pending' },
    })
    await txDb.reservationEvent.create({
      data: {
        locationId,
        reservationId,
        eventType: 'deposit_auto_refunded_after_cancel',
        actor: actor.type,
        actorId: actor.id || null,
        details: { depositAmountCents: reservation.depositAmountCents },
      },
    })
  }

  // Restore deposit status on no_show → confirmed reversal
  if (from === 'no_show' && to === 'confirmed' && reservation.depositStatus === 'forfeited') {
    await txDb.reservation.update({
      where: { id: reservationId },
      data: { depositStatus: 'paid' },
    })
    await txDb.reservationEvent.create({
      data: {
        locationId,
        reservationId,
        eventType: 'deposit_paid',
        actor: actor.type,
        actorId: actor.id || null,
        details: { reason: 'Deposit restored after no-show reversal', previousStatus: 'forfeited' },
      },
    })
  }

  // 6. Load updated reservation for return + socket dispatch
  const updated = await txDb.reservation.findUnique({
    where: { id: reservationId },
  })

  // Socket dispatch is the caller's responsibility AFTER transaction commits.
  // Do NOT dispatch here — we may still be inside an interactive transaction.

  return updated
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function combineDateAndTime(date: Date, time: string): Date {
  const d = new Date(date)
  const [hours, minutes] = time.split(':').map(Number)
  d.setHours(hours, minutes, 0, 0)
  return d
}

async function loadReservationSettings(
  db: PrismaClient,
  locationId: string
): Promise<{ cancellationCutoffHours: number }> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { settings: true },
  })

  const settings = (location?.settings as any) || {}
  const resSetting = settings.reservationSettings || {}
  return {
    cancellationCutoffHours: resSetting.cancellationCutoffHours ?? 2,
  }
}

/**
 * Check if a transition is valid without executing it.
 */
export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return `${from}:${to}` in TRANSITIONS
}

/**
 * Get all valid target statuses from a given status.
 */
export function validTargets(from: ReservationStatus): ReservationStatus[] {
  return Object.keys(TRANSITIONS)
    .filter(k => k.startsWith(`${from}:`))
    .map(k => k.split(':')[1] as ReservationStatus)
}

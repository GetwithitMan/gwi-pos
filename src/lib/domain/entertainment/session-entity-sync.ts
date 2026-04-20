/**
 * Entertainment Session Entity — Dual-Write Layer
 *
 * Helper functions that session-operations.ts calls after its existing writes
 * to create/update EntertainmentSession rows and append EntertainmentSessionEvent entries.
 * All within the same transaction.
 *
 * During rollout, callers wrap these in try/catch as non-fatal.
 */

import { createChildLogger } from '@/lib/logger'
import {
  dispatchEntertainmentSessionEntityUpdate,
  dispatchEntertainmentResourceStatusUpdate,
} from '@/lib/socket-dispatch'

const log = createChildLogger('entertainment-session-entity')

type TxClient = any  // Prisma transaction client

// ── State transition validator ──────────────────────────────────────
const VALID_TRANSITIONS: Record<string, string[]> = {
  pre_start: ['running', 'cancelled', 'voided'],
  running: ['overtime', 'stopped', 'comped', 'voided'],
  overtime: ['stopped', 'comped', 'voided'],
  stopped: [],
  voided: [],
  comped: [],
  cancelled: [],
}

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

// ── Create session (on item add / entertainment start) ──────────────
export async function createEntertainmentSession(
  tx: TxClient,
  input: {
    locationId: string
    orderItemId: string
    orderId: string
    resourceId: string
    resourceName?: string
    linkedMenuItemId?: string | null
    scheduledMinutes?: number
    pricingSnapshot?: any
    createdBy?: string
    sourceTerminalId?: string
  }
): Promise<{ id: string }> {
  const session = await tx.entertainmentSession.create({
    data: {
      locationId: input.locationId,
      orderItemId: input.orderItemId,
      orderId: input.orderId,
      resourceId: input.resourceId,
      sessionState: 'pre_start',
      version: 1,
      scheduledMinutes: input.scheduledMinutes ?? null,
      pricingSnapshot: input.pricingSnapshot ?? null,
      createdBy: input.createdBy ?? null,
      sourceTerminalId: input.sourceTerminalId ?? null,
    },
    select: { id: true },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: session.id,
    eventType: 'created',
    payload: { scheduledMinutes: input.scheduledMinutes, resourceId: input.resourceId },
    actorId: input.createdBy,
  })

  // Update resource to mark as held
  await tx.entertainmentResource.updateMany({
    where: { id: input.resourceId, deletedAt: null },
    data: { activeSessionId: session.id, status: 'occupied', updatedAt: new Date() },
  })

  // Fire-and-forget socket dispatches
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: session.id,
      orderItemId: input.orderItemId,
      orderId: input.orderId,
      resourceId: input.resourceId,
      sessionState: 'pre_start',
      version: 1,
      scheduledMinutes: input.scheduledMinutes ?? null,
      startedAt: null,
      bookedEndAt: null,
      stoppedAt: null,
      overtimeStartedAt: null,
      totalExtendedMinutes: 0,
      finalPriceCents: null,
      createdBy: input.createdBy ?? null,
      stoppedBy: null,
      stopReason: null,
    },
    action: 'created',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))

  void dispatchEntertainmentResourceStatusUpdate(input.locationId, {
    resource: {
      id: input.resourceId,
      status: 'occupied',
      activeSessionId: session.id,
      linkedMenuItemId: input.linkedMenuItemId ?? null,
      name: input.resourceName ?? '',
    },
  }, { async: true }).catch(err => log.warn({ err }, 'Resource status dispatch failed'))

  return session
}

// ── Activate session (on send / start tab → PRE_START → RUNNING) ────
export async function activateSession(
  tx: TxClient,
  input: {
    orderItemId: string
    locationId: string
    startedAt: Date
    bookedEndAt: Date
    actorId?: string
  }
): Promise<void> {
  const session = await tx.entertainmentSession.findUnique({
    where: { orderItemId: input.orderItemId },
    select: { id: true, sessionState: true, version: true, orderId: true, resourceId: true, scheduledMinutes: true, totalExtendedMinutes: true, createdBy: true },
  })
  if (!session) return  // No session entity yet (pre-Phase 1 item)

  if (!isValidTransition(session.sessionState, 'running')) {
    log.warn({ sessionId: session.id, from: session.sessionState, to: 'running' }, 'Invalid session transition — skipping')
    return
  }

  await tx.entertainmentSession.update({
    where: { id: session.id },
    data: {
      sessionState: 'running',
      startedAt: input.startedAt,
      bookedEndAt: input.bookedEndAt,
      version: session.version + 1,
    },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: session.id,
    eventType: 'started',
    payload: { startedAt: input.startedAt.toISOString(), bookedEndAt: input.bookedEndAt.toISOString() },
    actorId: input.actorId,
  })

  // Fire-and-forget socket dispatch
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: session.id,
      orderItemId: input.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      sessionState: 'running',
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes ?? null,
      startedAt: input.startedAt.toISOString(),
      bookedEndAt: input.bookedEndAt.toISOString(),
      stoppedAt: null,
      overtimeStartedAt: null,
      totalExtendedMinutes: session.totalExtendedMinutes ?? 0,
      finalPriceCents: null,
      createdBy: session.createdBy ?? null,
      stoppedBy: null,
      stopReason: null,
    },
    action: 'updated',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))
}

// ── Extend session ──────────────────────────────────────────────────
export async function extendSessionEntity(
  tx: TxClient,
  input: {
    orderItemId: string
    locationId: string
    additionalMinutes: number
    newBookedEndAt: Date
    actorId?: string
  }
): Promise<void> {
  const session = await tx.entertainmentSession.findUnique({
    where: { orderItemId: input.orderItemId },
    select: { id: true, sessionState: true, version: true, totalExtendedMinutes: true, orderId: true, resourceId: true, scheduledMinutes: true, startedAt: true, createdBy: true },
  })
  if (!session) return

  const newState = session.sessionState === 'overtime' ? 'running' : session.sessionState
  const newTotalExtended = (session.totalExtendedMinutes || 0) + input.additionalMinutes

  await tx.entertainmentSession.update({
    where: { id: session.id },
    data: {
      bookedEndAt: input.newBookedEndAt,
      lastExtendedAt: new Date(),
      totalExtendedMinutes: newTotalExtended,
      version: session.version + 1,
      sessionState: newState,
      overtimeStartedAt: session.sessionState === 'overtime' ? null : undefined,
    },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: session.id,
    eventType: 'extended',
    payload: { additionalMinutes: input.additionalMinutes, newBookedEndAt: input.newBookedEndAt.toISOString() },
    actorId: input.actorId,
  })

  // Fire-and-forget socket dispatch
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: session.id,
      orderItemId: input.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      sessionState: newState,
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes ?? null,
      startedAt: session.startedAt?.toISOString() ?? null,
      bookedEndAt: input.newBookedEndAt.toISOString(),
      stoppedAt: null,
      overtimeStartedAt: null,
      totalExtendedMinutes: newTotalExtended,
      finalPriceCents: null,
      createdBy: session.createdBy ?? null,
      stoppedBy: null,
      stopReason: null,
    },
    action: 'updated',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))
}

// ── Stop session ────────────────────────────────────────────────────
export async function stopSessionEntity(
  tx: TxClient,
  input: {
    orderItemId: string
    locationId: string
    resourceId: string
    resourceName?: string
    linkedMenuItemId?: string | null
    finalPriceDollars: number
    stopReason: string  // 'normal' | 'comp' | 'void' | 'force' | 'auto_expired' | 'orphan_cleanup'
    actorId?: string
  }
): Promise<void> {
  const session = await tx.entertainmentSession.findUnique({
    where: { orderItemId: input.orderItemId },
    select: { id: true, sessionState: true, version: true, orderId: true, resourceId: true, scheduledMinutes: true, startedAt: true, bookedEndAt: true, overtimeStartedAt: true, totalExtendedMinutes: true, createdBy: true },
  })
  if (!session) return

  const targetState = input.stopReason === 'comp' ? 'comped'
    : input.stopReason === 'void' ? 'voided'
    : 'stopped'

  if (!isValidTransition(session.sessionState, targetState)) {
    log.warn({ sessionId: session.id, from: session.sessionState, to: targetState }, 'Invalid session transition — skipping')
    return
  }

  const stoppedAt = new Date()
  const finalPriceCents = Math.round(input.finalPriceDollars * 100)

  await tx.entertainmentSession.update({
    where: { id: session.id },
    data: {
      sessionState: targetState,
      stoppedAt,
      stoppedBy: input.actorId ?? null,
      stopReason: input.stopReason,
      finalPriceDollars: input.finalPriceDollars,
      finalPriceCents,
      version: session.version + 1,
    },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: session.id,
    eventType: targetState === 'comped' ? 'comped' : targetState === 'voided' ? 'voided' : 'stopped',
    payload: { finalPriceDollars: input.finalPriceDollars, stopReason: input.stopReason },
    actorId: input.actorId,
  })

  // Free the resource
  if (input.resourceId) {
    await tx.entertainmentResource.updateMany({
      where: { id: input.resourceId, deletedAt: null },
      data: { activeSessionId: null, status: 'available', updatedAt: new Date() },
    })
  }

  // Fire-and-forget socket dispatches
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: session.id,
      orderItemId: input.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      sessionState: targetState,
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes ?? null,
      startedAt: session.startedAt?.toISOString() ?? null,
      bookedEndAt: session.bookedEndAt?.toISOString() ?? null,
      stoppedAt: stoppedAt.toISOString(),
      overtimeStartedAt: session.overtimeStartedAt?.toISOString() ?? null,
      totalExtendedMinutes: session.totalExtendedMinutes ?? 0,
      finalPriceCents,
      createdBy: session.createdBy ?? null,
      stoppedBy: input.actorId ?? null,
      stopReason: input.stopReason,
    },
    action: 'updated',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))

  if (input.resourceId) {
    void dispatchEntertainmentResourceStatusUpdate(input.locationId, {
      resource: {
        id: input.resourceId,
        status: 'available',
        activeSessionId: null,
        linkedMenuItemId: input.linkedMenuItemId ?? null,
        name: input.resourceName ?? '',
      },
    }, { async: true }).catch(err => log.warn({ err }, 'Resource status dispatch failed'))
  }
}

// ── Transition to overtime (cron) ───────────────────────────────────
export async function transitionToOvertime(
  tx: TxClient,
  input: {
    sessionId: string
    locationId: string
  }
): Promise<{ session: { id: string; orderItemId: string; orderId: string; resourceId: string; version: number; scheduledMinutes: number | null; startedAt: Date | null; bookedEndAt: Date | null; overtimeStartedAt: Date; totalExtendedMinutes: number; createdBy: string | null } } | null> {
  const session = await tx.entertainmentSession.findUnique({
    where: { id: input.sessionId },
    select: { sessionState: true, version: true, orderItemId: true, orderId: true, resourceId: true, scheduledMinutes: true, startedAt: true, bookedEndAt: true, totalExtendedMinutes: true, createdBy: true },
  })
  if (!session || session.sessionState !== 'running') return null

  const overtimeStartedAt = new Date()

  await tx.entertainmentSession.update({
    where: { id: input.sessionId },
    data: {
      sessionState: 'overtime',
      overtimeStartedAt,
      version: session.version + 1,
    },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: input.sessionId,
    eventType: 'overtime_entered',
    payload: {},
    actorId: null,
  })

  // Fire-and-forget socket dispatch
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: input.sessionId,
      orderItemId: session.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      sessionState: 'overtime',
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes ?? null,
      startedAt: session.startedAt?.toISOString() ?? null,
      bookedEndAt: session.bookedEndAt?.toISOString() ?? null,
      stoppedAt: null,
      overtimeStartedAt: overtimeStartedAt.toISOString(),
      totalExtendedMinutes: session.totalExtendedMinutes ?? 0,
      finalPriceCents: null,
      createdBy: session.createdBy ?? null,
      stoppedBy: null,
      stopReason: null,
    },
    action: 'updated',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))

  return {
    session: {
      id: input.sessionId,
      orderItemId: session.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes,
      startedAt: session.startedAt,
      bookedEndAt: session.bookedEndAt,
      overtimeStartedAt,
      totalExtendedMinutes: session.totalExtendedMinutes ?? 0,
      createdBy: session.createdBy,
    },
  }
}

// ── Cancel session (PRE_START only) ─────────────────────────────────
export async function cancelSessionEntity(
  tx: TxClient,
  input: {
    orderItemId: string
    locationId: string
    resourceId: string
    resourceName?: string
    linkedMenuItemId?: string | null
    actorId?: string
  }
): Promise<void> {
  const session = await tx.entertainmentSession.findUnique({
    where: { orderItemId: input.orderItemId },
    select: { id: true, sessionState: true, version: true, orderId: true, resourceId: true, scheduledMinutes: true, createdBy: true },
  })
  if (!session || session.sessionState !== 'pre_start') return

  await tx.entertainmentSession.update({
    where: { id: session.id },
    data: {
      sessionState: 'cancelled',
      version: session.version + 1,
    },
  })

  await appendSessionEvent(tx, {
    locationId: input.locationId,
    sessionId: session.id,
    eventType: 'cancelled',
    payload: {},
    actorId: input.actorId,
  })

  // Free the resource
  if (input.resourceId) {
    await tx.entertainmentResource.updateMany({
      where: { id: input.resourceId, deletedAt: null },
      data: { activeSessionId: null, status: 'available', updatedAt: new Date() },
    })
  }

  // Fire-and-forget socket dispatches
  void dispatchEntertainmentSessionEntityUpdate(input.locationId, {
    session: {
      id: session.id,
      orderItemId: input.orderItemId,
      orderId: session.orderId,
      resourceId: session.resourceId,
      sessionState: 'cancelled',
      version: session.version + 1,
      scheduledMinutes: session.scheduledMinutes ?? null,
      startedAt: null,
      bookedEndAt: null,
      stoppedAt: null,
      overtimeStartedAt: null,
      totalExtendedMinutes: 0,
      finalPriceCents: null,
      createdBy: session.createdBy ?? null,
      stoppedBy: null,
      stopReason: null,
    },
    action: 'updated',
  }, { async: true }).catch(err => log.warn({ err }, 'Session entity dispatch failed'))

  if (input.resourceId) {
    void dispatchEntertainmentResourceStatusUpdate(input.locationId, {
      resource: {
        id: input.resourceId,
        status: 'available',
        activeSessionId: null,
        linkedMenuItemId: input.linkedMenuItemId ?? null,
        name: input.resourceName ?? '',
      },
    }, { async: true }).catch(err => log.warn({ err }, 'Resource status dispatch failed'))
  }
}

// ── Append event (internal helper) ──────────────────────────────────
async function appendSessionEvent(
  tx: TxClient,
  input: {
    locationId: string
    sessionId: string
    eventType: string
    payload: any
    actorId?: string | null
    idempotencyKey?: string
  }
): Promise<void> {
  try {
    await tx.entertainmentSessionEvent.create({
      data: {
        locationId: input.locationId,
        sessionId: input.sessionId,
        eventType: input.eventType as any,
        payload: input.payload,
        actorId: input.actorId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      },
    })
  } catch (err) {
    // Idempotency key conflict — event already recorded
    log.debug({ sessionId: input.sessionId, eventType: input.eventType }, 'Session event already recorded (idempotent)')
  }
}

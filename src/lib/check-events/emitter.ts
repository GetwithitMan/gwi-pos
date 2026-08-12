/**
 * Check Event Sourcing — Event Emitter
 *
 * Fire-and-forget helper for emitting check domain events from API routes.
 * Each call:
 *   1. Inserts a CheckEvent row via Prisma (serverSequence auto-assigned by DB)
 *   2. Broadcasts `check:event` via Socket.IO so devices receive it in real-time
 *
 * All errors are caught and logged — callers should use `void emitCheckEvent(...)`
 * to avoid blocking the request on event persistence.
 *
 * NOTE: CheckEvent.payloadJson is String @db.Text (not Prisma Json), so payloads
 * are JSON.stringify'd before insert. CheckEvent.serverSequence uses
 * @default(autoincrement()), so we omit it from insert and read it back.
 */

import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { createChildLogger } from '@/lib/logger'
import type { Prisma } from '@/generated/prisma/client'
import type { CheckEventType } from './types'

const log = createChildLogger('check-events')

interface EmitOptions {
  /** Client-generated event ID. If provided, reused instead of generating a new UUID. */
  clientEventId?: string
  /** Command ID for grouping related mutations. */
  commandId?: string
  /** Originating device ID. Defaults to 'nuc-web'. */
  deviceId?: string
  /** Monotonic counter from the device. Defaults to 0. */
  deviceCounter?: number
}

/**
 * Emit a check event inside an existing Prisma transaction.
 * Use this instead of emitCheckEvent() when the event must be atomic with the mutation.
 */
export async function emitCheckEventInTx(
  tx: Prisma.TransactionClient,
  locationId: string,
  checkId: string,
  type: CheckEventType,
  payload: Record<string, unknown>,
  opts?: EmitOptions
): Promise<{ eventId: string; serverSequence: number }> {
  const eventId = opts?.clientEventId ?? crypto.randomUUID()
  const deviceId = opts?.deviceId ?? 'nuc-web'
  const deviceCounter = opts?.deviceCounter ?? 0

  const event = await tx.checkEvent.create({
    data: {
      eventId,
      checkId,
      type,
      payloadJson: JSON.stringify(payload),
      deviceId,
      deviceCounter,
      commandId: opts?.commandId ?? null,
    },
    select: { serverSequence: true },
  })

  return { eventId, serverSequence: event.serverSequence }
}

export async function emitCheckEvent(
  locationId: string,
  checkId: string,
  type: CheckEventType,
  payload: Record<string, unknown>,
  opts?: EmitOptions
): Promise<{ eventId: string; serverSequence: number } | null> {
  try {
    const eventId = opts?.clientEventId ?? crypto.randomUUID()
    const deviceId = opts?.deviceId ?? 'nuc-web'
    const deviceCounter = opts?.deviceCounter ?? 0

    // Insert the event — serverSequence auto-assigned by DB autoincrement
    const event = await db.checkEvent.create({
      data: {
        eventId,
        checkId,
        type,
        payloadJson: JSON.stringify(payload),
        deviceId,
        deviceCounter,
        commandId: opts?.commandId ?? null,
      },
      select: { serverSequence: true },
    })
    const serverSequence = event.serverSequence

    // Broadcast to all terminals in this location
    void emitToLocation(locationId, 'check:event', {
      eventId,
      checkId,
      serverSequence,
      type,
      payload,
      deviceId,
      deviceCounter,
      commandId: opts?.commandId ?? null,
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in check-events.emitter'))

    return { eventId, serverSequence }
  } catch (err) {
    log.error({ err }, `[check-events/emitter] Failed to emit ${type} for check ${checkId}`)
    return null
  }
}

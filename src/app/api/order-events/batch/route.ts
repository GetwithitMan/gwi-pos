import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import {
  type BatchEventInput,
  type BatchEventResponse,
  type OrderEventPayload,
  ORDER_EVENT_TYPES,
  emptyOrderState,
} from '@/lib/order-events/types'
import { reduce } from '@/lib/order-events/reducer'
import { applyProjection } from '@/lib/order-events/projector'

async function authenticateTerminal(
  request: NextRequest
): Promise<
  | { terminal: { id: string; locationId: string; name: string }; error?: never }
  | { terminal?: never; error: NextResponse }
> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      ),
    }
  }
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true, name: true },
  })
  if (!terminal) {
    return {
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    }
  }
  return { terminal }
}

/**
 * POST /api/order-events/batch
 *
 * Accepts a batch of domain events from an Android device (or any client).
 * For each event:
 *   1. Idempotent check — skip if eventId already exists
 *   2. Assign serverSequence via Postgres SEQUENCE (globally ordered)
 *   3. Insert into order_events table
 *
 * After all events are inserted, for each affected orderId:
 *   1. Load all events for that order (sorted by serverSequence)
 *   2. Replay through the pure reducer → OrderState
 *   3. Project into order_snapshots + order_item_snapshots
 *
 * Response: { accepted: [{eventId, serverSequence}], rejected: [{eventId, reason}] }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const body = await request.json()
  const events: BatchEventInput[] = body.events

  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      { error: 'events array is required and must not be empty' },
      { status: 400 }
    )
  }

  // Cap batch size to prevent abuse
  if (events.length > 500) {
    return NextResponse.json(
      { error: 'Batch size exceeds maximum of 500 events' },
      { status: 400 }
    )
  }

  const accepted: BatchEventResponse['accepted'] = []
  const rejected: BatchEventResponse['rejected'] = []
  const affectedOrderIds = new Set<string>()

  for (const evt of events) {
    try {
      // Validate required fields
      if (!evt.eventId || !evt.orderId || !evt.deviceId || !evt.type) {
        rejected.push({
          eventId: evt.eventId || 'unknown',
          reason: 'Missing required fields: eventId, orderId, deviceId, type',
        })
        continue
      }

      // Validate event type
      if (!ORDER_EVENT_TYPES.includes(evt.type as any)) {
        rejected.push({
          eventId: evt.eventId,
          reason: `Unknown event type: ${evt.type}`,
        })
        continue
      }

      // Idempotent: skip if eventId already exists
      const existing = await db.orderEvent.findUnique({
        where: { eventId: evt.eventId },
        select: { serverSequence: true },
      })
      if (existing) {
        // Already processed — return the existing serverSequence
        accepted.push({
          eventId: evt.eventId,
          serverSequence: existing.serverSequence,
        })
        continue
      }

      // Assign serverSequence atomically via Postgres SEQUENCE
      const [seqRow] = await db.$queryRawUnsafe<
        { nextval: bigint | number }[]
      >(`SELECT nextval('order_event_server_seq')`)
      const serverSequence = Number(seqRow.nextval)

      // Insert the event
      await db.orderEvent.create({
        data: {
          eventId: evt.eventId,
          orderId: evt.orderId,
          locationId,
          deviceId: evt.deviceId,
          deviceCounter: evt.deviceCounter ?? 0,
          serverSequence,
          type: evt.type,
          payloadJson: (evt.payloadJson ?? {}) as any,
          schemaVersion: evt.schemaVersion ?? 1,
          correlationId: evt.correlationId ?? null,
          deviceCreatedAt: new Date(evt.deviceCreatedAt),
        },
      })

      accepted.push({ eventId: evt.eventId, serverSequence })
      affectedOrderIds.add(evt.orderId)
    } catch (err) {
      rejected.push({
        eventId: evt.eventId || 'unknown',
        reason: String(err),
      })
    }
  }

  // Re-project snapshots for all affected orders
  for (const orderId of affectedOrderIds) {
    try {
      // Load all events for this order in canonical order
      const orderEvents = await db.orderEvent.findMany({
        where: { orderId },
        orderBy: { serverSequence: 'asc' },
        select: { type: true, payloadJson: true, serverSequence: true },
      })

      if (orderEvents.length === 0) continue

      // Replay through reducer
      let state = emptyOrderState(orderId)
      let lastSequence = 0
      for (const oe of orderEvents) {
        const eventPayload = {
          type: oe.type,
          payload: oe.payloadJson,
        } as OrderEventPayload
        state = reduce(state, eventPayload)
        lastSequence = oe.serverSequence
      }

      // Project into snapshots
      await applyProjection(db as any, state, locationId, lastSequence)
    } catch (err) {
      // Projection failure is non-fatal — events are already persisted
      console.error(
        `[order-events/batch] Projection failed for order ${orderId}:`,
        err
      )
    }
  }

  // Fire-and-forget: notify other terminals of order changes
  for (const orderId of affectedOrderIds) {
    void emitToLocation(locationId, 'orders:list-changed', {
      orderId,
      source: 'event-batch',
    }).catch(console.error)
  }

  return NextResponse.json({
    data: { accepted, rejected } satisfies BatchEventResponse,
  })
})

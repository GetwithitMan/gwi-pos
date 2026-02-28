import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import {
  type BatchEventInput,
  type BatchEventResponse,
  ORDER_EVENT_TYPES,
} from '@/lib/order-events/types'
import { ingestAndProject, type IngestEvent } from '@/lib/order-events/ingester'

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

  // Validate events and group by orderId
  const validatedByOrder = new Map<string, IngestEvent[]>()

  for (const evt of events) {
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

    const list = validatedByOrder.get(evt.orderId) ?? []
    list.push({
      eventId: evt.eventId,
      type: evt.type,
      payload: (evt.payloadJson ?? {}) as Record<string, unknown>,
      deviceId: evt.deviceId,
      correlationId: evt.correlationId ?? null,
    })
    validatedByOrder.set(evt.orderId, list)
  }

  // Process each order through the shared ingestion pipeline
  for (const [orderId, orderEvents] of validatedByOrder) {
    try {
      const result = await ingestAndProject(db as any, orderId, locationId, orderEvents)
      accepted.push(...result.accepted)
    } catch (err) {
      // If ingestion fails for an order, reject all its events
      for (const evt of orderEvents) {
        rejected.push({
          eventId: evt.eventId || 'unknown',
          reason: String(err),
        })
      }
    }
  }

  return NextResponse.json({
    data: { accepted, rejected } satisfies BatchEventResponse,
  })
})

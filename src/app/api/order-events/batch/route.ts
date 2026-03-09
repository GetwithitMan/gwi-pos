import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import {
  type BatchEventInput,
  type BatchEventResponse,
  ORDER_EVENT_TYPES,
  getSubtotalCents,
  getTotalCents,
  type OrderState,
} from '@/lib/order-events/types'
import { ingestAndProject, type IngestEvent } from '@/lib/order-events/ingester'
import { emitToTerminal } from '@/lib/socket-server'
import { authenticateTerminal } from '@/lib/terminal-auth'

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
  // Collect projected states for CFD dispatch
  const projectedStates = new Map<string, OrderState>()
  for (const [orderId, orderEvents] of validatedByOrder) {
    try {
      const result = await ingestAndProject(db as any, orderId, locationId, orderEvents)
      accepted.push(...result.accepted)
      projectedStates.set(orderId, result.state)
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

  // Fire-and-forget: dispatch cfd:show-order to the paired CFD terminal
  // Uses projected state returned by ingestAndProject — no extra DB query needed
  const cfdTerminalId = auth.terminal.cfdTerminalId
  if (cfdTerminalId && projectedStates.size > 0) {
    void (async () => {
      for (const [orderId, state] of projectedStates) {
        try {
          // Only dispatch for open/active orders (not paid/voided/closed)
          if (['paid', 'closed', 'completed', 'voided', 'cancelled'].includes(state.status)) continue

          const activeItems = Object.values(state.items).filter(
            (item) => item.status !== 'voided' && item.status !== 'cancelled'
          )
          if (activeItems.length === 0) continue

          const payload = {
            orderId,
            items: activeItems.map((item) => {
              // modifiersJson is a JSON string on OrderLineItem; parse it to extract names
              let modifierLines: string[] = []
              if (item.modifiersJson) {
                try {
                  const mods = JSON.parse(item.modifiersJson) as Array<{ name?: string } | string>
                  modifierLines = mods
                    .map((m) => (typeof m === 'string' ? m : (m.name ?? '')))
                    .filter(Boolean)
                } catch {
                  // Ignore malformed modifiersJson
                }
              }
              return {
                name: item.name,
                quantity: item.quantity,
                priceCents: item.priceCents,
                modifierLines,
              }
            }),
            subtotalCents: getSubtotalCents(state),
            taxCents: state.taxTotalCents,
            totalCents: getTotalCents(state),
          }

          void emitToTerminal(cfdTerminalId, 'cfd:show-order', payload)
        } catch (err) {
          console.warn('[CFD] Failed to dispatch cfd:show-order for order', orderId, err)
        }
      }
    })()
  }

  return NextResponse.json({
    data: { accepted, rejected } satisfies BatchEventResponse,
  })
})

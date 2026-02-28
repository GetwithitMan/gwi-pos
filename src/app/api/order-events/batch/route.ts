import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import {
  type BatchEventInput,
  type BatchEventResponse,
  type OrderEventPayload,
  type OrderState,
  ORDER_EVENT_TYPES,
  emptyOrderState,
  getSubtotalCents,
  getDiscountTotalCents,
  getTotalCents,
  getPaidAmountCents,
  getTipTotalCents,
  getItemCount,
  getItemTotalCents,
  getHasHeldItems,
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
  const newPaymentEvents: { orderId: string; payload: Record<string, unknown> }[] = []

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

      // Track new PAYMENT_APPLIED events for bridge sync to legacy Payment table
      if (evt.type === 'PAYMENT_APPLIED' && evt.payloadJson) {
        newPaymentEvents.push({
          orderId: evt.orderId,
          payload: (evt.payloadJson ?? {}) as Record<string, unknown>,
        })
      }
    } catch (err) {
      rejected.push({
        eventId: evt.eventId || 'unknown',
        reason: String(err),
      })
    }
  }

  // Re-project snapshots for all affected orders + collect states for bridge sync
  const orderStates = new Map<string, OrderState>()
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
      orderStates.set(orderId, state)
    } catch (err) {
      // Projection failure is non-fatal — events are already persisted
      console.error(
        `[order-events/batch] Projection failed for order ${orderId}:`,
        err
      )
    }
  }

  // ── Bridge sync: OrderState → legacy Order table ──────────────────────
  // Temporary: keeps the legacy Order table in sync until all reads are
  // switched to OrderSnapshot. This is what makes GET /api/orders/open
  // return correct status/totals for event-sourced orders.
  const closedStatuses = ['paid', 'closed', 'completed', 'voided', 'cancelled']
  for (const [orderId, state] of orderStates) {
    try {
      const isNowClosed = closedStatuses.includes(state.status)
      const subtotal = getSubtotalCents(state) / 100
      const discountTotal = getDiscountTotalCents(state) / 100
      const taxTotal = state.taxTotalCents / 100
      const tipTotal = getTipTotalCents(state) / 100
      const total = getTotalCents(state) / 100

      await db.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          locationId,
          employeeId: state.employeeId,
          orderType: state.orderType,
          orderNumber: state.orderNumber,
          displayNumber: state.displayNumber,
          tableId: state.tableId,
          tabName: state.tabName,
          guestCount: state.guestCount,
          status: state.status as any,
          notes: state.notes,
          subtotal,
          discountTotal,
          taxTotal,
          tipTotal,
          total,
          itemCount: getItemCount(state),
          ...(isNowClosed ? { paidAt: new Date(), closedAt: new Date() } : {}),
        },
        update: {
          status: state.status as any,
          subtotal,
          discountTotal,
          taxTotal,
          tipTotal,
          total,
          itemCount: getItemCount(state),
          notes: state.notes,
          guestCount: state.guestCount,
          tableId: state.tableId,
          tabName: state.tabName,
          ...(isNowClosed ? { paidAt: new Date(), closedAt: new Date() } : {}),
          ...(state.status === 'sent' ? { sentAt: new Date() } : {}),
        },
      })
    } catch (err) {
      console.error(
        `[order-events/batch] Bridge sync to Order failed for ${orderId}:`,
        err
      )
    }
  }

  // ── Bridge sync: OrderState.items → legacy OrderItem table ───────────
  // Keeps the legacy OrderItem table in sync so GET /api/orders/[id],
  // POST /api/orders/[id]/pay, reports, and KDS all see event-sourced items.
  for (const [orderId, state] of orderStates) {
    try {
      const activeItems = Object.values(state.items)
      // Get existing item IDs for this order to detect removals
      const existingItems = await db.orderItem.findMany({
        where: { orderId, deletedAt: null },
        select: { id: true },
      })
      const activeItemIds = new Set(activeItems.map((i) => i.lineItemId))

      // Soft-delete items that no longer exist in the event-sourced state
      const removedIds = existingItems
        .filter((e) => !activeItemIds.has(e.id))
        .map((e) => e.id)
      if (removedIds.length > 0) {
        await db.orderItem.updateMany({
          where: { id: { in: removedIds } },
          data: { deletedAt: new Date(), status: 'voided' },
        })
      }

      // Upsert each active item
      for (const item of activeItems) {
        const itemTotalCents = getItemTotalCents(item)
        await db.orderItem.upsert({
          where: { id: item.lineItemId },
          create: {
            id: item.lineItemId,
            locationId,
            orderId,
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.priceCents / 100,
            quantity: item.quantity,
            specialNotes: item.specialNotes ?? null,
            seatNumber: item.seatNumber ?? null,
            courseNumber: item.courseNumber ?? null,
            isHeld: item.isHeld,
            kitchenStatus: (item.kitchenStatus as any) ?? 'pending',
            soldByWeight: item.soldByWeight,
            weight: item.weight ?? null,
            weightUnit: item.weightUnit ?? null,
            unitPrice: item.unitPriceCents != null ? item.unitPriceCents / 100 : null,
            grossWeight: item.grossWeight ?? null,
            tareWeight: item.tareWeight ?? null,
            status: (item.status as any) ?? 'active',
            isCompleted: item.isCompleted,
            resendCount: item.resendCount,
            delayMinutes: item.delayMinutes ?? null,
            itemTotal: itemTotalCents / 100,
            modifierTotal: 0,
            pricingOptionId: item.pricingOptionId ?? null,
            pricingOptionLabel: item.pricingOptionLabel ?? null,
            costAtSale: item.costAtSaleCents != null ? item.costAtSaleCents / 100 : null,
            pourSize: item.pourSize ?? null,
            pourMultiplier: item.pourMultiplier ?? null,
          },
          update: {
            name: item.name,
            price: item.priceCents / 100,
            quantity: item.quantity,
            specialNotes: item.specialNotes ?? null,
            seatNumber: item.seatNumber ?? null,
            courseNumber: item.courseNumber ?? null,
            isHeld: item.isHeld,
            kitchenStatus: (item.kitchenStatus as any) ?? undefined,
            soldByWeight: item.soldByWeight,
            weight: item.weight ?? null,
            weightUnit: item.weightUnit ?? null,
            unitPrice: item.unitPriceCents != null ? item.unitPriceCents / 100 : null,
            grossWeight: item.grossWeight ?? null,
            tareWeight: item.tareWeight ?? null,
            status: (item.status as any) ?? undefined,
            isCompleted: item.isCompleted,
            resendCount: item.resendCount,
            delayMinutes: item.delayMinutes ?? null,
            itemTotal: itemTotalCents / 100,
            pricingOptionId: item.pricingOptionId ?? null,
            pricingOptionLabel: item.pricingOptionLabel ?? null,
            costAtSale: item.costAtSaleCents != null ? item.costAtSaleCents / 100 : null,
            pourSize: item.pourSize ?? null,
            pourMultiplier: item.pourMultiplier ?? null,
            deletedAt: null, // Un-delete if re-added
          },
        })
      }
    } catch (err) {
      console.error(
        `[order-events/batch] OrderItem bridge sync failed for ${orderId}:`,
        err
      )
    }
  }

  // ── Bridge sync: PAYMENT_APPLIED → legacy Payment table ──────────────
  // Creates Payment records so reports, shift close, and other code that
  // queries the Payment table sees event-sourced payments.
  const paymentMethodMap: Record<string, string> = {
    cash: 'cash',
    card: 'card',
    credit: 'card',
    debit: 'card',
    gift_card: 'giftcard',
    house_account: 'houseaccount',
  }
  for (const pe of newPaymentEvents) {
    try {
      const p = pe.payload
      const paymentId = p.paymentId as string
      if (!paymentId) continue

      await db.payment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          locationId,
          orderId: pe.orderId,
          amount: ((p.amountCents as number) ?? 0) / 100,
          tipAmount: ((p.tipCents as number) ?? 0) / 100,
          totalAmount: ((p.totalCents as number) ?? 0) / 100,
          paymentMethod: (paymentMethodMap[p.method as string] ?? 'other') as any,
          cardBrand: (p.cardBrand as string) ?? null,
          cardLast4: (p.cardLast4 as string) ?? null,
          status: p.status === 'pending' ? 'pending' : ('completed' as any),
        },
        update: {}, // Idempotent — don't overwrite existing Payment
      })
    } catch (err) {
      console.error(
        `[order-events/batch] Payment bridge sync failed for order ${pe.orderId}:`,
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

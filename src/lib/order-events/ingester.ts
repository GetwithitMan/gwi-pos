/**
 * Order Event Sourcing — Shared Ingestion Pipeline
 *
 * Extracted from the batch endpoint so both the batch route (Android)
 * and the NUC pay route can share the same event→reducer→projector→bridge pipeline.
 *
 * Single source of truth: events are inserted, replayed, projected, and bridged
 * to legacy tables in one atomic flow.
 */

import { PrismaClient } from '@prisma/client'
import { emitToLocation } from '@/lib/socket-server'
import {
  type OrderEventPayload,
  type OrderState,
  ORDER_EVENT_TYPES,
  emptyOrderState,
  getSubtotalCents,
  getDiscountTotalCents,
  getTotalCents,
  getTipTotalCents,
  getItemCount,
  getItemTotalCents,
} from './types'
import { reduce } from './reducer'
import { applyProjection, bridgeLegacyFieldsToSnapshot } from './projector'

// ── Public interfaces ────────────────────────────────────────────────

export interface IngestEvent {
  eventId?: string
  type: string
  payload: Record<string, unknown>
  deviceId?: string
  correlationId?: string | null
}

export interface IngestResult {
  state: OrderState
  accepted: { eventId: string; serverSequence: number }[]
  bridgedPayments: BridgedPayment[]
  alreadyPaid: boolean
}

export interface BridgedPayment {
  id: string
  orderId: string
  amount: number
  tipAmount: number
  totalAmount: number
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  status: string
  authCode?: string | null
  transactionId?: string | null
  datacapRecordNo?: string | null
  datacapRefNumber?: string | null
  amountTendered?: number | null
  changeGiven?: number | null
  roundingAdjustment?: number | null
  employeeId?: string | null
  drawerId?: string | null
  shiftId?: string | null
  terminalId?: string | null
  idempotencyKey?: string | null
  pricingMode?: string | null
  cashDiscountAmount?: number | null
  priceBeforeDiscount?: number | null
}

// ── Constants ────────────────────────────────────────────────────────

const closedStatuses = ['paid', 'closed', 'completed', 'voided', 'cancelled']

const paymentMethodMap: Record<string, string> = {
  cash: 'cash',
  card: 'card',
  credit: 'card',
  debit: 'card',
  gift_card: 'giftcard',
  house_account: 'houseaccount',
}

// ── Main ingestion pipeline ──────────────────────────────────────────

export async function ingestAndProject(
  db: PrismaClient,
  orderId: string,
  locationId: string,
  events: IngestEvent[],
  options?: {
    paymentBridgeOverrides?: Record<string, Record<string, unknown>>
    suppressBroadcast?: boolean
    employeeId?: string
  }
): Promise<IngestResult> {
  const accepted: { eventId: string; serverSequence: number }[] = []
  const newPaymentEvents: { payload: Record<string, unknown> }[] = []
  let alreadyPaid = false

  // ── 1. Event insertion (idempotent) ────────────────────────────────

  for (const evt of events) {
    const eventId = evt.eventId || crypto.randomUUID()
    const deviceId = evt.deviceId || 'nuc-server'

    // Idempotent: skip if eventId already exists
    const existing = await (db as any).orderEvent.findUnique({
      where: { eventId },
      select: { serverSequence: true },
    })
    if (existing) {
      accepted.push({ eventId, serverSequence: existing.serverSequence })
      continue
    }

    // Assign serverSequence atomically via Postgres SEQUENCE
    const seqResult: { nextval: bigint | number }[] =
      await (db as any).$queryRawUnsafe(`SELECT nextval('order_event_server_seq')`)
    const [seqRow] = seqResult
    const serverSequence = Number(seqRow.nextval)

    // Insert the event
    await (db as any).orderEvent.create({
      data: {
        eventId,
        orderId,
        locationId,
        deviceId,
        deviceCounter: 0,
        serverSequence,
        type: evt.type,
        payloadJson: (evt.payload ?? {}) as any,
        schemaVersion: 1,
        correlationId: evt.correlationId ?? null,
        deviceCreatedAt: new Date(),
      },
    })

    accepted.push({ eventId, serverSequence })

    // Track new PAYMENT_APPLIED events for bridge sync
    if (evt.type === 'PAYMENT_APPLIED' && evt.payload) {
      newPaymentEvents.push({ payload: evt.payload })
    }
  }

  // ── 2. Replay & Project ────────────────────────────────────────────

  const orderEvents = await (db as any).orderEvent.findMany({
    where: { orderId },
    orderBy: { serverSequence: 'asc' },
    select: { type: true, payloadJson: true, serverSequence: true },
  })

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

  await applyProjection(db as any, state, locationId, lastSequence)

  // ── 3. Bridge sync: Order table ────────────────────────────────────

  try {
    const isNowClosed = closedStatuses.includes(state.status)
    const subtotal = getSubtotalCents(state) / 100
    const discountTotal = getDiscountTotalCents(state) / 100
    const taxTotal = state.taxTotalCents / 100
    const tipTotal = getTipTotalCents(state) / 100
    const total = getTotalCents(state) / 100

    const bridgeData = {
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
    }

    if (isNowClosed) {
      // Guard: check if the order is already in a terminal status
      const orderUpdateResult = await (db as any).order.updateMany({
        where: { id: orderId, status: { notIn: closedStatuses as any[] } },
        data: bridgeData,
      })
      if (orderUpdateResult.count === 0) {
        const existing = await (db as any).order.findUnique({
          where: { id: orderId },
          select: { status: true },
        })
        if (existing && closedStatuses.includes(existing.status)) {
          alreadyPaid = true
        } else if (!existing) {
          // Order doesn't exist yet — create it
          await (db as any).order.create({
            data: {
              id: orderId,
              locationId,
              employeeId: state.employeeId,
              orderType: state.orderType,
              orderNumber: state.orderNumber,
              displayNumber: state.displayNumber,
              ...bridgeData,
            },
          })
        }
      }
    } else {
      // Non-closed: standard upsert
      await (db as any).order.upsert({
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
        },
        update: bridgeData,
      })
    }
  } catch (err) {
    console.error(
      `[ingester] Bridge sync to Order failed for ${orderId}:`,
      err
    )
  }

  // ── 4. Bridge sync: OrderItem table ────────────────────────────────

  try {
    const activeItems = Object.values(state.items)
    const existingItems = await (db as any).orderItem.findMany({
      where: { orderId, deletedAt: null },
      select: { id: true },
    })
    const activeItemIds = new Set(activeItems.map((i) => i.lineItemId))

    // Soft-delete items removed in event-sourced state
    const removedIds = existingItems
      .filter((e: { id: string }) => !activeItemIds.has(e.id))
      .map((e: { id: string }) => e.id)
    if (removedIds.length > 0) {
      await (db as any).orderItem.updateMany({
        where: { id: { in: removedIds } },
        data: { deletedAt: new Date(), status: 'voided' },
      })
    }

    // Upsert each active item
    for (const item of activeItems) {
      const itemTotalCents = getItemTotalCents(item)
      await (db as any).orderItem.upsert({
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
      `[ingester] OrderItem bridge sync failed for ${orderId}:`,
      err
    )
  }

  // ── 5. Bridge sync: Payment table ──────────────────────────────────

  const bridgedPayments: BridgedPayment[] = []
  for (const pe of newPaymentEvents) {
    try {
      const p = pe.payload
      const paymentId = p.paymentId as string
      if (!paymentId) continue

      const amount = ((p.amountCents as number) ?? 0) / 100
      const tipAmount = ((p.tipCents as number) ?? 0) / 100
      const totalAmount = ((p.totalCents as number) ?? 0) / 100
      const paymentMethod = (paymentMethodMap[p.method as string] ?? 'other') as any
      const cardBrand = (p.cardBrand as string) ?? null
      const cardLast4 = (p.cardLast4 as string) ?? null
      const status = p.status === 'pending' ? 'pending' : ('completed' as any)

      // Merge optional bridge overrides (e.g. from pay route)
      const overrides = options?.paymentBridgeOverrides?.[paymentId] ?? {}

      await (db as any).payment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          locationId,
          orderId,
          amount,
          tipAmount,
          totalAmount,
          paymentMethod,
          cardBrand,
          cardLast4,
          status,
          ...overrides,
        },
        update: {}, // Idempotent — don't overwrite existing Payment
      })

      bridgedPayments.push({
        id: paymentId,
        orderId,
        amount,
        tipAmount,
        totalAmount,
        paymentMethod,
        cardBrand,
        cardLast4,
        status,
        ...(overrides as Partial<BridgedPayment>),
      })
    } catch (err) {
      console.error(
        `[ingester] Payment bridge sync failed for order ${orderId}:`,
        err
      )
    }
  }

  // ── 6. Bridge legacy fields → snapshot ─────────────────────────────

  try {
    await bridgeLegacyFieldsToSnapshot(db as any, orderId)
  } catch (err) {
    console.error(
      `[ingester] Legacy→Snapshot bridge failed for ${orderId}:`,
      err
    )
  }

  // ── 7. Socket broadcast ────────────────────────────────────────────

  if (!options?.suppressBroadcast) {
    void emitToLocation(locationId, 'orders:list-changed', {
      orderId,
      source: 'event-ingest',
    }).catch(console.error)
  }

  // ── 8. Return result ───────────────────────────────────────────────

  return { state, accepted, bridgedPayments, alreadyPaid }
}

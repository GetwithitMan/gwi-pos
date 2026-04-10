/**
 * Order Event Sourcing — Shared Ingestion Pipeline
 *
 * Extracted from the batch endpoint so both the batch route (Android)
 * and the NUC pay route can share the same event→reducer→projector→bridge pipeline.
 *
 * Single source of truth: events are inserted, replayed, projected, and bridged
 * to legacy tables in one atomic flow.
 */

import { Prisma, PrismaClient } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'
import {
  type OrderEventPayload,
  type OrderState,
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
import {
  queueSocketEvent,
  queueTagSocketEvent,
  flushOutboxSafe,
} from '@/lib/socket-outbox'

const log = createChildLogger('order-events')

// ── Snapshot Cache (in-memory LRU) ──────────────────────────────────
//
// After each successful replay, we cache the reduced OrderState keyed by
// orderId. On the next ingestion for the same order we load the cached
// state and only replay events with serverSequence > cached lastSeq,
// turning an O(N) full-replay into O(k) where k = new events.
//
// Bounded to MAX_SNAPSHOT_CACHE entries. Eviction is LRU: on every hit
// we delete+re-set so the entry moves to the end of insertion order
// (Map preserves insertion order in JS). On overflow we delete the
// oldest (first) entry.

interface CachedSnapshot {
  state: OrderState
  lastSeq: number
}

const MAX_SNAPSHOT_CACHE = 500
const snapshotCache = new Map<string, CachedSnapshot>()

/** Read from cache with LRU promotion (delete + re-insert). */
function cacheGet(orderId: string): CachedSnapshot | undefined {
  const entry = snapshotCache.get(orderId)
  if (!entry) return undefined
  // LRU promote: move to end of insertion order
  snapshotCache.delete(orderId)
  snapshotCache.set(orderId, entry)
  return entry
}

/** Write to cache, evicting oldest entry if at capacity. */
function cacheSet(orderId: string, state: OrderState, lastSeq: number): void {
  // If already present, delete first so re-insert goes to end
  snapshotCache.delete(orderId)
  // Evict oldest if at capacity
  if (snapshotCache.size >= MAX_SNAPSHOT_CACHE) {
    const oldest = snapshotCache.keys().next().value
    if (oldest != null) snapshotCache.delete(oldest)
  }
  snapshotCache.set(orderId, { state, lastSeq })
}

/** Invalidate a cached snapshot (e.g. on corruption recovery). */
export function cacheInvalidate(orderId: string): void {
  snapshotCache.delete(orderId)
}

/** Clear the entire snapshot cache (useful for tests). */
export function cacheClear(): void {
  snapshotCache.clear()
}

/** Return current cache size (useful for diagnostics). */
export function cacheSize(): number {
  return snapshotCache.size
}

// ── Public interfaces ────────────────────────────────────────────────

export interface IngestEvent {
  eventId?: string
  type: string
  payload: Record<string, unknown>
  deviceId?: string
  correlationId?: string | null
  /** Client-side monotonic counter for FIFO ordering diagnostics */
  deviceCounter?: number
  /** Client schema version for migration safety */
  schemaVersion?: number
  /** Client-side event creation timestamp (ISO string or Date) */
  deviceCreatedAt?: string | Date | null
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
  // ── Wrap entire pipeline in a transaction for atomicity ──────────
  // This prevents race conditions where two Android devices sending the
  // same eventId concurrently could both pass a findUnique check and
  // crash on the unique constraint.

  const result = await (db as any).$transaction(async (tx: any) => {
    const accepted: { eventId: string; serverSequence: number }[] = []
    const newPaymentEvents: { payload: Record<string, unknown> }[] = []
    const ingestedEventTypes = new Set<string>()
    let alreadyPaid = false

    // ── 1. Event insertion (atomic idempotent via INSERT ON CONFLICT) ─

    for (const evt of events) {
      ingestedEventTypes.add(evt.type)
      const eventId = evt.eventId || crypto.randomUUID()
      const deviceId = evt.deviceId || 'nuc-server'

      // Atomic upsert: INSERT ... ON CONFLICT DO NOTHING eliminates the
      // TOCTOU race between findUnique and create. If the eventId already
      // exists, the INSERT is a no-op and returns zero rows.
      const inserted: Array<{ id: string; serverSequence: number }> =
        await tx.$queryRaw(
        Prisma.sql`INSERT INTO "order_events" (
          "id", "eventId", "orderId", "locationId", "deviceId",
          "deviceCounter", "serverSequence", "type", "payloadJson",
          "schemaVersion", "correlationId", "deviceCreatedAt",
          "createdAt", "updatedAt"
        )
        VALUES (
          gen_random_uuid(), ${eventId}, ${orderId}, ${locationId}, ${deviceId},
          ${evt.deviceCounter ?? 0}, nextval('order_event_server_seq'), ${evt.type}, ${JSON.stringify(evt.payload ?? {})}::jsonb,
          ${evt.schemaVersion ?? 1}, ${evt.correlationId ?? null}, ${evt.deviceCreatedAt ? new Date(evt.deviceCreatedAt) : new Date()},
          NOW(), NOW()
        )
        ON CONFLICT ("eventId") DO NOTHING
        RETURNING "id", "serverSequence"`,
      )

      if (inserted.length > 0) {
        // New event was inserted
        const serverSequence = Number(inserted[0].serverSequence)
        accepted.push({ eventId, serverSequence })

        // Track new PAYMENT_APPLIED events for bridge sync
        if (evt.type === 'PAYMENT_APPLIED' && evt.payload) {
          newPaymentEvents.push({ payload: evt.payload })
        }
      } else {
        // Duplicate eventId — fetch the existing serverSequence for the response
        const existing = await tx.orderEvent.findUnique({
          where: { eventId },
          select: { serverSequence: true },
        })
        if (existing) {
          accepted.push({ eventId, serverSequence: existing.serverSequence })
        }
      }
    }

    // ── 2. Replay & Project (snapshot-accelerated) ────────────────────
    //
    // Check the in-memory snapshot cache for this order. If a cached state
    // exists, we only fetch events with serverSequence > cached.lastSeq
    // and reduce incrementally. This turns a 30-event full replay into a
    // 1-2 event incremental apply — saving 50-200ms inside the locked tx.

    let state: OrderState
    let lastSequence: number

    const cached = cacheGet(orderId)

    if (cached) {
      // Incremental path: fetch only events newer than the snapshot
      const newEvents = await tx.orderEvent.findMany({
        where: { orderId, serverSequence: { gt: cached.lastSeq } },
        orderBy: { serverSequence: 'asc' },
        select: { type: true, payloadJson: true, serverSequence: true },
      })

      if (newEvents.length === 0) {
        // Snapshot is already up-to-date (all events were idempotent dupes)
        state = cached.state
        lastSequence = cached.lastSeq
      } else {
        // Reduce only the new events on top of the cached state
        state = cached.state
        lastSequence = cached.lastSeq
        for (const oe of newEvents) {
          const eventPayload = {
            type: oe.type,
            payload: oe.payloadJson,
          } as OrderEventPayload
          state = reduce(state, eventPayload)
          lastSequence = oe.serverSequence
        }
      }
    } else {
      // Full replay fallback: no cached snapshot, replay all events
      const orderEvents = await tx.orderEvent.findMany({
        where: { orderId },
        orderBy: { serverSequence: 'asc' },
        select: { type: true, payloadJson: true, serverSequence: true },
      })

      state = emptyOrderState(orderId)
      lastSequence = 0
      for (const oe of orderEvents) {
        const eventPayload = {
          type: oe.type,
          payload: oe.payloadJson,
        } as OrderEventPayload
        state = reduce(state, eventPayload)
        lastSequence = oe.serverSequence
      }
    }

    // Update the snapshot cache for next time
    cacheSet(orderId, state, lastSequence)

    await applyProjection(tx, state, locationId, lastSequence)

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
        lastMutatedBy: 'cloud' as const,
        ...(isNowClosed ? { paidAt: new Date(), closedAt: new Date() } : {}),
        ...(state.status === 'sent' ? { sentAt: new Date() } : {}),
      }

      if (isNowClosed) {
        // Guard: check if the order is already in a terminal status
        const orderUpdateResult = await tx.order.updateMany({
          where: { id: orderId, status: { notIn: closedStatuses as any[] } },
          data: bridgeData,
        })
        if (orderUpdateResult.count === 0) {
          const existing = await tx.order.findUnique({
            where: { id: orderId },
            select: { status: true },
          })
          if (existing && closedStatuses.includes(existing.status)) {
            alreadyPaid = true
          } else if (!existing) {
            // Order doesn't exist yet — create it
            await tx.order.create({
              data: {
                id: orderId,
                locationId,
                employeeId: state.employeeId,
                orderType: state.orderType,
                orderNumber: state.orderNumber,
                displayNumber: state.displayNumber,
                ...bridgeData,
                lastMutatedBy: 'cloud',
              },
            })
          }
        }
      } else {
        // Non-closed: standard upsert
        await tx.order.upsert({
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
            lastMutatedBy: 'cloud',
          },
          update: bridgeData,
        })
      }
    } catch (err) {
      log.error({ err: err }, `[ingester] Bridge sync to Order failed for ${orderId}:`)
    }

    // ── 4. Bridge sync: OrderItem table ────────────────────────────────

    try {
      const activeItems = Object.values(state.items)
      const existingItems = await tx.orderItem.findMany({
        where: { orderId, deletedAt: null },
        select: { id: true },
      })
      const activeItemIds = new Set(activeItems.map((i) => i.lineItemId))

      // Soft-delete items removed in event-sourced state
      const removedIds = existingItems
        .filter((e: { id: string }) => !activeItemIds.has(e.id))
        .map((e: { id: string }) => e.id)
      if (removedIds.length > 0) {
        await tx.orderItem.updateMany({
          where: { id: { in: removedIds } },
          data: { deletedAt: new Date(), status: 'voided', lastMutatedBy: 'cloud' },
        })
      }

      // Upsert each active item
      for (const item of activeItems) {
        const itemTotalCents = getItemTotalCents(item)
        await tx.orderItem.upsert({
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
            lastMutatedBy: 'cloud',
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
            lastMutatedBy: 'cloud',
            deletedAt: null, // Un-delete if re-added
          },
        })
      }
    } catch (err) {
      log.error({ err: err }, `[ingester] OrderItem bridge sync failed for ${orderId}:`)
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

        await tx.payment.upsert({
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
            lastMutatedBy: 'cloud',
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
        log.error({ err: err }, `[ingester] Payment bridge sync failed for order ${orderId}:`)
      }
    }

    // ── 6. Bridge legacy fields → snapshot ─────────────────────────────

    try {
      await bridgeLegacyFieldsToSnapshot(tx, orderId)
    } catch (err) {
      log.error({ err: err }, `[ingester] Legacy→Snapshot bridge failed for ${orderId}:`)
    }

    // ── 7. Transactional Outbox (Reliable KDS & Sync) ─────────────────
    //
    // For every NEW event accepted, queue corresponding socket events in the outbox.
    // This ensures that if the transaction commits, the side-effects (KDS routing,
    // cross-terminal sync) are guaranteed to be emitted.

    if (!options?.suppressBroadcast && accepted.length > 0) {
      for (const acc of accepted) {
        // Find the full event in the batch
        const evt = events.find((e) => e.eventId === acc.eventId)
        if (!evt) continue

        // a) order:event (Standard domain broadcast)
        await queueSocketEvent(tx, locationId, 'order:event', {
          eventId: acc.eventId,
          orderId,
          serverSequence: acc.serverSequence,
          type: evt.type,
          payload: evt.payload,
          deviceId: evt.deviceId,
        })

        // b) kds:order-received (KDS routing for ORDER_SENT)
        if (evt.type === 'ORDER_SENT') {
          try {
            // Lazy load OrderRouter to avoid circular dependencies
            const { OrderRouter } = await import('@/lib/order-router')
            const routingResult = await OrderRouter.resolveRouting(orderId)

            // Queue location-wide order:created
            await queueSocketEvent(tx, locationId, 'order:created', {
              orderId: routingResult.order.orderId,
              orderNumber: routingResult.order.orderNumber,
              orderType: routingResult.order.orderType,
              tableName: routingResult.order.tableName,
              tabName: routingResult.order.tabName,
              employeeName: routingResult.order.employeeName,
              createdAt: routingResult.order.createdAt.toISOString(),
              stations: routingResult.manifests.map((m) => m.stationName),
            })

            // Queue station-specific kds:order-received events
            for (const manifest of routingResult.manifests) {
              const orderEvent = {
                orderId: routingResult.order.orderId,
                orderNumber: routingResult.order.orderNumber,
                orderType: routingResult.order.orderType,
                tableName: routingResult.order.tableName,
                tabName: routingResult.order.tabName,
                employeeName: routingResult.order.employeeName,
                createdAt: routingResult.order.createdAt.toISOString(),
                primaryItems: manifest.primaryItems.map((item) => ({
                  id: item.id,
                  name: item.name,
                  quantity: item.quantity,
                  seatNumber: item.seatNumber,
                  specialNotes: item.specialNotes,
                  sourceTableName: item.sourceTableName,
                  modifiers: item.modifiers.map((m) => ({
                    name: m.name,
                    preModifier: m.preModifier,
                  })),
                  isPizza: item.isPizza,
                  isBar: item.isBar,
                  pizzaData: item.pizzaData,
                  pricingOptionLabel: item.pricingOptionLabel ?? null,
                  weight: item.weight ? Number(item.weight) : null,
                  weightUnit: item.weightUnit ?? null,
                  unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
                  soldByWeight: item.soldByWeight ?? false,
                  tareWeight: item.tareWeight ? Number(item.tareWeight) : null,
                })),
                referenceItems: manifest.referenceItems.map((item) => ({
                  id: item.id,
                  name: item.name,
                  quantity: item.quantity,
                  stationName: manifest.stationName,
                })),
                matchedTags: manifest.matchedTags,
                stationId: manifest.stationId,
                stationName: manifest.stationName,
              }
              await queueTagSocketEvent(tx, locationId, 'kds:order-received', orderEvent, manifest.matchedTags)
            }
          } catch (routerErr) {
            log.error({ err: routerErr, orderId }, '[ingester] KDS routing outbox failed')
          }
        }

        // c) order:summary-updated (Cross-terminal state sync)
        if (['ORDER_CREATED', 'ITEM_ADDED', 'ITEM_REMOVED', 'PAYMENT_APPLIED', 'ORDER_SENT', 'DISCOUNT_APPLIED', 'ORDER_METADATA_UPDATED', 'ORDER_CLOSED'].includes(evt.type)) {
          await queueSocketEvent(tx, locationId, 'order:summary-updated', {
            orderId,
            orderNumber: state.orderNumber,
            status: state.status,
            tableId: state.tableId || null,
            tableName: state.tableName || null,
            tabName: state.tabName || null,
            guestCount: state.guestCount,
            employeeId: state.employeeId,
            subtotalCents: getSubtotalCents(state),
            taxTotalCents: state.taxTotalCents,
            discountTotalCents: getDiscountTotalCents(state),
            tipTotalCents: getTipTotalCents(state),
            totalCents: getTotalCents(state),
            itemCount: getItemCount(state),
            updatedAt: new Date().toISOString(),
            locationId,
          })

          // Trigger general list-changed for legacy listeners
          await queueSocketEvent(tx, locationId, 'orders:list-changed', {
            trigger: 'updated',
            orderId,
            status: state.status,
          })
        }

        // d) order:closed
        if (evt.type === 'ORDER_CLOSED' || (evt.type === 'PAYMENT_APPLIED' && closedStatuses.includes(state.status))) {
          await queueSocketEvent(tx, locationId, 'order:closed', {
            orderId,
            status: state.status,
            closedAt: new Date().toISOString(),
            closedByEmployeeId: options?.employeeId || state.employeeId,
            locationId,
            _dedupKey: crypto.randomUUID(),
          })
        }

        // e) payment:processed (for each PAYMENT_APPLIED event)
        if (evt.type === 'PAYMENT_APPLIED' && evt.payload) {
          const p = evt.payload
          await queueSocketEvent(tx, locationId, 'payment:processed', {
            orderId,
            paymentId: p.paymentId || null,
            status: 'completed',
            method: p.method || null,
            amount: p.amountCents != null ? (p.amountCents as number) / 100 : 0,
            tipAmount: p.tipCents != null ? (p.tipCents as number) / 100 : 0,
            totalAmount: p.totalCents != null ? (p.totalCents as number) / 100 : 0,
            cardBrand: p.cardBrand || null,
            cardLast4: p.cardLast4 || null,
          })
        }

        // f) order:totals-updated (for events that change order totals)
        if (['ITEM_ADDED', 'ITEM_REMOVED', 'DISCOUNT_APPLIED', 'DISCOUNT_REMOVED', 'TIP_ADJUSTED', 'PAYMENT_APPLIED'].includes(evt.type)) {
          const subtotal = getSubtotalCents(state) / 100
          const discountTotal = getDiscountTotalCents(state) / 100
          const taxTotal = state.taxTotalCents / 100
          const tipTotal = getTipTotalCents(state) / 100
          const total = getTotalCents(state) / 100
          await queueSocketEvent(tx, locationId, 'order:totals-updated', {
            orderId,
            totals: { subtotal, taxTotal, discountTotal, tipTotal, total },
            timestamp: new Date().toISOString(),
          })
        }

        // g) kds:items-voided (ITEM_REMOVED after order has been sent to kitchen)
        if (evt.type === 'ITEM_REMOVED' && state.status !== 'draft' && state.status !== 'open') {
          const removedItemId = (evt.payload.lineItemId as string) || null
          if (removedItemId) {
            await queueSocketEvent(tx, locationId, 'kds:items-voided', {
              orderId,
              itemIds: [removedItemId],
              reason: (evt.payload.reason as string) || 'Voided from POS',
            })
          }
        }
      }
    }

    return { state, accepted, bridgedPayments, alreadyPaid }
  }) // end $transaction

  // ── 8. Flush outbox (post-commit) ──────────────────────────────────

  if (!options?.suppressBroadcast && result.accepted.length > 0) {
    flushOutboxSafe(locationId)
  }

  // ── 9. Return result ───────────────────────────────────────────────

  return result
}

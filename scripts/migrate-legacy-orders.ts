#!/usr/bin/env tsx
/**
 * Legacy Order Migration — Synthesize Event Streams
 *
 * For each existing Order that has no events in order_events,
 * this script synthesizes the domain events that would have produced
 * the order's current state:
 *
 *   ORDER_CREATED → N × ITEM_ADDED → ORDER_SENT (if sent)
 *   → payments → discounts → comp/voids → ORDER_CLOSED (if closed)
 *
 * Events are inserted with deviceId='migration' and replayed through
 * the reducer to produce snapshots in order_snapshots / order_item_snapshots.
 *
 * Usage:
 *   npx tsx scripts/migrate-legacy-orders.ts                # migrate all
 *   npx tsx scripts/migrate-legacy-orders.ts --dry-run      # preview only
 *   npx tsx scripts/migrate-legacy-orders.ts --location loc-1  # single location
 *   npx tsx scripts/migrate-legacy-orders.ts --order ord-123   # single order
 *
 * Idempotent: orders that already have events are skipped.
 */

import { PrismaClient } from '@prisma/client'
import type { OrderEventType } from '../src/lib/order-events/types'
import {
  emptyOrderState,
  getSubtotalCents,
  getTotalCents,
  getItemCount,
} from '../src/lib/order-events/types'
import { reduce, replay } from '../src/lib/order-events/reducer'
import {
  projectSnapshot,
  projectItemSnapshots,
} from '../src/lib/order-events/projector'

const PREFIX = '[migrate-legacy-orders]'
const DEVICE_ID = 'migration'
const BATCH_SIZE = 50

// ── CLI args ──────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const locationArg = args.find((a) => a.startsWith('--location'))
  ? args[args.indexOf('--location') + 1]
  : undefined
const orderArg = args.find((a) => a.startsWith('--order'))
  ? args[args.indexOf('--order') + 1]
  : undefined

if (dryRun) console.log(`${PREFIX} DRY RUN — no writes will be made`)

// ── Helpers ───────────────────────────────────────────────────────

function toCents(decimal: any): number {
  if (decimal == null) return 0
  return Math.round(Number(decimal) * 100)
}

interface SyntheticEvent {
  type: OrderEventType
  payload: Record<string, unknown>
}

/**
 * Build the synthetic event list for a single order.
 */
function synthesizeEvents(order: any): SyntheticEvent[] {
  const events: SyntheticEvent[] = []

  // 1. ORDER_CREATED
  events.push({
    type: 'ORDER_CREATED',
    payload: {
      locationId: order.locationId,
      employeeId: order.employeeId,
      orderType: order.orderType ?? 'dine_in',
      tableId: order.tableId ?? null,
      tabName: order.tabName ?? null,
      guestCount: order.guestCount ?? 1,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber ?? null,
    },
  })

  // 2. ITEM_ADDED for each active/comped/voided item
  for (const item of order.items) {
    if (item.deletedAt) continue
    events.push({
      type: 'ITEM_ADDED',
      payload: {
        lineItemId: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        priceCents: toCents(item.price),
        quantity: item.quantity ?? 1,
        modifiersJson: item.modifiers?.length
          ? JSON.stringify(
              item.modifiers.map((m: any) => ({
                id: m.modifierId,
                name: m.name,
                price: toCents(m.price),
                preModifier: m.preModifier,
                quantity: m.quantity,
                depth: m.depth,
              }))
            )
          : null,
        specialNotes: item.specialNotes ?? null,
        seatNumber: item.seatNumber ?? null,
        courseNumber: item.courseNumber ?? null,
        isHeld: item.isHeld ?? false,
        soldByWeight: item.soldByWeight ?? false,
        weight: item.weight != null ? Number(item.weight) : null,
        weightUnit: item.weightUnit ?? null,
        unitPriceCents:
          item.unitPrice != null ? toCents(item.unitPrice) : null,
        grossWeight:
          item.grossWeight != null ? Number(item.grossWeight) : null,
        tareWeight: item.tareWeight != null ? Number(item.tareWeight) : null,
        pricingOptionId: item.pricingOptionId ?? null,
        pricingOptionLabel: item.pricingOptionLabel ?? null,
        costAtSaleCents:
          item.costAtSale != null ? toCents(item.costAtSale) : null,
        pourSize: item.pourSize ?? null,
        pourMultiplier:
          item.pourMultiplier != null ? Number(item.pourMultiplier) : null,
      },
    })
  }

  // 3. ITEM_UPDATED for held items (isHeld was set after creation)
  for (const item of order.items) {
    if (item.deletedAt) continue
    if (item.kitchenStatus !== 'pending' && item.kitchenStatus !== null) {
      // Item was sent — will be handled by ORDER_SENT
    }
  }

  // 4. ORDER_SENT if the order was sent (sentAt exists or any item has kitchenStatus != pending)
  if (order.sentAt) {
    const sentItemIds = order.items
      .filter(
        (i: any) =>
          !i.deletedAt &&
          i.kitchenStatus !== 'pending' &&
          i.status !== 'voided' &&
          i.status !== 'comped'
      )
      .map((i: any) => i.id)
    events.push({
      type: 'ORDER_SENT',
      payload: { sentItemIds },
    })
  }

  // 5. DISCOUNT_APPLIED for order-level discounts
  for (const disc of order.discounts ?? []) {
    if (disc.deletedAt) continue
    events.push({
      type: 'DISCOUNT_APPLIED',
      payload: {
        discountId: disc.id,
        type: disc.percent != null ? 'percent' : 'fixed',
        value: disc.percent != null ? Number(disc.percent) : Number(disc.amount),
        amountCents: toCents(disc.amount),
        reason: disc.reason ?? null,
      },
    })
  }

  // 6. DISCOUNT_APPLIED for item-level discounts
  for (const itemDisc of order.itemDiscounts ?? []) {
    if (itemDisc.deletedAt) continue
    events.push({
      type: 'DISCOUNT_APPLIED',
      payload: {
        discountId: itemDisc.id,
        type: itemDisc.percent != null ? 'percent' : 'fixed',
        value:
          itemDisc.percent != null
            ? Number(itemDisc.percent)
            : Number(itemDisc.amount),
        amountCents: toCents(itemDisc.amount),
        reason: itemDisc.reason ?? null,
        lineItemId: itemDisc.orderItemId,
      },
    })
  }

  // 7. COMP_VOID_APPLIED for comped/voided items
  for (const item of order.items) {
    if (item.deletedAt) continue
    if (item.status === 'comped') {
      events.push({
        type: 'COMP_VOID_APPLIED',
        payload: {
          lineItemId: item.id,
          action: 'comp',
          reason: item.voidReason ?? null,
          employeeId: order.employeeId,
        },
      })
    } else if (item.status === 'voided') {
      events.push({
        type: 'COMP_VOID_APPLIED',
        payload: {
          lineItemId: item.id,
          action: 'void',
          reason: item.voidReason ?? null,
          employeeId: order.employeeId,
        },
      })
    }
  }

  // 8. TAB_OPENED if this is a tab with pre-auth
  if (order.tabStatus === 'open' || order.tabStatus === 'closed') {
    if (order.preAuthId || order.tabName) {
      events.push({
        type: 'TAB_OPENED',
        payload: {
          cardLast4: order.preAuthLast4 ?? null,
          preAuthId: order.preAuthId ?? null,
          tabName: order.tabName ?? null,
        },
      })
    }
  }

  // 9. PAYMENT_APPLIED for each payment
  for (const pay of order.payments ?? []) {
    if (pay.deletedAt) continue
    if (pay.status === 'voided') {
      // First emit the original payment, then void it
      events.push({
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId: pay.id,
          method: pay.paymentMethod ?? 'cash',
          amountCents: toCents(pay.amount),
          tipCents: toCents(pay.tipAmount),
          totalCents: toCents(pay.totalAmount),
          cardBrand: pay.cardBrand ?? null,
          cardLast4: pay.cardLast4 ?? null,
          status: 'approved',
        },
      })
      events.push({
        type: 'PAYMENT_VOIDED',
        payload: {
          paymentId: pay.id,
          reason: pay.voidReason ?? null,
          employeeId: pay.voidedBy ?? null,
        },
      })
    } else {
      events.push({
        type: 'PAYMENT_APPLIED',
        payload: {
          paymentId: pay.id,
          method: pay.paymentMethod ?? 'cash',
          amountCents: toCents(pay.amount),
          tipCents: toCents(pay.tipAmount),
          totalCents: toCents(pay.totalAmount),
          cardBrand: pay.cardBrand ?? null,
          cardLast4: pay.cardLast4 ?? null,
          status: 'approved',
        },
      })
    }
  }

  // 10. TAB_CLOSED if tab was closed
  if (order.tabStatus === 'closed') {
    events.push({
      type: 'TAB_CLOSED',
      payload: {
        employeeId: order.employeeId,
      },
    })
  }

  // 11. GUEST_COUNT_CHANGED if not default
  // (Already set in ORDER_CREATED, skip unless we want to track history)

  // 12. NOTE_CHANGED if order has notes
  if (order.notes) {
    events.push({
      type: 'NOTE_CHANGED',
      payload: { note: order.notes },
    })
  }

  // 13. ORDER_CLOSED if the order is closed
  const closedStatuses = ['paid', 'voided', 'cancelled', 'void']
  if (closedStatuses.includes(order.status)) {
    events.push({
      type: 'ORDER_CLOSED',
      payload: { closedStatus: order.status },
    })
  }

  return events
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient()

  try {
    // Find orders that DON'T already have events (idempotent)
    const where: any = {
      deletedAt: null,
    }
    if (locationArg) where.locationId = locationArg
    if (orderArg) where.id = orderArg

    const totalCount = await prisma.order.count({ where })
    console.log(`${PREFIX} Found ${totalCount} orders to evaluate`)

    let migrated = 0
    let skipped = 0
    let errors = 0
    let cursor: string | undefined

    while (true) {
      // Fetch a batch of orders with their relations
      const orders = await prisma.order.findMany({
        where,
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { createdAt: 'asc' },
        include: {
          items: {
            include: { modifiers: true },
            orderBy: { createdAt: 'asc' },
          },
          payments: { orderBy: { createdAt: 'asc' } },
          discounts: { orderBy: { createdAt: 'asc' } },
          itemDiscounts: { orderBy: { createdAt: 'asc' } },
        },
      })

      if (orders.length === 0) break
      cursor = orders[orders.length - 1].id

      for (const order of orders) {
        try {
          // Check if this order already has events
          const existingCount = await prisma.orderEvent.count({
            where: { orderId: order.id },
          })
          if (existingCount > 0) {
            skipped++
            continue
          }

          const syntheticEvents = synthesizeEvents(order)
          if (syntheticEvents.length === 0) {
            skipped++
            continue
          }

          if (dryRun) {
            console.log(
              `${PREFIX}   [dry-run] ${order.id} → ${syntheticEvents.length} events (${syntheticEvents.map((e) => e.type).join(', ')})`
            )
            migrated++
            continue
          }

          // Insert events with serverSequence
          const insertedEvents: Array<{
            type: string
            serverSequence: number
          }> = []

          for (const evt of syntheticEvents) {
            const [seqRow] = await prisma.$queryRawUnsafe<
              { nextval: bigint | number }[]
            >(`SELECT nextval('order_event_server_seq')`)
            const serverSequence = Number(seqRow.nextval)

            await prisma.orderEvent.create({
              data: {
                eventId: crypto.randomUUID(),
                orderId: order.id,
                locationId: order.locationId,
                deviceId: DEVICE_ID,
                deviceCounter: 0,
                serverSequence,
                type: evt.type,
                payloadJson: evt.payload as any,
                schemaVersion: 1,
                correlationId: 'legacy-migration',
                deviceCreatedAt: order.createdAt,
              },
            })

            insertedEvents.push({ type: evt.type, serverSequence })
          }

          // Replay through reducer and project snapshots
          const eventPayloads = syntheticEvents.map(
            (e) => ({ type: e.type, payload: e.payload }) as any
          )
          const state = replay(order.id, eventPayloads)
          const lastSequence =
            insertedEvents[insertedEvents.length - 1].serverSequence

          // Project into snapshots
          const snapshotData = projectSnapshot(
            state,
            order.locationId,
            lastSequence
          )
          const itemRows = projectItemSnapshots(state, order.locationId)

          await prisma.$transaction(async (tx) => {
            await tx.orderSnapshot.upsert({
              where: { id: order.id },
              create: snapshotData,
              update: snapshotData,
            })
            await tx.orderItemSnapshot.deleteMany({
              where: { snapshotId: order.id },
            })
            if (itemRows.length > 0) {
              await tx.orderItemSnapshot.createMany({ data: itemRows })
            }
          })

          migrated++
          if (migrated % 100 === 0) {
            console.log(`${PREFIX}   Progress: ${migrated} migrated, ${skipped} skipped, ${errors} errors`)
          }
        } catch (err) {
          errors++
          console.error(
            `${PREFIX}   ERROR migrating order ${order.id}:`,
            err instanceof Error ? err.message : err
          )
        }
      }
    }

    console.log(`${PREFIX} Migration complete:`)
    console.log(`${PREFIX}   Migrated: ${migrated}`)
    console.log(`${PREFIX}   Skipped (already have events): ${skipped}`)
    console.log(`${PREFIX}   Errors: ${errors}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err)
  process.exit(1)
})

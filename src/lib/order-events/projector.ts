/**
 * Order Event Sourcing — Snapshot Projector
 *
 * Converts an OrderState (produced by the reducer) into Prisma-compatible
 * data objects for the OrderSnapshot and OrderItemSnapshot tables.
 *
 * All monetary values are integer cents (number).
 */

import { Prisma, PrismaClient } from '@prisma/client'

import {
  OrderState,
  OrderLineItem,
  ItemDiscount,
  getSubtotalCents,
  getDiscountTotalCents,
  getTotalCents,
  getPaidAmountCents,
  getTipTotalCents,
  getItemCount,
  getHasHeldItems,
  getItemTotalCents,
} from './types'

// ── Private helpers ───────────────────────────────────────────────────────────

/**
 * Safely parse a modifiersJson string into a Prisma-compatible JSON value.
 * Returns Prisma.JsonNull when the string is absent or unparseable.
 */
function parseModifiersJson(
  raw: string | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (raw == null || raw === '') return Prisma.JsonNull
  try {
    return JSON.parse(raw) as Prisma.InputJsonValue
  } catch {
    return Prisma.JsonNull
  }
}

/**
 * Serialize per-item discounts into a Prisma-compatible JSON array.
 *
 * Mirrors Android's `itemDiscountsToJson()`:
 *   [{id, amount, percent?, reason?}]
 *
 * Returns Prisma.JsonNull when the record is empty.
 */
function serializeItemDiscounts(
  discounts: Record<string, ItemDiscount>
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const entries = Object.entries(discounts)
  if (entries.length === 0) return Prisma.JsonNull

  return entries.map(([id, d]) => {
    const entry: Record<string, unknown> = {
      id,
      amount: d.amountCents,
    }
    if (d.percent != null) entry.percent = d.percent
    if (d.reason != null) entry.reason = d.reason
    return entry
  }) as Prisma.InputJsonValue
}

// ── Public projectors ─────────────────────────────────────────────────────────

/**
 * Build an OrderSnapshot create/update payload from the current OrderState.
 *
 * @param state             The fully-reduced OrderState.
 * @param locationId        The venue's location ID (multi-tenant isolation).
 * @param lastEventSequence The server-assigned sequence number of the last
 *                          event that was applied before this projection.
 */
export function projectSnapshot(
  state: OrderState,
  locationId: string,
  lastEventSequence: number
) {
  return {
    id: state.orderId,
    locationId,
    employeeId: state.employeeId,
    orderType: state.orderType,
    tableId: state.tableId ?? null,
    tableName: state.tableName ?? null,
    tabName: state.tabName ?? null,
    tabStatus: state.tabStatus ?? null,
    guestCount: state.guestCount,
    orderNumber: state.orderNumber,
    displayNumber: state.displayNumber ?? null,
    status: state.status,
    notes: state.notes ?? null,
    hasPreAuth: state.hasPreAuth,
    cardLast4: state.cardLast4 ?? null,
    subtotalCents: getSubtotalCents(state),
    discountTotalCents: getDiscountTotalCents(state),
    taxTotalCents: state.taxTotalCents,
    tipTotalCents: getTipTotalCents(state),
    totalCents: getTotalCents(state),
    paidAmountCents: getPaidAmountCents(state),
    itemCount: getItemCount(state),
    hasHeldItems: getHasHeldItems(state),
    isClosed: state.isClosed,
    lastEventSequence,
  }
}

/**
 * Build an array of OrderItemSnapshot create payloads from the current
 * OrderState. One row is produced per item in state.items.
 *
 * @param state      The fully-reduced OrderState.
 * @param locationId The venue's location ID (multi-tenant isolation).
 */
export function projectItemSnapshots(
  state: OrderState,
  locationId: string
) {
  return Object.values(state.items).map((item: OrderLineItem) => ({
    id: item.lineItemId,
    snapshotId: state.orderId,
    locationId,
    menuItemId: item.menuItemId,
    name: item.name,
    priceCents: item.priceCents,
    quantity: item.quantity,
    modifiersJson: parseModifiersJson(item.modifiersJson),
    specialNotes: item.specialNotes ?? null,
    seatNumber: item.seatNumber ?? null,
    courseNumber: item.courseNumber ?? null,
    isHeld: item.isHeld,
    kitchenStatus: item.kitchenStatus ?? null,
    soldByWeight: item.soldByWeight,
    weight: item.weight ?? null,
    weightUnit: item.weightUnit ?? null,
    unitPriceCents: item.unitPriceCents ?? null,
    grossWeight: item.grossWeight ?? null,
    tareWeight: item.tareWeight ?? null,
    status: item.status ?? 'active',
    isCompleted: item.isCompleted,
    resendCount: item.resendCount,
    delayMinutes: item.delayMinutes ?? null,
    totalCents: getItemTotalCents(item),
    pricingOptionId: item.pricingOptionId ?? null,
    pricingOptionLabel: item.pricingOptionLabel ?? null,
    costAtSaleCents: item.costAtSaleCents ?? null,
    pourSize: item.pourSize ?? null,
    pourMultiplier: item.pourMultiplier ?? null,
    itemDiscountsJson: serializeItemDiscounts(item.itemDiscounts),
  }))
}

/**
 * Atomically persist an OrderSnapshot and its OrderItemSnapshot rows.
 *
 * Runs inside a Prisma interactive transaction:
 *   1. Upsert the OrderSnapshot row (create or update all scalar fields).
 *   2. Delete all existing OrderItemSnapshot rows for this order.
 *   3. Bulk-insert fresh OrderItemSnapshot rows (skipped when the order has
 *      no items so that createMany is never called with an empty array).
 *
 * @param db                A PrismaClient instance (or the injected tenant
 *                          client from the request context).
 * @param state             The fully-reduced OrderState.
 * @param locationId        The venue's location ID.
 * @param lastEventSequence Server sequence of the last applied event.
 */
export async function applyProjection(
  db: PrismaClient,
  state: OrderState,
  locationId: string,
  lastEventSequence: number
): Promise<void> {
  const snapshotData = projectSnapshot(state, locationId, lastEventSequence)
  const itemRows = projectItemSnapshots(state, locationId)

  await db.$transaction(async (tx) => {
    // 1. Upsert the order-level snapshot.
    await tx.orderSnapshot.upsert({
      where: { id: state.orderId },
      create: snapshotData,
      update: snapshotData,
    })

    // 2. Delete all existing item snapshots for this order so that removed
    //    items are not left as stale rows.
    await tx.orderItemSnapshot.deleteMany({
      where: { snapshotId: state.orderId },
    })

    // 3. Bulk-insert the current item set (skip when empty).
    if (itemRows.length > 0) {
      await tx.orderItemSnapshot.createMany({
        data: itemRows,
      })
    }
  })
}

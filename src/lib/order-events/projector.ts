/**
 * Order Event Sourcing — Snapshot Projector
 *
 * Converts an OrderState (produced by the reducer) into Prisma-compatible
 * data objects for the OrderSnapshot and OrderItemSnapshot tables.
 *
 * Also provides a bridge function (`bridgeLegacyFieldsToSnapshot`) to copy
 * fields from legacy Order/OrderItem tables that aren't yet carried by events.
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

    // --- New snapshot bridge fields ---
    customerId: state.customerId ?? null,
    source: state.source ?? null,
    parentOrderId: state.parentOrderId ?? null,
    splitIndex: state.splitIndex ?? null,
    orderTypeId: state.orderTypeId ?? null,
    currentCourse: state.currentCourse ?? 0,
    courseMode: state.courseMode ?? 'off',
    sentAt: state.sentAt ? new Date(state.sentAt) : null,
    reopenedAt: state.reopenedAt ? new Date(state.reopenedAt) : null,
    reopenReason: state.reopenReason ?? null,
    preAuthId: state.preAuthId ?? null,
    preAuthAmount: state.preAuthAmount ?? null,
    preAuthLast4: state.preAuthLast4 ?? null,
    preAuthCardBrand: state.preAuthCardBrand ?? null,
    isBottleService: state.isBottleService ?? false,
    isWalkout: state.isWalkout ?? false,
    offlineId: state.offlineId ?? null,
    version: state.version ?? 0,
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

    // --- New snapshot bridge fields ---
    firedAt: item.firedAt ? new Date(item.firedAt) : null,
    delayStartedAt: item.delayStartedAt ? new Date(item.delayStartedAt) : null,
    completedAt: item.completedAt ? new Date(item.completedAt) : null,
    courseStatus: item.courseStatus ?? null,
    blockTimeMinutes: item.blockTimeMinutes ?? null,
    blockTimeStartedAt: item.blockTimeStartedAt ? new Date(item.blockTimeStartedAt) : null,
    blockTimeExpiresAt: item.blockTimeExpiresAt ? new Date(item.blockTimeExpiresAt) : null,
    addedByEmployeeId: item.addedByEmployeeId ?? null,
    cardPrice: item.cardPrice ?? null,
    voidReason: item.voidReason ?? null,
    modifierTotal: item.modifierTotal ?? 0,
    itemTotal: item.itemTotal ?? getItemTotalCents(item),
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

// ── Legacy → Snapshot Bridge ──────────────────────────────────────────────────

/** Convert a Decimal/number to integer cents, defaulting to 0. */
function toCents(v: unknown): number {
  if (v == null) return 0
  return Math.round(Number(v) * 100)
}

/** Convert a nullable Decimal/number to integer cents or null. */
function toCentsOrNull(v: unknown): number | null {
  if (v == null) return null
  return Math.round(Number(v) * 100)
}

/**
 * Bridge: Copy fields from the legacy Order/OrderItem tables into the
 * corresponding OrderSnapshot/OrderItemSnapshot rows.
 *
 * During the transition period, legacy NUC routes write to Order/OrderItem with
 * ALL fields (customerId, preAuth, walkout, coursing, etc.) but domain events
 * only carry a subset. After the event-sourced projection runs, this bridge
 * reads the legacy tables and patches the snapshot rows so they stay complete
 * even for fields not yet carried by events.
 *
 * Safe to call when no legacy Order exists (e.g. pure Android-created orders
 * that have no legacy counterpart yet) — will silently return.
 *
 * @param db      A PrismaClient instance.
 * @param orderId The order ID (same as snapshot ID).
 */
export async function bridgeLegacyFieldsToSnapshot(
  db: PrismaClient,
  orderId: string,
): Promise<void> {
  // 1. Read legacy Order with the fields we need to bridge
  const legacyOrder = await db.order.findUnique({
    where: { id: orderId },
    select: {
      // --- Customer & Attribution ---
      customerId: true,
      source: true,
      // --- Split Orders ---
      parentOrderId: true,
      splitIndex: true,
      // --- Order Type ---
      orderTypeId: true,
      customFields: true,
      // --- Seating ---
      baseSeatCount: true,
      extraSeatCount: true,
      seatVersion: true,
      seatTimestamps: true,
      // --- Tabs ---
      tabNickname: true,
      // --- Dual Pricing ---
      primaryPaymentMethod: true,
      // --- Commission ---
      commissionTotal: true,
      // --- Reopen ---
      reopenedAt: true,
      reopenedBy: true,
      reopenReason: true,
      // --- Timing ---
      openedAt: true,
      sentAt: true,
      // --- Pre-Auth ---
      preAuthId: true,
      preAuthAmount: true,
      preAuthLast4: true,
      preAuthCardBrand: true,
      preAuthExpiresAt: true,
      preAuthRecordNo: true,
      // --- Bottle Service ---
      isBottleService: true,
      bottleServiceCurrentSpend: true,
      // --- Walkout ---
      isWalkout: true,
      walkoutAt: true,
      walkoutMarkedBy: true,
      // --- Tab Rollover ---
      rolledOverAt: true,
      rolledOverFrom: true,
      // --- Decline Retry ---
      captureDeclinedAt: true,
      captureRetryCount: true,
      lastCaptureError: true,
      // --- Coursing ---
      currentCourse: true,
      courseMode: true,
      // --- Offline ---
      offlineId: true,
      offlineLocalId: true,
      offlineTimestamp: true,
      offlineTerminalId: true,
      // --- Business Day ---
      businessDayDate: true,
      // --- Concurrency ---
      version: true,
      // --- Items with bridge fields ---
      items: {
        where: { deletedAt: null },
        select: {
          id: true,
          holdUntil: true,
          firedAt: true,
          delayStartedAt: true,
          completedAt: true,
          lastResentAt: true,
          resendNote: true,
          blockTimeMinutes: true,
          blockTimeStartedAt: true,
          blockTimeExpiresAt: true,
          courseStatus: true,
          wasMade: true,
          modifierTotal: true,
          itemTotal: true,
          cardPrice: true,
          commissionAmount: true,
          isTaxInclusive: true,
          addedByEmployeeId: true,
          categoryType: true,
          voidReason: true,
          idempotencyKey: true,
        },
      },
    },
  })

  if (!legacyOrder) return

  // 2. Patch the OrderSnapshot with legacy Order fields
  await db.orderSnapshot.update({
    where: { id: orderId },
    data: {
      // --- Customer & Attribution ---
      customerId: legacyOrder.customerId,
      source: legacyOrder.source,
      // --- Split Orders ---
      parentOrderId: legacyOrder.parentOrderId,
      splitIndex: legacyOrder.splitIndex,
      // --- Order Type ---
      orderTypeId: legacyOrder.orderTypeId,
      customFields: legacyOrder.customFields ?? Prisma.DbNull,
      // --- Seating ---
      baseSeatCount: legacyOrder.baseSeatCount,
      extraSeatCount: legacyOrder.extraSeatCount,
      seatVersion: legacyOrder.seatVersion,
      seatTimestamps: legacyOrder.seatTimestamps ?? Prisma.DbNull,
      // --- Tabs ---
      tabNickname: legacyOrder.tabNickname,
      // --- Dual Pricing ---
      primaryPaymentMethod: legacyOrder.primaryPaymentMethod,
      // --- Commission ---
      commissionTotal: toCents(legacyOrder.commissionTotal),
      // --- Reopen ---
      reopenedAt: legacyOrder.reopenedAt,
      reopenedBy: legacyOrder.reopenedBy,
      reopenReason: legacyOrder.reopenReason,
      // --- Timing ---
      openedAt: legacyOrder.openedAt,
      sentAt: legacyOrder.sentAt,
      // --- Pre-Auth ---
      preAuthId: legacyOrder.preAuthId,
      preAuthAmount: toCentsOrNull(legacyOrder.preAuthAmount),
      preAuthLast4: legacyOrder.preAuthLast4,
      preAuthCardBrand: legacyOrder.preAuthCardBrand,
      preAuthExpiresAt: legacyOrder.preAuthExpiresAt,
      preAuthRecordNo: legacyOrder.preAuthRecordNo,
      // --- Bottle Service ---
      isBottleService: legacyOrder.isBottleService,
      bottleServiceCurrentSpend: toCentsOrNull(legacyOrder.bottleServiceCurrentSpend),
      // --- Walkout ---
      isWalkout: legacyOrder.isWalkout,
      walkoutAt: legacyOrder.walkoutAt,
      walkoutMarkedBy: legacyOrder.walkoutMarkedBy,
      // --- Tab Rollover ---
      rolledOverAt: legacyOrder.rolledOverAt,
      rolledOverFrom: legacyOrder.rolledOverFrom,
      // --- Decline Retry ---
      captureDeclinedAt: legacyOrder.captureDeclinedAt,
      captureRetryCount: legacyOrder.captureRetryCount,
      lastCaptureError: legacyOrder.lastCaptureError,
      // --- Coursing ---
      currentCourse: legacyOrder.currentCourse,
      courseMode: String(legacyOrder.courseMode),
      // --- Offline ---
      offlineId: legacyOrder.offlineId,
      offlineLocalId: legacyOrder.offlineLocalId,
      offlineTimestamp: legacyOrder.offlineTimestamp,
      offlineTerminalId: legacyOrder.offlineTerminalId,
      // --- Business Day ---
      businessDayDate: legacyOrder.businessDayDate,
      // --- Concurrency ---
      version: legacyOrder.version,
    },
  })

  // 3. Patch each OrderItemSnapshot with legacy OrderItem fields
  for (const item of legacyOrder.items) {
    await db.orderItemSnapshot.updateMany({
      where: { id: item.id, snapshotId: orderId },
      data: {
        // --- Hold & Fire ---
        holdUntil: item.holdUntil,
        firedAt: item.firedAt,
        delayStartedAt: item.delayStartedAt,
        // --- KDS ---
        completedAt: item.completedAt,
        // --- Resend ---
        lastResentAt: item.lastResentAt,
        resendNote: item.resendNote,
        // --- Entertainment ---
        blockTimeMinutes: item.blockTimeMinutes,
        blockTimeStartedAt: item.blockTimeStartedAt,
        blockTimeExpiresAt: item.blockTimeExpiresAt,
        // --- Course ---
        courseStatus: item.courseStatus ? String(item.courseStatus) : null,
        // --- Waste ---
        wasMade: item.wasMade,
        // --- Pricing ---
        modifierTotal: toCents(item.modifierTotal),
        itemTotal: toCents(item.itemTotal),
        cardPrice: toCentsOrNull(item.cardPrice),
        // --- Commission ---
        commissionAmount: toCentsOrNull(item.commissionAmount),
        // --- Tax ---
        isTaxInclusive: item.isTaxInclusive,
        // --- Ownership ---
        addedByEmployeeId: item.addedByEmployeeId,
        // --- Category ---
        categoryType: item.categoryType,
        // --- Void ---
        voidReason: item.voidReason,
        // --- Idempotency ---
        idempotencyKey: item.idempotencyKey,
      },
    })
  }
}

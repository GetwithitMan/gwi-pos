/**
 * Entertainment Domain — Session Operations (DB-accessing orchestration)
 *
 * These functions take a TxClient (Prisma transaction) and perform
 * the database writes for session lifecycle operations.
 * They do NOT dispatch socket events or handle HTTP concerns.
 */

import type { TxClient, StartSessionInput, StartSessionResult, StopSessionResult, StopReason, ExtendSessionResult, StopAllSessionResult } from './types'
import type { MenuItemPricingFields } from './types'
import type { ChargeBreakdown } from '@/lib/entertainment-pricing'
import { calculateStopCharge, calculateExtensionCharge, calculateExpiryCharge } from './pricing'

// ─── Start Session ───────────────────────────────────────────────────────────

/**
 * Start a block-time session inside a transaction.
 * Locks the MenuItem row with FOR UPDATE to prevent double-booking.
 * Checks for notified waitlist entries.
 *
 * Returns conflict/waitlistConflict flags or the updated item.
 */
export async function startSession(
  tx: TxClient,
  input: StartSessionInput
): Promise<StartSessionResult> {
  const { orderItemId, menuItemId, orderId, locationId, minutes, initialPrice, now, expiresAt } = input

  // Lock the MenuItem row and check status
  const [lockedItem] = await tx.$queryRaw<Array<{ entertainmentStatus: string | null }>>`
    SELECT "entertainmentStatus" FROM "MenuItem" WHERE "id" = ${menuItemId} FOR UPDATE
  `

  if (lockedItem?.entertainmentStatus === 'in_use') {
    return { conflict: true, waitlistConflict: false, updatedItem: null, notifiedCustomer: null }
  }

  // Check if a waitlisted customer has been notified for this item
  const floorPlanElement = await tx.floorPlanElement.findFirst({
    where: { linkedMenuItemId: menuItemId, deletedAt: null },
    select: { id: true, visualType: true },
  })

  if (floorPlanElement) {
    const notifiedEntry = await tx.entertainmentWaitlist.findFirst({
      where: {
        deletedAt: null,
        status: 'notified',
        OR: [
          { elementId: floorPlanElement.id },
          { visualType: floorPlanElement.visualType },
        ],
      },
      select: { id: true, customerName: true },
    })

    if (notifiedEntry) {
      return { conflict: false, waitlistConflict: true, updatedItem: null, notifiedCustomer: notifiedEntry.customerName }
    }
  }

  // 1. Update the order item with block time info and initial price
  const updatedItem = await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      blockTimeMinutes: minutes,
      blockTimeStartedAt: now,
      blockTimeExpiresAt: expiresAt,
      price: initialPrice,
      itemTotal: initialPrice,
    },
    select: {
      id: true,
      name: true,
      blockTimeMinutes: true,
      blockTimeStartedAt: true,
      blockTimeExpiresAt: true,
      menuItemId: true,
    },
  })

  // 2. Update the menu item status to in_use
  await tx.menuItem.update({
    where: { id: menuItemId },
    data: {
      entertainmentStatus: 'in_use',
      currentOrderId: orderId,
      currentOrderItemId: orderItemId,
    },
  })

  // 3. Update floor plan element if exists
  await tx.floorPlanElement.updateMany({
    where: {
      linkedMenuItemId: menuItemId,
      deletedAt: null,
    },
    data: {
      status: 'in_use',
      currentOrderId: orderId,
      sessionStartedAt: now,
      sessionExpiresAt: expiresAt,
    },
  })

  return { conflict: false, waitlistConflict: false, updatedItem, notifiedCustomer: null }
}

// ─── Stop Session ────────────────────────────────────────────────────────────

/**
 * Stop a block-time session inside a transaction.
 * Uses FOR UPDATE locks on OrderItem and MenuItem to prevent race conditions
 * with the cron expiry job.
 */
export async function stopSession(
  tx: TxClient,
  input: {
    orderItemId: string
    menuItemId: string
    reason: StopReason
    now: Date
    menuItem: MenuItemPricingFields
  }
): Promise<StopSessionResult> {
  const { orderItemId, menuItemId, reason, now, menuItem } = input

  // Lock the OrderItem row to prevent concurrent modification
  const [lockedRow] = await tx.$queryRaw<Array<{
    blockTimeStartedAt: Date | null
    blockTimeMinutes: number | null
  }>>`
    SELECT "blockTimeStartedAt", "blockTimeMinutes"
    FROM "OrderItem"
    WHERE "id" = ${orderItemId}
    FOR UPDATE
  `

  // Lock the MenuItem row
  const [lockedMenuItem] = await tx.$queryRaw<Array<{
    entertainmentStatus: string | null
    currentOrderItemId: string | null
  }>>`
    SELECT "entertainmentStatus", "currentOrderItemId"
    FROM "MenuItem"
    WHERE "id" = ${menuItemId}
    FOR UPDATE
  `

  // Idempotency: if already stopped (cron won the race), return success without re-charging
  // For 'force' reason, skip idempotency check
  if (reason !== 'force') {
    if (!lockedRow?.blockTimeStartedAt ||
        lockedMenuItem?.entertainmentStatus === 'available' ||
        (lockedMenuItem?.currentOrderItemId && lockedMenuItem.currentOrderItemId !== orderItemId)) {
      return {
        alreadyProcessed: true,
        actualMinutes: 0,
        calculatedCharge: 0,
        breakdown: null,
        overtimeBreakdown: null,
        updatedMenuItem: null,
      }
    }
  }

  // Calculate actual minutes used
  const startedAt = lockedRow?.blockTimeStartedAt
  const actualMinutes = startedAt
    ? Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
    : 0

  // Calculate the charge based on actual usage and reason
  let calculatedCharge: number
  let breakdown: ChargeBreakdown | null = null
  let overtimeBreakdown: { overtimeMinutes: number; overtimeCharge: number } | null = null

  if (reason === 'comp' || reason === 'void') {
    calculatedCharge = 0
  } else {
    const result = calculateStopCharge(
      actualMinutes,
      lockedRow?.blockTimeMinutes,
      menuItem,
      startedAt || null,
      now
    )
    calculatedCharge = result.charge
    breakdown = result.breakdown
    overtimeBreakdown = result.overtimeBreakdown
  }

  // Build order item update data based on reason
  const orderItemData: Record<string, unknown> = {
    blockTimeStartedAt: null,
    blockTimeExpiresAt: now,
    price: calculatedCharge,
    itemTotal: calculatedCharge,
  }

  if (reason === 'comp') {
    orderItemData.status = 'comped'
    orderItemData.voidReason = 'Entertainment session comped by manager'
  } else if (reason === 'void') {
    orderItemData.status = 'voided'
    orderItemData.voidReason = 'Entertainment session voided by manager'
  }

  // Update the order item
  await tx.orderItem.update({
    where: { id: orderItemId },
    data: orderItemData,
  })

  // Reset the menu item status
  const updatedMenuItem = await tx.menuItem.update({
    where: { id: menuItemId },
    data: {
      entertainmentStatus: 'available',
      currentOrderId: null,
      currentOrderItemId: null,
    },
    select: {
      id: true,
      name: true,
      entertainmentStatus: true,
      currentOrderId: true,
      currentOrderItemId: true,
    },
  })

  // Reset floor plan element
  await tx.floorPlanElement.updateMany({
    where: {
      linkedMenuItemId: menuItemId,
      deletedAt: null,
    },
    data: {
      status: 'available',
      currentOrderId: null,
      sessionStartedAt: null,
      sessionExpiresAt: null,
    },
  })

  return {
    alreadyProcessed: false,
    actualMinutes,
    calculatedCharge,
    breakdown,
    overtimeBreakdown,
    updatedMenuItem,
  }
}

// ─── Extend Session ──────────────────────────────────────────────────────────

/**
 * Extend a block-time session inside a transaction.
 * Locks the OrderItem row with FOR UPDATE to prevent concurrent extends.
 */
export async function extendSession(
  tx: TxClient,
  input: {
    orderItemId: string
    menuItemId: string
    additionalMinutes: number
    menuItem: MenuItemPricingFields
  }
): Promise<ExtendSessionResult | { error: string }> {
  const { orderItemId, menuItemId, additionalMinutes, menuItem } = input

  // Lock the OrderItem row to prevent concurrent extends
  const [lockedRow] = await tx.$queryRaw<Array<{
    blockTimeExpiresAt: Date | null
    blockTimeMinutes: number | null
    price: unknown
  }>>`
    SELECT "blockTimeExpiresAt", "blockTimeMinutes", "price"
    FROM "OrderItem"
    WHERE "id" = ${orderItemId}
    FOR UPDATE
  `

  if (!lockedRow?.blockTimeExpiresAt) {
    return { error: 'This item does not have active block time' }
  }

  const now = new Date()
  const currentExpires = new Date(lockedRow.blockTimeExpiresAt)
  const oldMinutes = lockedRow.blockTimeMinutes || 0
  const oldPrice = Number(lockedRow.price || 0)

  // If already expired, extend from now; otherwise extend from current expiration
  const baseTime = currentExpires > now ? currentExpires : now
  const newExpiresAt = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000)
  const newTotalMinutes = oldMinutes + additionalMinutes

  // Calculate incremental charge
  const additionalCharge = calculateExtensionCharge(oldMinutes, additionalMinutes, menuItem)
  const newPrice = oldPrice + additionalCharge

  // Update the order item with new duration and incremental price
  const updatedItem = await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      blockTimeMinutes: newTotalMinutes,
      blockTimeExpiresAt: newExpiresAt,
      price: newPrice,
      itemTotal: newPrice,
    },
    select: {
      id: true,
      name: true,
      blockTimeMinutes: true,
      blockTimeStartedAt: true,
      blockTimeExpiresAt: true,
    },
  })

  // Update FloorPlanElement expiration to match
  await tx.floorPlanElement.updateMany({
    where: { linkedMenuItemId: menuItemId, deletedAt: null },
    data: { sessionExpiresAt: newExpiresAt },
  })

  return { updatedItem, newExpiresAt, newTotalMinutes, newPrice }
}

// ─── Time Override ───────────────────────────────────────────────────────────

/**
 * Override session time inside a transaction.
 * Manager sets an exact new expiration time.
 */
export async function overrideSessionTime(
  tx: TxClient,
  input: {
    orderItemId: string
    menuItemId: string
    parsedExpiresAt: Date
    startedAt: Date
    newPrice: number
  }
): Promise<{
  id: string
  name: string | null
  blockTimeMinutes: number | null
  blockTimeStartedAt: Date | null
  blockTimeExpiresAt: Date | null
  menuItemId: string | null
}> {
  const { orderItemId, menuItemId, parsedExpiresAt, startedAt, newPrice } = input
  const newDurationMinutes = Math.max(1, Math.ceil((parsedExpiresAt.getTime() - startedAt.getTime()) / 1000 / 60))

  const updatedItem = await tx.orderItem.update({
    where: { id: orderItemId },
    data: {
      blockTimeMinutes: newDurationMinutes,
      blockTimeExpiresAt: parsedExpiresAt,
      price: newPrice,
      itemTotal: newPrice,
    },
    select: {
      id: true,
      name: true,
      blockTimeMinutes: true,
      blockTimeStartedAt: true,
      blockTimeExpiresAt: true,
      menuItemId: true,
    },
  })

  // Update FloorPlanElement expiration
  await tx.floorPlanElement.updateMany({
    where: { linkedMenuItemId: menuItemId, deletedAt: null },
    data: { sessionExpiresAt: parsedExpiresAt },
  })

  return updatedItem
}

// ─── Expire Single Session (Cron) ────────────────────────────────────────────

/**
 * Expire a single session that has passed its block time.
 * Used by the entertainment-expiry cron job.
 * Returns { skipped: true } if the session was already handled.
 */
export async function expireSession(
  tx: TxClient,
  item: {
    id: string
    menuItemId: string
    orderStatus: string
    menuItemPrice: unknown
    menuItemRatePerMinute: unknown
    menuItemMinimumCharge: unknown
    menuItemIncrementMinutes: number | null
    menuItemGraceMinutes: number | null
    menuItemTimedPricing: unknown
    menuItemHappyHourEnabled: boolean | null
    menuItemHappyHourDiscount: number | null
    menuItemHappyHourStart: string | null
    menuItemHappyHourEnd: string | null
    menuItemHappyHourDays: unknown
    menuItemOvertimeEnabled: boolean | null
    menuItemOvertimeMode: string | null
    menuItemOvertimeMultiplier: unknown
    menuItemOvertimePerMinuteRate: unknown
    menuItemOvertimeFlatFee: unknown
    menuItemOvertimeGraceMinutes: number | null
  },
  now: Date
): Promise<{ skipped: true } | { skipped: false; closedOrder: boolean; newPrice: number }> {
  // Lock the OrderItem row to prevent concurrent modification by manual stop
  const [lockedItem] = await tx.$queryRaw<Array<{
    blockTimeStartedAt: Date | null
    blockTimeExpiresAt: Date | null
    blockTimeMinutes: number | null
  }>>`
    SELECT "blockTimeStartedAt", "blockTimeExpiresAt", "blockTimeMinutes"
    FROM "OrderItem"
    WHERE "id" = ${item.id}
    FOR UPDATE
  `

  // If already stopped (manual stop won the race), skip silently
  if (!lockedItem?.blockTimeStartedAt) {
    return { skipped: true }
  }

  // Also lock and check MenuItem
  const [lockedMenuItem] = await tx.$queryRaw<Array<{
    entertainmentStatus: string | null
  }>>`
    SELECT "entertainmentStatus" FROM "MenuItem"
    WHERE "id" = ${item.menuItemId}
    FOR UPDATE
  `

  if (lockedMenuItem?.entertainmentStatus !== 'in_use') {
    return { skipped: true }
  }

  // Skip items on already-paid/closed orders — but still reset MenuItem/FloorPlan
  if (['paid', 'closed', 'voided', 'cancelled'].includes(item.orderStatus)) {
    await tx.menuItem.update({
      where: { id: item.menuItemId },
      data: {
        entertainmentStatus: 'available',
        currentOrderId: null,
        currentOrderItemId: null,
      },
    })

    await tx.floorPlanElement.updateMany({
      where: { linkedMenuItemId: item.menuItemId, status: 'in_use' },
      data: {
        status: 'available',
        currentOrderId: null,
        sessionStartedAt: null,
        sessionExpiresAt: null,
      },
    })

    return { skipped: false, closedOrder: true, newPrice: 0 }
  }

  // Calculate elapsed minutes
  const startedAt = lockedItem.blockTimeStartedAt!
  const elapsedMs = now.getTime() - startedAt.getTime()
  const elapsedMinutes = Math.ceil(elapsedMs / (1000 * 60))

  // Calculate charge using pricing engine
  const bookedMinutes = lockedItem.blockTimeMinutes || undefined
  const newPrice = calculateExpiryCharge(
    elapsedMinutes,
    bookedMinutes,
    {
      price: item.menuItemPrice,
      ratePerMinute: item.menuItemRatePerMinute,
      minimumCharge: item.menuItemMinimumCharge,
      incrementMinutes: item.menuItemIncrementMinutes,
      graceMinutes: item.menuItemGraceMinutes,
      timedPricing: item.menuItemTimedPricing,
      happyHourEnabled: item.menuItemHappyHourEnabled,
      happyHourDiscount: item.menuItemHappyHourDiscount,
      happyHourStart: item.menuItemHappyHourStart,
      happyHourEnd: item.menuItemHappyHourEnd,
      happyHourDays: item.menuItemHappyHourDays,
      overtimeEnabled: item.menuItemOvertimeEnabled,
      overtimeMode: item.menuItemOvertimeMode,
      overtimeMultiplier: item.menuItemOvertimeMultiplier,
      overtimePerMinuteRate: item.menuItemOvertimePerMinuteRate,
      overtimeFlatFee: item.menuItemOvertimeFlatFee,
      overtimeGraceMinutes: item.menuItemOvertimeGraceMinutes,
    },
    startedAt
  )

  // Update OrderItem price and clear startedAt
  await tx.orderItem.update({
    where: { id: item.id },
    data: {
      blockTimeStartedAt: null,
      price: newPrice,
      itemTotal: newPrice,
    },
  })

  // Reset MenuItem to available
  await tx.menuItem.update({
    where: { id: item.menuItemId },
    data: {
      entertainmentStatus: 'available',
      currentOrderId: null,
      currentOrderItemId: null,
    },
  })

  // Reset linked FloorPlanElements
  await tx.floorPlanElement.updateMany({
    where: { linkedMenuItemId: item.menuItemId, status: 'in_use' },
    data: {
      status: 'available',
      currentOrderId: null,
      sessionStartedAt: null,
      sessionExpiresAt: null,
    },
  })

  return { skipped: false, closedOrder: false, newPrice }
}

// ─── Cleanup Orphan Sessions ─────────────────────────────────────────────────
/**
 * Clean up orphaned entertainment sessions where MenuItem.entertainmentStatus === 'in_use'
 * but MenuItem.currentOrderId points to a CLOSED or DELETED order.
 * These are orphans from tab closes that didn't properly call stopSession().
 *
 * Returns the count of orphaned sessions cleaned up.
 */
export async function cleanupOrphanSessions(
  tx: TxClient,
  input: {
    locationId: string
    now: Date
    closedOrderStatuses: string[]
  }
): Promise<{ cleanedCount: number; details: Array<{ menuItemId: string; itemName: string; orderId: string; reason: string }> }> {
  const { locationId, now, closedOrderStatuses } = input

  // Find MenuItem entries where:
  // 1. entertainmentStatus === 'in_use'
  // 2. currentOrderId points to an order with closed status
  const orphanedItems = await tx.$queryRaw<Array<{
    id: string
    name: string
    currentOrderId: string | null
    currentOrderItemId: string | null
    orderStatus: string
  }>>`
    SELECT
      m."id",
      m."name",
      m."currentOrderId",
      m."currentOrderItemId",
      o."status" as "orderStatus"
    FROM "MenuItem" m
    LEFT JOIN "Order" o ON m."currentOrderId" = o."id"
    WHERE m."locationId" = ${locationId}
      AND m."entertainmentStatus" = 'in_use'
      AND m."currentOrderId" IS NOT NULL
      AND (
        o."status" IN (${closedOrderStatuses.join(',')})
        OR o."id" IS NULL
      )
  `

  const cleanedDetails: Array<{ menuItemId: string; itemName: string; orderId: string; reason: string }> = []

  for (const orphan of orphanedItems) {
    try {
      // Reset the MenuItem
      await tx.menuItem.update({
        where: { id: orphan.id },
        data: {
          entertainmentStatus: 'available',
          currentOrderId: null,
          currentOrderItemId: null,
        },
      })

      // Reset associated OrderItem if it exists
      if (orphan.currentOrderItemId) {
        await tx.orderItem.update({
          where: { id: orphan.currentOrderItemId },
          data: {
            blockTimeStartedAt: null,
          },
        })
      }

      // Reset FloorPlanElements
      await tx.floorPlanElement.updateMany({
        where: {
          linkedMenuItemId: orphan.id,
          deletedAt: null,
          status: 'in_use',
        },
        data: {
          status: 'available',
          currentOrderId: null,
          sessionStartedAt: null,
          sessionExpiresAt: null,
        },
      })

      cleanedDetails.push({
        menuItemId: orphan.id,
        itemName: orphan.name || 'Unknown',
        orderId: orphan.currentOrderId || 'unknown',
        reason: orphan.orderStatus ? `order_status_${orphan.orderStatus}` : 'order_not_found',
      })
    } catch (err) {
      console.error(`[entertainment] Failed to cleanup orphan session for MenuItem ${orphan.id}:`, err)
    }
  }

  return { cleanedCount: orphanedItems.length, details: cleanedDetails }
}

// ─── Detect Stale Sessions ───────────────────────────────────────────────────
/**
 * Find sessions that have been running for more than 24 hours.
 * These are likely abandoned (e.g., customer never explicitly stopped the session).
 *
 * Returns items that should be auto-expired.
 */
export async function findStaleSessions(
  tx: TxClient,
  input: {
    locationId: string
    now: Date
    maxSessionAgeMs?: number // default: 24 hours
  }
): Promise<Array<{ orderItemId: string; menuItemId: string; startedAtAge: number }>> {
  const { locationId, now, maxSessionAgeMs = 24 * 60 * 60 * 1000 } = input

  const staleItems = await tx.$queryRaw<Array<{
    id: string
    menuItemId: string
    blockTimeStartedAt: Date
  }>>`
    SELECT
      oi."id",
      oi."menuItemId",
      oi."blockTimeStartedAt"
    FROM "OrderItem" oi
    JOIN "MenuItem" mi ON oi."menuItemId" = mi."id"
    WHERE mi."locationId" = ${locationId}
      AND mi."entertainmentStatus" = 'in_use'
      AND oi."blockTimeStartedAt" IS NOT NULL
      AND (NOW() - oi."blockTimeStartedAt")::text::interval > CAST(${Math.floor(maxSessionAgeMs / 1000)} || ' seconds' AS interval)
  `

  return staleItems.map(item => ({
    orderItemId: item.id,
    menuItemId: item.menuItemId,
    startedAtAge: now.getTime() - new Date(item.blockTimeStartedAt).getTime(),
  }))
}

// ─── Stop All Sessions ───────────────────────────────────────────────────────

/**
 * Stop all active entertainment sessions at a location in a single transaction.
 * Used by the "force stop all" closing-time feature.
 */
export async function stopAllSessions(
  tx: TxClient,
  input: {
    locationId: string
    now: Date
    activeMenuItems: Array<{
      id: string
      name: string
      price: unknown
      timedPricing: unknown
      ratePerMinute: unknown
      minimumCharge: unknown
      incrementMinutes: number | null
      graceMinutes: number | null
      blockTimeMinutes: number | null
      happyHourEnabled: boolean | null
      happyHourDiscount: number | null
      happyHourStart: string | null
      happyHourEnd: string | null
      happyHourDays: unknown
      overtimeEnabled: boolean | null
      overtimeMode: string | null
      overtimeMultiplier: unknown
      overtimePerMinuteRate: unknown
      overtimeFlatFee: unknown
      overtimeGraceMinutes: number | null
      currentOrderItemId: string | null
    }>
    orderItemMap: Map<string, {
      id: string
      blockTimeStartedAt: Date | null
      blockTimeMinutes: number | null
      order: { id: string; locationId: string }
    }>
  }
): Promise<{ results: StopAllSessionResult[]; waitlistCancelled: number }> {
  const { locationId, now, activeMenuItems, orderItemMap } = input
  const results: StopAllSessionResult[] = []

  for (const mi of activeMenuItems) {
    const oi = orderItemMap.get(mi.currentOrderItemId!)
    if (!oi) continue

    // Calculate actual minutes used
    const startedAt = oi.blockTimeStartedAt
    const actualMinutes = startedAt
      ? Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
      : 0

    // Calculate charge
    const { charge: calculatedCharge } = calculateStopCharge(
      actualMinutes,
      oi.blockTimeMinutes,
      {
        id: mi.id,
        name: mi.name,
        price: mi.price,
        timedPricing: mi.timedPricing,
        ratePerMinute: mi.ratePerMinute,
        minimumCharge: mi.minimumCharge,
        incrementMinutes: mi.incrementMinutes,
        graceMinutes: mi.graceMinutes,
        blockTimeMinutes: mi.blockTimeMinutes,
        happyHourEnabled: mi.happyHourEnabled,
        happyHourDiscount: mi.happyHourDiscount,
        happyHourStart: mi.happyHourStart,
        happyHourEnd: mi.happyHourEnd,
        happyHourDays: mi.happyHourDays,
        overtimeEnabled: mi.overtimeEnabled,
        overtimeMode: mi.overtimeMode,
        overtimeMultiplier: mi.overtimeMultiplier,
        overtimePerMinuteRate: mi.overtimePerMinuteRate,
        overtimeFlatFee: mi.overtimeFlatFee,
        overtimeGraceMinutes: mi.overtimeGraceMinutes,
        prepaidPackages: null,
      },
      startedAt,
      now
    )

    // Update order item
    await tx.orderItem.update({
      where: { id: oi.id },
      data: {
        blockTimeStartedAt: null,
        blockTimeExpiresAt: now,
        price: calculatedCharge,
        itemTotal: calculatedCharge,
      },
    })

    // Reset menu item status
    await tx.menuItem.update({
      where: { id: mi.id },
      data: {
        entertainmentStatus: 'available',
        currentOrderId: null,
        currentOrderItemId: null,
      },
    })

    results.push({
      orderItemId: oi.id,
      menuItemId: mi.id,
      menuItemName: mi.name,
      orderId: oi.order.id,
      actualMinutes,
      charge: calculatedCharge,
    })
  }

  // Reset all floor plan elements for entertainment items at this location to available
  const menuItemIds = activeMenuItems.map(mi => mi.id)
  await tx.floorPlanElement.updateMany({
    where: {
      linkedMenuItemId: { in: menuItemIds },
      deletedAt: null,
    },
    data: {
      status: 'available',
      currentOrderId: null,
      sessionStartedAt: null,
      sessionExpiresAt: null,
    },
  })

  // Cancel all active waitlist entries for this location
  const cancelledWaitlist = await tx.entertainmentWaitlist.updateMany({
    where: {
      locationId,
      deletedAt: null,
      status: { in: ['waiting', 'notified'] },
    },
    data: {
      status: 'cancelled',
      deletedAt: now,
    },
  })

  return { results, waitlistCancelled: cancelledWaitlist.count }
}

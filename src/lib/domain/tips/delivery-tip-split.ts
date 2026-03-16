/**
 * Delivery Tip Split — Kitchen Tip-Out
 *
 * Triggered by advanceDeliveryStatus when status -> 'delivered'.
 *
 * Modes:
 * - driver_keeps_100: no split (default)
 * - pool_with_kitchen: split per driverTipSplitPercent / kitchenTipSplitPercent
 * - custom_split: same as pool_with_kitchen but with custom percentages
 *
 * Kitchen share is distributed proportionally by Role.tipWeight for
 * clocked-in BOH employees with isTipped = true.
 *
 * Idempotency key: delivery-tipout:{orderId}:{driverEmployeeId}
 *
 * This is DEFERRED until delivery is marked 'delivered' (not at payment time)
 * because the driver keeps 100% until the delivery is confirmed, and the
 * venue may not want to split tips on failed/returned deliveries.
 */

import { db } from '@/lib/db'
import { postToTipLedger } from '@/lib/domain/tips/tip-ledger'
import type { TxClient } from '@/lib/domain/tips/tip-ledger'
import { writeDeliveryAuditLog } from '@/lib/delivery/state-machine'

// ── Types ───────────────────────────────────────────────────────────────────

export type DeliveryTipMode = 'driver_keeps_100' | 'pool_with_kitchen' | 'custom_split'

export interface DeliveryTipSplitParams {
  locationId: string
  orderId: string
  deliveryOrderId: string
  driverEmployeeId: string
  driverTipMode: DeliveryTipMode
  /** Percent of total tip the driver keeps (e.g. 80 means 80%) */
  driverTipSplitPercent: number
  /** Percent of total tip that goes to kitchen (e.g. 20 means 20%) */
  kitchenTipSplitPercent: number
  /** Employee who triggered the delivery completion */
  actorEmployeeId: string
}

export interface DeliveryTipSplitResult {
  processed: boolean
  driverKeptCents: number
  kitchenShareCents: number
  kitchenRecipients: Array<{
    employeeId: string
    amountCents: number
  }>
}

// ── Main function ───────────────────────────────────────────────────────────

/**
 * Process delivery tip split on delivery completion.
 *
 * If driverTipMode is 'driver_keeps_100', returns immediately (no-op).
 * Otherwise, debits the kitchen share from the driver and distributes
 * it to clocked-in BOH employees proportionally by Role.tipWeight.
 *
 * If no eligible BOH employees are clocked in, the driver keeps 100%.
 */
export async function processDeliveryTipSplit(
  params: DeliveryTipSplitParams,
): Promise<DeliveryTipSplitResult> {
  const {
    locationId,
    orderId,
    deliveryOrderId,
    driverEmployeeId,
    driverTipMode,
    driverTipSplitPercent,
    kitchenTipSplitPercent,
    actorEmployeeId,
  } = params

  const noopResult: DeliveryTipSplitResult = {
    processed: false,
    driverKeptCents: 0,
    kitchenShareCents: 0,
    kitchenRecipients: [],
  }

  // Mode check: if driver keeps 100%, nothing to do
  if (driverTipMode === 'driver_keeps_100') {
    return noopResult
  }

  const idempotencyKey = `delivery-tipout:${orderId}:${driverEmployeeId}`

  try {
    // Idempotency check via DeliveryAuditLog
    const existing = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "DeliveryAuditLog"
       WHERE "idempotencyKey" = $1 LIMIT 1`,
      idempotencyKey,
    )
    if (existing.length) {
      return noopResult // Already processed
    }

    // Validate percentages
    if (kitchenTipSplitPercent <= 0 || kitchenTipSplitPercent > 100) {
      console.warn(
        `[delivery-tip-split] Invalid kitchenTipSplitPercent: ${kitchenTipSplitPercent}. Skipping.`,
      )
      return noopResult
    }

    // 1. Find total tip credited to driver for this order
    //    Include both DIRECT_TIP (assigned at payment) and DELIVERY_REALLOCATION (moved from holding)
    const tipResult = await db.tipLedgerEntry.aggregate({
      where: {
        employeeId: driverEmployeeId,
        orderId,
        locationId,
        type: 'CREDIT',
        sourceType: { in: ['DIRECT_TIP', 'DELIVERY_REALLOCATION'] },
        deletedAt: null,
      },
      _sum: { amountCents: true },
    })

    const totalTipCents = Math.abs(Number(tipResult._sum.amountCents || 0))
    if (totalTipCents <= 0) {
      return noopResult // No tips to split
    }

    // 2. Calculate kitchen share
    const kitchenShareCents = Math.round(totalTipCents * kitchenTipSplitPercent / 100)
    if (kitchenShareCents <= 0) {
      return noopResult
    }

    const driverKeptCents = totalTipCents - kitchenShareCents

    // 3. Find clocked-in BOH employees with isTipped = true
    //    BOH = employees whose Role has isTipped = true AND who are currently clocked in
    //    We use Role.tipWeight for proportional distribution
    const bohEmployees = await db.$queryRawUnsafe<
      { employeeId: string; tipWeight: string }[]
    >(
      `SELECT DISTINCT tc."employeeId", r."tipWeight"
       FROM "TimeClockEntry" tc
       JOIN "Employee" e ON e."id" = tc."employeeId" AND e."deletedAt" IS NULL
       JOIN "Role" r ON r."id" = e."roleId" AND r."deletedAt" IS NULL
       WHERE tc."locationId" = $1
         AND tc."clockOutTime" IS NULL
         AND tc."deletedAt" IS NULL
         AND r."isTipped" = true
         AND r."tipWeight" > 0
         AND tc."employeeId" != $2`,
      locationId,
      driverEmployeeId,
    )

    if (!bohEmployees.length) {
      // No eligible BOH employees clocked in — driver keeps 100%
      return {
        processed: false,
        driverKeptCents: totalTipCents,
        kitchenShareCents: 0,
        kitchenRecipients: [],
      }
    }

    // 4. Calculate proportional shares by tipWeight
    const totalWeight = bohEmployees.reduce(
      (sum, e) => sum + Number(e.tipWeight),
      0,
    )

    if (totalWeight <= 0) {
      return noopResult
    }

    // Sort by employeeId for deterministic penny allocation
    const sortedBoh = [...bohEmployees].sort((a, b) =>
      a.employeeId.localeCompare(b.employeeId),
    )

    const shares: Array<{ employeeId: string; amountCents: number }> = []
    let allocated = 0

    for (let i = 0; i < sortedBoh.length; i++) {
      const emp = sortedBoh[i]
      let share: number

      if (i === sortedBoh.length - 1) {
        // Last employee absorbs rounding remainder
        share = kitchenShareCents - allocated
      } else {
        share = Math.round(
          (kitchenShareCents * Number(emp.tipWeight)) / totalWeight,
        )
      }

      if (share > 0) {
        shares.push({ employeeId: emp.employeeId, amountCents: share })
      }
      allocated += share
    }

    if (!shares.length) {
      return noopResult
    }

    // 5. Transaction: DEBIT driver + CREDIT each BOH employee
    await db.$transaction(async (tx: TxClient) => {
      // DEBIT kitchen share from driver
      await postToTipLedger(
        {
          locationId,
          employeeId: driverEmployeeId,
          amountCents: kitchenShareCents,
          type: 'DEBIT',
          sourceType: 'ROLE_TIPOUT',
          orderId,
          memo: `Delivery kitchen tip-out (${kitchenTipSplitPercent}%) for order ${orderId}`,
          idempotencyKey: `${idempotencyKey}:driver-debit`,
        },
        tx,
      )

      // CREDIT each BOH employee
      for (const share of shares) {
        await postToTipLedger(
          {
            locationId,
            employeeId: share.employeeId,
            amountCents: share.amountCents,
            type: 'CREDIT',
            sourceType: 'ROLE_TIPOUT',
            orderId,
            memo: `Delivery kitchen tip-out received for order ${orderId}`,
            idempotencyKey: `${idempotencyKey}:boh:${share.employeeId}`,
          },
          tx,
        )
      }
    })

    // 6. Write audit log
    await writeDeliveryAuditLog({
      locationId,
      action: 'delivery_tip_split',
      deliveryOrderId,
      employeeId: actorEmployeeId,
      previousValue: {
        driverEmployeeId,
        totalTipCents,
        mode: driverTipMode,
      },
      newValue: {
        driverKeptCents,
        kitchenShareCents,
        kitchenRecipients: shares,
        driverTipSplitPercent,
        kitchenTipSplitPercent,
      },
      idempotencyKey,
    })

    return {
      processed: true,
      driverKeptCents,
      kitchenShareCents,
      kitchenRecipients: shares,
    }
  } catch (error) {
    console.error('[processDeliveryTipSplit] Error:', error)
    // Don't throw — tip split failure should not block delivery completion
    return noopResult
  }
}

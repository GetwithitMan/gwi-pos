/**
 * Delivery Tip Reallocation
 *
 * Handles the tip flow for delivery orders where tips may be collected
 * before a driver is assigned:
 *
 * 1. Payment WITH driver assigned: tip goes directly to driver's TipLedger
 * 2. Payment WITHOUT driver: tip goes to holding ledger (system:delivery_holding:{locationId})
 * 3. On driver assignment: DEBIT from holding, CREDIT to driver
 * 4. On reassignment BEFORE delivery: DEBIT from old driver, CREDIT to new driver
 * 5. On reassignment AFTER delivery: no change (original driver keeps tip)
 *
 * All reallocations logged in DeliveryAuditLog.
 *
 * NOTE: The holding ledger uses a synthetic employee ID. Because TipLedger has a
 * unique constraint on (locationId, employeeId), the holding account is created
 * lazily via getOrCreateLedger — no real Employee row is needed (the FK on
 * TipLedger.employeeId is to Employee, but the holding ledger is never paid
 * out — it should always net to zero). If the FK is enforced at the DB level,
 * a seed row must be created. This will surface as an FK constraint error on
 * first use and is easy to fix with a migration that inserts the system employee.
 */

import { db } from '@/lib/db'
import { postToTipLedger } from '@/lib/domain/tips/tip-ledger'
import type { TxClient } from '@/lib/domain/tips/tip-ledger'
import { createChildLogger } from '@/lib/logger'
import { writeDeliveryAuditLog } from './state-machine'
import { dispatchTipReallocated } from './dispatch-events'

const log = createChildLogger('delivery')

const HOLDING_LEDGER_PREFIX = 'system:delivery_holding:'

// ── Public helpers ──────────────────────────────────────────────────────────

/**
 * Get the synthetic holding-ledger employee ID for a location.
 * This is NOT a real employee — it's a system-level holding account.
 */
export function getHoldingLedgerId(locationId: string): string {
  return `${HOLDING_LEDGER_PREFIX}${locationId}`
}

/**
 * Resolve the tip recipient for a delivery order payment.
 * Called during payment processing (allocateTipsForPayment).
 *
 * @returns employeeId to credit (either driver or holding ledger) and
 *          whether the tip is pending driver assignment.
 */
export async function resolveDeliveryTipRecipient(
  locationId: string,
  deliveryOrderId: string,
): Promise<{ recipientId: string; isPending: boolean }> {
  // Check if delivery order has an assigned driver.
  // DeliveryOrder.driverId stores the employeeId directly.
  const orders = await db.$queryRawUnsafe<{ driverId: string | null }[]>(
    `SELECT "driverId" FROM "DeliveryOrder"
     WHERE "id" = $1 AND "locationId" = $2
     LIMIT 1`,
    deliveryOrderId,
    locationId,
  )

  if (orders.length && orders[0].driverId) {
    // Driver assigned — tip goes directly to driver
    return { recipientId: orders[0].driverId, isPending: false }
  }

  // No driver yet — tip goes to holding ledger
  return { recipientId: getHoldingLedgerId(locationId), isPending: true }
}

/**
 * Reallocate tip from holding ledger to driver on first assignment.
 * Called when advanceDeliveryStatus transitions to 'assigned'.
 *
 * Idempotency key: delivery-realloc:{deliveryOrderId}:{driverEmployeeId}
 */
export async function reallocateTipToDriver(
  locationId: string,
  deliveryOrderId: string,
  orderId: string,
  driverEmployeeId: string,
  actorEmployeeId: string,
): Promise<void> {
  const idempotencyKey = `delivery-realloc:${deliveryOrderId}:${driverEmployeeId}`
  const holdingId = getHoldingLedgerId(locationId)

  try {
    // Idempotency check — use DeliveryAuditLog unique partial index
    const existing = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "DeliveryAuditLog"
       WHERE "idempotencyKey" = $1 LIMIT 1`,
      idempotencyKey,
    )
    if (existing.length) return // Already processed

    // Find tip CREDIT entries for this order in the holding ledger.
    // amountCents is stored as a signed value: CREDITs are positive.
    const holdingCredits = await db.tipLedgerEntry.findMany({
      where: {
        employeeId: holdingId,
        orderId,
        type: 'CREDIT',
        deletedAt: null,
      },
      select: { id: true, amountCents: true },
    })

    if (!holdingCredits.length) return // No tips to reallocate

    const totalCents = holdingCredits.reduce(
      (sum, e) => sum + Math.abs(Number(e.amountCents)),
      0,
    )
    if (totalCents <= 0) return

    // Transaction: DEBIT holding + CREDIT driver
    await db.$transaction(async (tx: TxClient) => {
      // DEBIT from holding ledger
      await postToTipLedger(
        {
          locationId,
          employeeId: holdingId,
          amountCents: totalCents,
          type: 'DEBIT',
          sourceType: 'DELIVERY_REALLOCATION',
          orderId,
          memo: `Delivery tip reallocated to driver for order ${orderId}`,
          idempotencyKey: `${idempotencyKey}:debit`,
        },
        tx,
      )

      // CREDIT to driver
      await postToTipLedger(
        {
          locationId,
          employeeId: driverEmployeeId,
          amountCents: totalCents,
          type: 'CREDIT',
          sourceType: 'DELIVERY_REALLOCATION',
          orderId,
          memo: `Delivery tip received for order ${orderId}`,
          idempotencyKey: `${idempotencyKey}:credit`,
        },
        tx,
      )
    })

    await writeDeliveryAuditLog({
      locationId,
      action: 'tip_reallocation',
      deliveryOrderId,
      employeeId: actorEmployeeId,
      previousValue: { holdingLedger: holdingId, amountCents: totalCents },
      newValue: { driverEmployeeId, amountCents: totalCents },
      idempotencyKey,
    })

    // Fire-and-forget socket event
    void dispatchTipReallocated(locationId, {
      deliveryOrderId,
      orderId,
      fromEmployeeId: holdingId,
      toEmployeeId: driverEmployeeId,
      amountCents: totalCents,
    }).catch(err => log.error({ err }, '[reallocateTipToDriver] dispatchTipReallocated failed'))
  } catch (error) {
    log.error({ err: error }, '[reallocateTipToDriver] Error:')
    // Don't throw — tip reallocation failure should not block dispatch
  }
}

/**
 * Reassign tip from one driver to another (before delivery only).
 * Called during run reassignment.
 *
 * Callers MUST verify the delivery has NOT been completed before calling.
 * If delivery is already 'delivered', the original driver keeps the tip.
 *
 * Idempotency key: delivery-reassign:{deliveryOrderId}:{newDriverEmployeeId}
 */
export async function reassignDriverTip(
  locationId: string,
  deliveryOrderId: string,
  orderId: string,
  oldDriverEmployeeId: string,
  newDriverEmployeeId: string,
  actorEmployeeId: string,
): Promise<void> {
  const idempotencyKey = `delivery-reassign:${deliveryOrderId}:${newDriverEmployeeId}`

  try {
    // Idempotency check
    const existing = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "DeliveryAuditLog"
       WHERE "idempotencyKey" = $1 LIMIT 1`,
      idempotencyKey,
    )
    if (existing.length) return

    // Find tip credits for old driver on this order.
    // Include both DIRECT_TIP (if driver was assigned at payment time) and
    // DELIVERY_REALLOCATION (if tip was moved from holding).
    const result = await db.tipLedgerEntry.aggregate({
      where: {
        employeeId: oldDriverEmployeeId,
        orderId,
        locationId,
        type: 'CREDIT',
        sourceType: { in: ['DIRECT_TIP', 'DELIVERY_REALLOCATION'] },
        deletedAt: null,
      },
      _sum: { amountCents: true },
    })

    const totalCents = Math.abs(Number(result._sum.amountCents || 0))
    if (totalCents <= 0) return

    // Transaction: DEBIT old driver + CREDIT new driver
    await db.$transaction(async (tx: TxClient) => {
      await postToTipLedger(
        {
          locationId,
          employeeId: oldDriverEmployeeId,
          amountCents: totalCents,
          type: 'DEBIT',
          sourceType: 'DELIVERY_REALLOCATION',
          orderId,
          memo: `Delivery tip reassigned to new driver for order ${orderId}`,
          idempotencyKey: `${idempotencyKey}:debit`,
        },
        tx,
      )

      await postToTipLedger(
        {
          locationId,
          employeeId: newDriverEmployeeId,
          amountCents: totalCents,
          type: 'CREDIT',
          sourceType: 'DELIVERY_REALLOCATION',
          orderId,
          memo: `Delivery tip received (reassignment) for order ${orderId}`,
          idempotencyKey: `${idempotencyKey}:credit`,
        },
        tx,
      )
    })

    await writeDeliveryAuditLog({
      locationId,
      action: 'tip_reallocation',
      deliveryOrderId,
      employeeId: actorEmployeeId,
      previousValue: { driverEmployeeId: oldDriverEmployeeId, amountCents: totalCents },
      newValue: { driverEmployeeId: newDriverEmployeeId, amountCents: totalCents },
      idempotencyKey,
    })

    // Fire-and-forget socket event
    void dispatchTipReallocated(locationId, {
      deliveryOrderId,
      orderId,
      fromEmployeeId: oldDriverEmployeeId,
      toEmployeeId: newDriverEmployeeId,
      amountCents: totalCents,
    }).catch(err => log.error({ err }, '[reassignDriverTip] dispatchTipReallocated failed'))
  } catch (error) {
    log.error({ err: error }, '[reassignDriverTip] Error:')
    // Don't throw — tip reassignment failure should not block dispatch
  }
}

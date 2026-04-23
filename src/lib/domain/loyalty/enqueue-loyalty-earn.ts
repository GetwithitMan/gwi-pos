/**
 * Enqueue a loyalty earn row inside the payment commit transaction.
 *
 * Usage: called from inside `db.$transaction(async (tx) => {...})` of
 * pay / close-tab / pay-all-splits AFTER the payment row has been written
 * but BEFORE the transaction commits. This guarantees the outbox enqueue
 * is atomic with the payment — if the payment rolls back, so does the earn.
 *
 * Idempotency:
 *   - `PendingLoyaltyEarn.orderId` is unique. Second enqueue returns silently.
 *   - Even if a second enqueue slips through, the worker's unique-index
 *     backstop on LoyaltyTransaction ensures at most one persisted earn.
 *
 * Tickets T2 + T3 + T4 of the Loyalty Rewards Cleanup workstream.
 */

import type { Prisma } from '@/generated/prisma/client'

export interface EnqueueLoyaltyEarnParams {
  tx: Prisma.TransactionClient
  locationId: string
  orderId: string
  customerId: string
  pointsEarned: number
  loyaltyEarningBase: number
  tierMultiplier: number
  employeeId?: string | null
  orderNumber?: number | null
}

export interface EnqueueLoyaltyEarnResult {
  enqueued: boolean
  /** True if a row already existed for this orderId — no-op path. */
  alreadyQueued?: boolean
}

/**
 * Enqueue a single PendingLoyaltyEarn row. Safe to call from any terminal
 * route in the payment commit chain; subsequent calls for the same orderId
 * are no-ops (ON CONFLICT DO NOTHING on the unique orderId).
 */
export async function enqueueLoyaltyEarn(
  params: EnqueueLoyaltyEarnParams,
): Promise<EnqueueLoyaltyEarnResult> {
  const {
    tx,
    locationId,
    orderId,
    customerId,
    pointsEarned,
    loyaltyEarningBase,
    tierMultiplier,
    employeeId,
    orderNumber,
  } = params

  if (pointsEarned <= 0) {
    // Nothing to earn — no outbox row needed.
    return { enqueued: false }
  }

  // ON CONFLICT on the unique orderId constraint is the hot path for the
  // second writer (e.g. close-tab running after pay). The worker's own
  // idempotency + the partial unique index on LoyaltyTransaction are the
  // deeper defenses; this just avoids an exception in the normal case.
  const result = await tx.$executeRaw`
    INSERT INTO "PendingLoyaltyEarn" (
      "id", "locationId", "orderId", "customerId", "pointsEarned",
      "loyaltyEarningBase", "tierMultiplier", "employeeId", "orderNumber",
      "status", "attempts", "maxAttempts", "availableAt", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text, ${locationId}, ${orderId}, ${customerId}, ${pointsEarned},
      ${loyaltyEarningBase}, ${tierMultiplier}, ${employeeId ?? null}, ${orderNumber ?? null},
      'pending', 0, 5, NOW(), NOW(), NOW()
    )
    ON CONFLICT ("orderId") DO NOTHING
  `
  // $executeRaw returns the affected row count.
  const rowsInserted = typeof result === 'number' ? result : Number(result ?? 0)
  return { enqueued: rowsInserted > 0, alreadyQueued: rowsInserted === 0 }
}

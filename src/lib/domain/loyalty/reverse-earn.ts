/**
 * Loyalty Earn Reversal (T7 — Loyalty Cleanup)
 *
 * Canonical helper for reversing loyalty earn transactions when a payment is
 * voided or refunded. A refund or void reverses exactly one earn event.
 *
 * Contract (also in `docs/features/refund-void.md` → Loyalty Reversal):
 *
 * 1. Full void of a payment that had an earn:
 *    - Decrement Customer.loyaltyPoints and lifetimePoints by the earned amount
 *    - Insert LoyaltyTransaction { type: 'reversal', points: -N, orderId,
 *      description: 'Reversal of earn from order #X (void)' }
 *    - Demote tier if lifetimePoints falls below the current tier's minimumPoints
 *
 * 2. Full refund: same as void, description reads '(refund)'
 *
 * 3. Partial refund/void: reverse proportionally on
 *    (refundAmount / originalPaymentAmount), rounded with Math.round — the same
 *    rounding that the earn path uses.
 *
 * 4. Idempotency: if a reversal already exists for this (orderId + paymentId +
 *    source), the helper no-ops. The partial unique index
 *    `(orderId) WHERE type='earn'` (added by T4) makes the original earn
 *    lookup unambiguous.
 *
 * 5. Tier demotion: deterministic. After the points decrement we compute the
 *    highest tier whose minimumPoints <= newLifetimePoints; if it differs from
 *    the customer's current tier we update Customer.loyaltyTierId and insert a
 *    second LoyaltyTransaction { type: 'tier_change', points: 0,
 *    description: 'Tier demoted from X to Y (earn reversal)' }. Idempotent —
 *    repeated calls do not re-demote.
 *
 * Used by:
 *   - src/app/api/orders/[id]/void-payment/route.ts
 *   - src/app/api/orders/[id]/refund-payment/route.ts
 *   - src/app/api/orders/[id]/comp-void/route.ts (when the comp/void retroactively
 *     voids a captured payment)
 *
 * `void-tab` does NOT call this helper — it cancels pre-auth card holds that
 * were never captured, so no earn could have occurred.
 */

import crypto from 'crypto'
import { db as defaultDb } from '@/lib/db'

export type ReverseSource = 'void' | 'refund' | 'comp-void'

export interface ReverseEarnParams {
  /** Order whose earn we are reversing. */
  orderId: string
  locationId: string
  /** Identifies this reversal event. For void & refund this is the paymentId.
   *  For comp-void with multiple payment reversals, pass the paymentId too. */
  paymentId: string
  /** Controls wording + classification. 'comp-void' is treated identically to
   *  'void' for full reversal, but emits its own description. */
  source: ReverseSource
  /** For partial refunds, pass the refunded amount. Omit for full void. */
  refundAmount?: number
  /** Original payment amount (the captured amount). Required for partial
   *  refund so we can compute the proportional reversal. For full void this
   *  is still used for Customer.totalSpent decrement. */
  originalPaymentAmount: number
  /** Whether this is a partial reversal (refundAmount < originalPaymentAmount). */
  isPartial: boolean
  /** Who performed the action (manager for void/refund, effective approver for
   *  comp-void). Stored on the reversal LoyaltyTransaction. May be null. */
  employeeId?: string | null
  /** Optional DB client/tx — defaults to the shared `db` instance. */
  dbClient?: typeof defaultDb
}

export interface ReverseEarnResult {
  reversed: boolean
  pointsReversed: number
  customerId?: string
  /** True if this call was a no-op because a reversal already existed. */
  alreadyReversed?: boolean
  tierDemoted?: { from: string | null; to: string | null }
}

/**
 * Build the description string for the reversal LoyaltyTransaction.
 * Format: "Reversal of earn from order #<orderNumber> (<source>)"
 */
function buildDescription(
  orderNumber: number | string | null | undefined,
  source: ReverseSource,
  isPartial: boolean,
  pointsReversed: number,
  refundAmount?: number,
): string {
  const sourceLabel =
    source === 'comp-void' ? 'comp-void' : source === 'refund' ? 'refund' : 'void'
  const orderTag = orderNumber != null ? `#${orderNumber}` : '(unknown)'
  if (isPartial && refundAmount != null) {
    return `Reversal of earn from order ${orderTag} (${sourceLabel}): ${pointsReversed} points for partial $${refundAmount.toFixed(2)}`
  }
  return `Reversal of earn from order ${orderTag} (${sourceLabel})`
}

/**
 * Reverse the earn for an order, idempotently. See file header for the full
 * contract.
 *
 * Never throws for business-logic misses (no earn, no customer, loyalty
 * disabled, already reversed). Returns a result the caller can log. Callers
 * must already have committed the payment-state change (void/refund) — this
 * helper is a fire-and-forget side effect; see the three routes.
 */
export async function reverseEarnForOrder(
  params: ReverseEarnParams,
): Promise<ReverseEarnResult> {
  const {
    orderId,
    locationId,
    paymentId,
    source,
    refundAmount,
    originalPaymentAmount,
    isPartial,
    employeeId = null,
    dbClient = defaultDb,
  } = params

  // ─── 1. Find the original earn transaction ────────────────────────────────
  // The partial unique index `(orderId) WHERE type='earn'` ensures at most
  // one earn row exists per order.
  const earnRows = await dbClient.$queryRaw<
    Array<{ id: string; points: number; customerId: string }>
  >`SELECT "id", "points", "customerId" FROM "LoyaltyTransaction"
    WHERE "orderId" = ${orderId} AND "type" = 'earn' AND "locationId" = ${locationId}
    LIMIT 1`

  if (earnRows.length === 0) {
    return { reversed: false, pointsReversed: 0 }
  }

  const earn = earnRows[0]
  const earnedPoints = Number(earn.points)
  if (earnedPoints <= 0) {
    return { reversed: false, pointsReversed: 0, customerId: earn.customerId }
  }

  // ─── 2. Compute the number of points to reverse ───────────────────────────
  //
  // Partial: proportional to (refundAmount / originalPaymentAmount),
  // rounded with Math.round — same rounding as the earn path.
  // Full: reverse the entire earn.
  let pointsToReverse: number
  if (isPartial && refundAmount != null && originalPaymentAmount > 0) {
    pointsToReverse = Math.round(earnedPoints * (refundAmount / originalPaymentAmount))
  } else {
    pointsToReverse = earnedPoints
  }

  if (pointsToReverse <= 0) {
    return { reversed: false, pointsReversed: 0, customerId: earn.customerId }
  }

  // ─── 3. Idempotency: skip if a reversal tagged with this paymentId exists ─
  //
  // We match on orderId + paymentId (metadata) + type in ('reversal','adjust').
  // 'adjust' is included so we do not re-reverse on top of legacy adjust rows
  // that older deployments wrote before this helper existed.
  const existingReversals = await dbClient.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "LoyaltyTransaction"
    WHERE "orderId" = ${orderId}
      AND "locationId" = ${locationId}
      AND "type" IN ('reversal', 'adjust')
      AND "points" < 0
      AND ("metadata"->>'paymentId' = ${paymentId} OR "metadata" IS NULL)
    LIMIT 1`

  if (existingReversals.length > 0) {
    return {
      reversed: false,
      alreadyReversed: true,
      pointsReversed: 0,
      customerId: earn.customerId,
    }
  }

  // ─── 4. Read current customer snapshot (points + tier) ────────────────────
  const custRows = await dbClient.$queryRaw<
    Array<{
      id: string
      loyaltyPoints: number
      lifetimePoints: number
      loyaltyTierId: string | null
      loyaltyProgramId: string | null
      orderNumber: number | string | null
    }>
  >`SELECT c."id", c."loyaltyPoints", c."lifetimePoints", c."loyaltyTierId",
           c."loyaltyProgramId", o."orderNumber"
    FROM "Customer" c
    LEFT JOIN "Order" o ON o."id" = ${orderId}
    WHERE c."id" = ${earn.customerId}
    LIMIT 1`

  if (custRows.length === 0) {
    return { reversed: false, pointsReversed: 0, customerId: earn.customerId }
  }

  const cust = custRows[0]
  const beforeLifetime = Number(cust.lifetimePoints)
  const beforeLoyalty = Number(cust.loyaltyPoints)
  const afterLifetime = Math.max(0, beforeLifetime - pointsToReverse)
  const afterLoyalty = Math.max(0, beforeLoyalty - pointsToReverse)

  // ─── 5. Decrement Customer stats ──────────────────────────────────────────
  const spentReduction = isPartial && refundAmount != null ? refundAmount : originalPaymentAmount
  if (isPartial) {
    // Partial: do not decrement totalOrders (order still paid in part)
    await dbClient.$executeRaw`
      UPDATE "Customer" SET
        "loyaltyPoints"  = GREATEST(0, "loyaltyPoints"  - ${pointsToReverse}),
        "lifetimePoints" = GREATEST(0, "lifetimePoints" - ${pointsToReverse}),
        "totalSpent"     = GREATEST(0, "totalSpent"     - ${spentReduction}),
        "updatedAt"      = NOW()
      WHERE "id" = ${earn.customerId}`
  } else {
    await dbClient.$executeRaw`
      UPDATE "Customer" SET
        "loyaltyPoints"  = GREATEST(0, "loyaltyPoints"  - ${pointsToReverse}),
        "lifetimePoints" = GREATEST(0, "lifetimePoints" - ${pointsToReverse}),
        "totalSpent"     = GREATEST(0, "totalSpent"     - ${spentReduction}),
        "totalOrders"    = GREATEST(0, "totalOrders"    - 1),
        "updatedAt"      = NOW()
      WHERE "id" = ${earn.customerId}`
  }

  // ─── 6. Insert the reversal LoyaltyTransaction ────────────────────────────
  const txnId = crypto.randomUUID()
  const negPoints = -pointsToReverse
  const desc = buildDescription(cust.orderNumber, source, isPartial, pointsToReverse, refundAmount)
  const metadata = JSON.stringify({ paymentId, source, isPartial })

  await dbClient.$executeRaw`
    INSERT INTO "LoyaltyTransaction" (
      "id", "customerId", "locationId", "orderId", "type", "points",
      "balanceBefore", "balanceAfter", "description", "employeeId", "metadata", "createdAt"
    ) VALUES (
      ${txnId}, ${earn.customerId}, ${locationId}, ${orderId}, 'reversal',
      ${negPoints}, ${beforeLoyalty}, ${afterLoyalty}, ${desc}, ${employeeId},
      ${metadata}::jsonb, NOW()
    )`

  // ─── 7. Tier demotion (deterministic + idempotent) ────────────────────────
  let tierDemoted: { from: string | null; to: string | null } | undefined
  if (cust.loyaltyProgramId) {
    const tiers = await dbClient.$queryRaw<
      Array<{ id: string; name: string; minimumPoints: number }>
    >`SELECT "id", "name", "minimumPoints" FROM "LoyaltyTier"
      WHERE "programId" = ${cust.loyaltyProgramId} AND "deletedAt" IS NULL
      ORDER BY "minimumPoints" DESC`

    // Find the highest tier whose threshold is still met by afterLifetime.
    let targetTier: { id: string; name: string; minimumPoints: number } | null = null
    for (const t of tiers) {
      if (afterLifetime >= Number(t.minimumPoints)) {
        targetTier = t
        break
      }
    }

    const targetTierId = targetTier?.id ?? null
    const currentTierId = cust.loyaltyTierId

    if (currentTierId !== targetTierId) {
      // Resolve current tier name for the log (best-effort; tier may have been deleted)
      const currentTierName = currentTierId
        ? tiers.find((t) => t.id === currentTierId)?.name ?? null
        : null
      const targetTierName = targetTier?.name ?? null

      await dbClient.$executeRaw`
        UPDATE "Customer" SET "loyaltyTierId" = ${targetTierId}, "updatedAt" = NOW()
        WHERE "id" = ${earn.customerId}`

      const tierTxnId = crypto.randomUUID()
      const tierDesc = `Tier demoted from ${currentTierName ?? '(none)'} to ${targetTierName ?? '(none)'} (earn reversal)`
      const tierMetadata = JSON.stringify({
        reason: 'earn_reversal',
        paymentId,
        previousTierId: currentTierId,
        newTierId: targetTierId,
      })
      await dbClient.$executeRaw`
        INSERT INTO "LoyaltyTransaction" (
          "id", "customerId", "locationId", "orderId", "type", "points",
          "balanceBefore", "balanceAfter", "description", "employeeId", "metadata", "createdAt"
        ) VALUES (
          ${tierTxnId}, ${earn.customerId}, ${locationId}, ${orderId}, 'tier_change',
          0, ${afterLifetime}, ${afterLifetime}, ${tierDesc}, ${employeeId},
          ${tierMetadata}::jsonb, NOW()
        )`

      tierDemoted = { from: currentTierName, to: targetTierName }
    }
  }

  return {
    reversed: true,
    pointsReversed: pointsToReverse,
    customerId: earn.customerId,
    tierDemoted,
  }
}

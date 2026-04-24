/**
 * Record an online-checkout loyalty earn.
 *
 * Thin wrapper around the canonical engine (`computeLoyaltyEarn`) that also:
 *   - Increments `Customer.loyaltyPoints` + `lifetimePoints` atomically
 *   - Writes a `LoyaltyTransaction` row with the same shape used by the POS
 *     commit path (`run-payment-post-commit-effects.ts`):
 *       locationId, orderId, type='earn', points, balanceBefore, balanceAfter,
 *       description, employeeId (nullable), metadata (earn inputs)
 *   - Handles the "LoyaltyTransaction table missing" graceful-fallback case
 *
 * This is the ONLY place online checkout may compute+persist a loyalty earn.
 * Any parallel implementation is prohibited (see T5 in loyalty-cleanup.md).
 */

import crypto from 'crypto'
import type { LoyaltySettings } from '@/lib/settings/types'
import { computeLoyaltyEarn, makePrismaTierLookup, lookupCustomerRoundingMode } from '@/lib/domain/loyalty/compute-earn'

interface OnlineEarnDb {
  customer: {
    findUnique: (args: {
      where: { id: string }
      select: { loyaltyPoints: true; lifetimePoints: true; loyaltyTierId: true }
    }) => Promise<{ loyaltyPoints: number | null; lifetimePoints: number | null; loyaltyTierId: string | null } | null>
    update: (args: {
      where: { id: string }
      data: {
        loyaltyPoints?: { increment: number }
        lifetimePoints?: { increment: number }
        totalOrders?: { increment: number }
        totalSpent?: { increment: number }
        lastVisit?: Date
      }
    }) => Promise<unknown>
  }
  $queryRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
  $executeRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}

export interface RecordOnlineEarnInput {
  db: OnlineEarnDb
  locationId: string
  customerId: string
  orderId: string
  orderNumber?: number | null
  /** Pre-tax, pre-tip item total in dollars. */
  subtotal: number
  /** Grand total (subtotal + tax + fees + delivery + tip) in dollars. */
  total: number
  /** Final tip amount in dollars. */
  tipTotal: number
  loyaltySettings: LoyaltySettings
  /** Online checkout runs with a system employee — pass its id if known. */
  employeeId: string | null
}

export interface RecordOnlineEarnResult {
  /** Points actually credited (>= 0). */
  pointsEarned: number
  /** Engine-reported base used for the calculation. */
  loyaltyEarningBase: number
  /** Tier multiplier applied (1.0 when none). */
  loyaltyTierMultiplier: number
  /** LoyaltyTransaction id if a row was written, else null. */
  transactionId: string | null
}

export async function recordOnlineCustomerLoyaltyEarn(
  input: RecordOnlineEarnInput,
): Promise<RecordOnlineEarnResult> {
  const { db, locationId, customerId, orderId, orderNumber, loyaltySettings, subtotal, total, tipTotal, employeeId } = input

  // Fetch customer's tier id + current balances for balanceBefore/After
  const customer = await db.customer.findUnique({
    where: { id: customerId },
    select: { loyaltyPoints: true, lifetimePoints: true, loyaltyTierId: true },
  })
  if (!customer) {
    return { pointsEarned: 0, loyaltyEarningBase: 0, loyaltyTierMultiplier: 1.0, transactionId: null }
  }

  // Canonical earn computation (same formula as POS commit path).
  // roundingMode is read from the customer's enrolled LoyaltyProgram and
  // defaults to 'floor' (matches schema default + /api/loyalty/earn default).
  const roundingMode = await lookupCustomerRoundingMode(db, customerId)
  const earn = await computeLoyaltyEarn({
    subtotal,
    total,
    tipTotal,
    loyaltySettings,
    customerLoyaltyTierId: customer.loyaltyTierId ?? null,
    lookupTierMultiplier: makePrismaTierLookup(db),
    roundingMode,
  })

  // Always update Customer stats (lastVisit, totalOrders, totalSpent) so an
  // online order always counts toward lifetime stats — matches POS behavior
  // where stats update whenever an order is paid by a linked customer.
  await db.customer.update({
    where: { id: customerId },
    data: {
      ...(earn.pointsEarned > 0
        ? { loyaltyPoints: { increment: earn.pointsEarned }, lifetimePoints: { increment: earn.pointsEarned } }
        : {}),
      totalOrders: { increment: 1 },
      totalSpent: { increment: total },
      lastVisit: new Date(),
    },
  })

  if (earn.pointsEarned <= 0) {
    return {
      pointsEarned: 0,
      loyaltyEarningBase: earn.loyaltyEarningBase,
      loyaltyTierMultiplier: earn.loyaltyTierMultiplier,
      transactionId: null,
    }
  }

  // Write LoyaltyTransaction (same shape as POS commit path writes)
  const txnId = crypto.randomUUID()
  const balanceBefore = Number(customer.loyaltyPoints ?? 0)
  const balanceAfter = balanceBefore + earn.pointsEarned
  const tierSuffix = earn.loyaltyTierMultiplier > 1 ? ` (${earn.loyaltyTierMultiplier}x tier)` : ''
  const description = orderNumber != null
    ? `Earned ${earn.pointsEarned} points on order #${orderNumber}${tierSuffix}`
    : `Earned ${earn.pointsEarned} points on online order${tierSuffix}`

  const metadata = JSON.stringify({
    source: 'online',
    orderAmount: earn.loyaltyEarningBase,
    pointsPerDollar: loyaltySettings.pointsPerDollar,
    tierMultiplier: earn.loyaltyTierMultiplier,
    earnOnSubtotal: loyaltySettings.earnOnSubtotal,
    earnOnTips: loyaltySettings.earnOnTips,
  })

  try {
    await db.$executeRaw`
      INSERT INTO "LoyaltyTransaction" (
        "id", "customerId", "locationId", "orderId", "type", "points",
        "balanceBefore", "balanceAfter", "description", "employeeId",
        "metadata", "createdAt"
      ) VALUES (
        ${txnId}, ${customerId}, ${locationId}, ${orderId}, 'earn', ${earn.pointsEarned},
        ${balanceBefore}, ${balanceAfter},
        ${description},
        ${employeeId || null},
        ${metadata}::jsonb,
        NOW()
      )
    `
  } catch (e: any) {
    // Graceful degradation if LoyaltyTransaction table doesn't exist yet
    // (matches existing behavior in /api/loyalty/earn). The Customer balance
    // was already incremented above, so we don't silently drop the earn.
    if (e?.message?.includes('does not exist') || e?.code === '42P01') {
      return {
        pointsEarned: earn.pointsEarned,
        loyaltyEarningBase: earn.loyaltyEarningBase,
        loyaltyTierMultiplier: earn.loyaltyTierMultiplier,
        transactionId: null,
      }
    }
    throw e
  }

  return {
    pointsEarned: earn.pointsEarned,
    loyaltyEarningBase: earn.loyaltyEarningBase,
    loyaltyTierMultiplier: earn.loyaltyTierMultiplier,
    transactionId: txnId,
  }
}

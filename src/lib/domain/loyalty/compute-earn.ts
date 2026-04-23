/**
 * Canonical Loyalty Earn Engine
 *
 * SINGLE SOURCE OF TRUTH for "how many points does this order earn?"
 *
 * Used by:
 *   - POS commit path (`commit-payment-transaction.ts`)
 *   - Online checkout (`/api/online/checkout`)
 *   - Any other surface that records a loyalty earn
 *
 * Rule: Online checkout calls this canonical loyalty engine module.
 *       No parallel implementation. No flat fallback path in customer-upsert.ts.
 *
 * Behavior preserved from `commit-payment-transaction.ts:213-234`:
 *   - Earn base = subtotal (when `earnOnSubtotal=true`) OR total
 *   - Optionally add tips when `earnOnTips=true`
 *   - Apply LoyaltyTier multiplier if customer has a tier
 *   - Skip earn if base < minimumEarnAmount
 *   - Round per `LoyaltyProgram.roundingMode` (default `floor`)
 *
 * Rounding (resolved 2026-04-23, Q1):
 *   - Config-driven via `LoyaltyProgram.roundingMode` ∈ {'floor','round','ceil'}.
 *   - Default is `'floor'` when no program is configured OR the program omits
 *     the field. This matches the schema default (`prisma/schema.prisma`,
 *     `LoyaltyProgram.roundingMode @default("floor")`) and the existing
 *     `/api/loyalty/earn` route default — venues without an explicit setting
 *     do not change behavior.
 *
 * The `LoyaltyTier` table lookup is delegated via `lookupTierMultiplier` so the
 * caller controls the DB / tx client and graceful-fallback semantics. The POS
 * path uses `outerDb.$queryRaw`; the online path uses `venueDb.$queryRaw`.
 */

import type { LoyaltySettings } from '@/lib/settings/types'
import { toNumber } from '@/lib/pricing'

export type LoyaltyRoundingMode = 'floor' | 'round' | 'ceil'

/** Default rounding mode when no LoyaltyProgram is configured / omits it. */
export const DEFAULT_LOYALTY_ROUNDING_MODE: LoyaltyRoundingMode = 'floor'

/**
 * Resolve a value to a known rounding mode, defaulting to `'floor'` when the
 * input is null/undefined or not one of the three supported values.
 */
export function resolveRoundingMode(value: unknown): LoyaltyRoundingMode {
  if (value === 'floor' || value === 'round' || value === 'ceil') return value
  return DEFAULT_LOYALTY_ROUNDING_MODE
}

/** Apply the configured rounding mode to a fractional point amount. */
export function applyRounding(rawPoints: number, mode: LoyaltyRoundingMode): number {
  switch (mode) {
    case 'ceil':
      return Math.ceil(rawPoints)
    case 'round':
      return Math.round(rawPoints)
    case 'floor':
    default:
      return Math.floor(rawPoints)
  }
}

export interface LoyaltyEarnInput {
  /** Order subtotal (pre-tax, pre-tip) in dollars. */
  subtotal: number | null | undefined
  /** Order grand total in dollars (used when `earnOnSubtotal=false`). */
  total: number | null | undefined
  /** Final tip total in dollars. Only added when `earnOnTips=true`. */
  tipTotal: number
  /** Loyalty settings for the location. */
  loyaltySettings: LoyaltySettings
  /** The customer's current LoyaltyTier id, or null/undefined if no tier. */
  customerLoyaltyTierId: string | null | undefined
  /**
   * Async lookup for a LoyaltyTier's `pointsMultiplier`. Returns 1.0 if the
   * tier row is missing or the table doesn't exist yet (graceful fallback).
   * Caller picks the DB client (outer db, tx, or venue db).
   */
  lookupTierMultiplier: (tierId: string) => Promise<number>
  /**
   * Rounding mode from the customer's `LoyaltyProgram.roundingMode`.
   * When omitted, null, or not one of {'floor','round','ceil'} the engine
   * uses `DEFAULT_LOYALTY_ROUNDING_MODE` (= 'floor'), which preserves the
   * behavior of every venue whose program already uses the schema default.
   */
  roundingMode?: LoyaltyRoundingMode | string | null | undefined
}

export interface LoyaltyEarnResult {
  /** Whole-number points to credit (>= 0). */
  pointsEarned: number
  /** Dollar amount the points were computed against (subtotal/total ± tips). */
  loyaltyEarningBase: number
  /** Resolved multiplier (1.0 when no tier or lookup fails). */
  loyaltyTierMultiplier: number
}

/**
 * Compute loyalty points to award for a paid order.
 *
 * Returns `{ pointsEarned: 0, loyaltyEarningBase: 0, loyaltyTierMultiplier: 1.0 }`
 * when loyalty is disabled or the base is below `minimumEarnAmount`.
 *
 * Caller is responsible for:
 *   - Confirming the order is in a `paid` state
 *   - Confirming a customer is linked to the order
 *   - Persisting the resulting `LoyaltyTransaction` (with `type='earn'`)
 *
 * This function is pure (other than the supplied `lookupTierMultiplier` call).
 */
export async function computeLoyaltyEarn(input: LoyaltyEarnInput): Promise<LoyaltyEarnResult> {
  const { loyaltySettings, customerLoyaltyTierId, lookupTierMultiplier, tipTotal } = input

  if (!loyaltySettings.enabled) {
    return { pointsEarned: 0, loyaltyEarningBase: 0, loyaltyTierMultiplier: 1.0 }
  }

  let loyaltyEarningBase = loyaltySettings.earnOnSubtotal
    ? toNumber(input.subtotal ?? 0)
    : toNumber(input.total ?? 0)
  if (loyaltySettings.earnOnTips) {
    loyaltyEarningBase += tipTotal
  }

  let loyaltyTierMultiplier = 1.0
  if (customerLoyaltyTierId) {
    try {
      const m = await lookupTierMultiplier(customerLoyaltyTierId)
      if (Number.isFinite(m) && m > 0) {
        loyaltyTierMultiplier = m
      }
    } catch {
      /* table may not exist yet — graceful fallback to 1.0x */
    }
  }

  let pointsEarned = 0
  if (loyaltyEarningBase >= loyaltySettings.minimumEarnAmount) {
    const roundingMode = resolveRoundingMode(input.roundingMode)
    pointsEarned = applyRounding(
      loyaltyEarningBase * loyaltySettings.pointsPerDollar * loyaltyTierMultiplier,
      roundingMode,
    )
  }

  return { pointsEarned, loyaltyEarningBase, loyaltyTierMultiplier }
}

/**
 * Build a `lookupTierMultiplier` that runs against any object exposing
 * `$queryRaw` (Prisma client, transaction client, or extended db).
 *
 * Returns `1.0` when no row matches.
 */
export function makePrismaTierLookup(client: {
  $queryRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>
}): (tierId: string) => Promise<number> {
  return async (tierId: string) => {
    const rows = (await client.$queryRaw`
      SELECT "pointsMultiplier" FROM "LoyaltyTier" WHERE "id" = ${tierId} AND "deletedAt" IS NULL
    `) as Array<{ pointsMultiplier: unknown }>
    if (rows.length === 0) return 1.0
    return Number(rows[0].pointsMultiplier) || 1.0
  }
}

/**
 * Look up the rounding mode from a customer's enrolled `LoyaltyProgram`.
 *
 * Returns `DEFAULT_LOYALTY_ROUNDING_MODE` ('floor') when:
 *   - the customer has no enrolled program
 *   - the program row is missing
 *   - the LoyaltyProgram table doesn't exist yet (graceful fallback)
 *   - the column holds an unrecognized value
 *
 * Caller passes any client exposing `$queryRaw` (Prisma client, tx, extended db).
 */
export async function lookupCustomerRoundingMode(
  client: { $queryRaw: (template: TemplateStringsArray, ...values: unknown[]) => Promise<unknown> },
  customerId: string,
): Promise<LoyaltyRoundingMode> {
  try {
    const rows = (await client.$queryRaw`
      SELECT lp."roundingMode" AS "roundingMode"
      FROM "Customer" c
      LEFT JOIN "LoyaltyProgram" lp ON lp."id" = c."loyaltyProgramId" AND lp."deletedAt" IS NULL
      WHERE c."id" = ${customerId} AND c."deletedAt" IS NULL
      LIMIT 1
    `) as Array<{ roundingMode: unknown }>
    if (rows.length === 0) return DEFAULT_LOYALTY_ROUNDING_MODE
    return resolveRoundingMode(rows[0].roundingMode)
  } catch {
    // LoyaltyProgram table may not exist yet — fall back to default
    return DEFAULT_LOYALTY_ROUNDING_MODE
  }
}

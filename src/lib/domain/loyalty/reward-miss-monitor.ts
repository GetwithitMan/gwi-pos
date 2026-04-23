/**
 * Loyalty Reward-Miss Monitor (Ticket T9 — Loyalty Rewards Cleanup)
 *
 * Periodically checks for orders that should have been awarded loyalty
 * points but weren't:
 *   - status = 'paid'
 *   - customerId IS NOT NULL
 *   - paidAt < NOW() - INTERVAL '30 seconds'  (allow worker drain time)
 *   - NO LoyaltyTransaction(orderId, type='earn') row exists
 *   - NO PendingLoyaltyEarn(orderId) row exists (already-acked or queued)
 *
 * If the count is non-zero, the monitor:
 *   1. Emits a structured `loyalty.reward_miss` log entry with a sample.
 *   2. Emits a high-severity socket event `loyalty:reward_misses_detected`
 *      so admin dashboards can alert.
 *
 * The check is read-only and runs out-of-band (cron). It does NOT block
 * payment, mutate orders, or auto-award. Operators investigate misses
 * manually so we never silently double-credit.
 *
 * Excludes locations where settings.loyalty.enabled !== true.
 */

import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'
import { parseSettings } from '@/lib/settings'
import { dispatchLoyaltyRewardMissesDetected } from '@/lib/socket-dispatch/misc-dispatch'

const log = createChildLogger('loyalty-reward-miss-monitor')

/** Default SLA: orders paid more than 30s ago should already have an earn row. */
export const DEFAULT_WINDOW_SECONDS = 30

/** Cap on how many sample orderIds we log/emit per location. */
const SAMPLE_LIMIT = 10

/** Cap on the lookback horizon (avoid scanning months of history every 5 min). */
const LOOKBACK_HOURS = 24

interface MissRow {
  orderId: string
  locationId: string
}

export interface RewardMissResult {
  locationId: string
  enabled: boolean
  count: number
  sampleOrderIds: string[]
  detectedAt: string
}

/**
 * Scan a single venue DB for reward misses and emit observability signals.
 *
 * Returns a per-location summary array. A location with `enabled: false`
 * is skipped (no query, no alert).
 */
export async function scanRewardMisses(
  client: PrismaClient = db,
  options: { windowSeconds?: number } = {},
): Promise<RewardMissResult[]> {
  const windowSeconds = options.windowSeconds ?? DEFAULT_WINDOW_SECONDS
  const detectedAt = new Date().toISOString()

  // 1) Pull all locations + settings so we can filter on loyalty.enabled.
  //    Per CLAUDE.md hard rules: filter deletedAt: null.
  let locations: Array<{ id: string; settings: unknown }> = []
  try {
    locations = await client.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })
  } catch (err) {
    log.warn({ err }, 'Failed to enumerate locations for reward-miss scan')
    return []
  }

  if (locations.length === 0) return []

  const enabledLocationIds: string[] = []
  for (const loc of locations) {
    try {
      const parsed = parseSettings(loc.settings as Record<string, unknown> | null)
      if (parsed.loyalty?.enabled === true) enabledLocationIds.push(loc.id)
    } catch {
      // Bad settings shape — treat as disabled, do not alert.
    }
  }

  // Always carry disabled locations through to the output (count=0,
  // enabled=false) so callers can build per-location dashboards and
  // distinguish "loyalty off" from "no misses".
  const disabledResults: RewardMissResult[] = locations
    .filter((loc) => !enabledLocationIds.includes(loc.id))
    .map((loc) => ({
      locationId: loc.id,
      enabled: false,
      count: 0,
      sampleOrderIds: [],
      detectedAt,
    }))

  if (enabledLocationIds.length === 0) {
    return disabledResults
  }

  // 2) Single grouped query: orders paid in the [LOOKBACK_HOURS, windowSeconds]
  //    window with a customerId, but no LoyaltyTransaction(earn) AND no
  //    PendingLoyaltyEarn row. NOT EXISTS is index-friendly.
  let misses: MissRow[] = []
  try {
    misses = await client.$queryRaw<MissRow[]>(Prisma.sql`
      SELECT o."id" AS "orderId", o."locationId" AS "locationId"
        FROM "Order" o
       WHERE o."status" = 'paid'
         AND o."customerId" IS NOT NULL
         AND o."deletedAt" IS NULL
         AND o."paidAt" < NOW() - (${windowSeconds}::int || ' seconds')::interval
         AND o."paidAt" > NOW() - (${LOOKBACK_HOURS}::int || ' hours')::interval
         AND o."locationId" = ANY(${enabledLocationIds}::text[])
         AND NOT EXISTS (
           SELECT 1 FROM "LoyaltyTransaction" lt
            WHERE lt."orderId" = o."id"
              AND lt."type" = 'earn'
         )
         AND NOT EXISTS (
           SELECT 1 FROM "PendingLoyaltyEarn" ple
            WHERE ple."orderId" = o."id"
         )
       ORDER BY o."paidAt" DESC
       LIMIT 5000
    `)
  } catch (err) {
    log.warn({ err }, 'reward-miss query failed (schema drift?) — skipping')
    return []
  }

  // 3) Group by locationId and emit per-location.
  const byLocation = new Map<string, string[]>()
  for (const id of enabledLocationIds) byLocation.set(id, [])
  for (const m of misses) {
    const arr = byLocation.get(m.locationId)
    if (arr) arr.push(m.orderId)
  }

  const results: RewardMissResult[] = []
  for (const [locationId, orderIds] of byLocation.entries()) {
    const count = orderIds.length
    const sampleOrderIds = orderIds.slice(0, SAMPLE_LIMIT)
    const result: RewardMissResult = {
      locationId,
      enabled: true,
      count,
      sampleOrderIds,
      detectedAt,
    }
    results.push(result)

    if (count > 0) {
      // High-severity log — dashboards / log aggregators alert on this.
      log.error(
        {
          event: 'loyalty.reward_miss',
          locationId,
          count,
          sampleOrderIds,
          windowSeconds,
        },
        '[LOYALTY] Reward miss detected — paid orders with linked customer have no earn row'
      )
      // Also emit the metric event at info level so dashboards always have
      // a count series even when it is zero (for the per-location series we
      // still emit zeros below).
      log.info(
        {
          event: 'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
          locationId,
          count,
          windowSeconds,
        },
        'loyalty.reward_miss metric'
      )

      // Best-effort socket alert (admin dashboards). Awaited so cron summary
      // reflects success/failure, but failure does not block other locations.
      try {
        await dispatchLoyaltyRewardMissesDetected(locationId, {
          count,
          sampleOrderIds,
          windowSeconds,
          detectedAt,
        })
      } catch (emitErr) {
        log.warn({ err: emitErr, locationId }, 'Failed to dispatch loyalty:reward_misses_detected')
      }
    } else {
      // Zero-count metric (no socket emit, no spam) — debug-level so the
      // metric stream still has a heartbeat the aggregator can chart.
      log.debug(
        {
          event: 'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
          locationId,
          count: 0,
          windowSeconds,
        },
        'loyalty.reward_miss metric (zero)'
      )
    }
  }

  // Append disabled-loc rows so the output enumerates every venue.
  return [...results, ...disabledResults]
}

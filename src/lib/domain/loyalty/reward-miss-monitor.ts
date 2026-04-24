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

/**
 * Memory-safety cap for the sample-fetching query. The TRUE count is taken
 * from a separate COUNT(*) query so the metric is always accurate even when
 * the sample is truncated. When `count > SAMPLE_FETCH_LIMIT`, `capExceeded`
 * is set and a warn log is emitted so ops knows the sample is incomplete.
 */
const SAMPLE_FETCH_LIMIT = 5000

interface MissRow {
  orderId: string
  locationId: string
}

interface CountRow {
  locationId: string
  count: bigint | number
}

export interface RewardMissResult {
  locationId: string
  enabled: boolean
  /** True count of misses for this location (from COUNT(*), not capped). */
  count: number
  sampleOrderIds: string[]
  /**
   * True when the global sample-fetch cap was hit. When true, `sampleOrderIds`
   * is drawn from only the first SAMPLE_FETCH_LIMIT rows globally; `count`
   * remains the real per-location total.
   */
  capExceeded: boolean
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
      capExceeded: false,
      detectedAt,
    }))

  if (enabledLocationIds.length === 0) {
    return disabledResults
  }

  // 2a) TRUE per-location count via grouped COUNT(*) — never capped, so the
  //     metric we emit reflects the real number of misses no matter how big.
  //     This runs first so the count is always trustworthy even if the sample
  //     fetch later trips the SAMPLE_FETCH_LIMIT cap.
  const trueCounts = new Map<string, number>()
  for (const id of enabledLocationIds) trueCounts.set(id, 0)
  try {
    const countRows = await client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT o."locationId" AS "locationId", COUNT(*)::bigint AS "count"
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
       GROUP BY o."locationId"
    `)
    for (const row of countRows) {
      // PG COUNT(*) returns bigint via the pg adapter — coerce safely.
      const n = typeof row.count === 'bigint' ? Number(row.count) : Number(row.count ?? 0)
      trueCounts.set(row.locationId, n)
    }
  } catch (err) {
    log.warn({ err }, 'reward-miss COUNT query failed (schema drift?) — skipping')
    return []
  }

  // 2b) Sample fetch — capped at SAMPLE_FETCH_LIMIT for memory safety. The
  //     count we report is the TRUE count from 2a; the rows below only
  //     populate `sampleOrderIds`. ORDER BY paidAt DESC so the sample is the
  //     most recent misses (likely most actionable for ops).
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
       LIMIT ${SAMPLE_FETCH_LIMIT}
    `)
  } catch (err) {
    log.warn({ err }, 'reward-miss sample query failed (schema drift?) — skipping')
    return []
  }

  // The sample-fetch hit its global cap when the row count equals the limit.
  // (We can't disambiguate "exactly N" vs "N+1 truncated" from LIMIT alone,
  // so use the true total as the authoritative signal: cap is exceeded iff
  // the SUM of true counts exceeds SAMPLE_FETCH_LIMIT.)
  const totalTrueCount = Array.from(trueCounts.values()).reduce((a, b) => a + b, 0)
  const globalCapExceeded = totalTrueCount > SAMPLE_FETCH_LIMIT

  if (globalCapExceeded) {
    // Single global warn — ops MUST know the sample is incomplete. The
    // per-location metric event below also carries `cap_exceeded: true`
    // so dashboards/alerts can flag it without parsing this log.
    log.warn(
      {
        event: 'loyalty.reward_miss_cap_hit',
        sampleFetchLimit: SAMPLE_FETCH_LIMIT,
        trueCountTotal: totalTrueCount,
        windowSeconds,
      },
      '[LOYALTY] Reward-miss sample-fetch cap exceeded — true count > sample (sample is partial, count is accurate)'
    )
  }

  // 3) Group sampled rows by locationId for per-location samples.
  const samplesByLocation = new Map<string, string[]>()
  for (const id of enabledLocationIds) samplesByLocation.set(id, [])
  for (const m of misses) {
    const arr = samplesByLocation.get(m.locationId)
    if (arr) arr.push(m.orderId)
  }

  const results: RewardMissResult[] = []
  for (const locationId of enabledLocationIds) {
    const count = trueCounts.get(locationId) ?? 0
    const sampleRows = samplesByLocation.get(locationId) ?? []
    const sampleOrderIds = sampleRows.slice(0, SAMPLE_LIMIT)
    // Per-location capExceeded mirrors the global flag — when true, this
    // location's sampleOrderIds may be a strict subset of its true count
    // because rows from other locations consumed the global LIMIT.
    const capExceeded = globalCapExceeded && count > sampleRows.length
    const result: RewardMissResult = {
      locationId,
      enabled: true,
      count,
      sampleOrderIds,
      capExceeded,
      detectedAt,
    }
    results.push(result)

    // Single canonical metric event — same shape regardless of count.
    // Dashboards rely on a continuous time series; reserve `error` for
    // non-zero counts so alerts fire only when there are actual misses.
    const metricPayload = {
      event: 'loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s',
      locationId,
      count,
      cap_exceeded: capExceeded,
      sample_fetch_limit: SAMPLE_FETCH_LIMIT,
      windowSeconds,
    }
    if (count > 0) {
      log.info(metricPayload, 'loyalty.reward_miss metric')
    } else {
      // Zero-count: still INFO so the time-series stays continuous in
      // production where debug logs are typically filtered out.
      log.info(metricPayload, 'loyalty.reward_miss metric (zero)')
    }

    if (count > 0) {
      // High-severity log — dashboards / log aggregators alert on this.
      log.error(
        {
          event: 'loyalty.reward_miss',
          locationId,
          count,
          sampleOrderIds,
          cap_exceeded: capExceeded,
          windowSeconds,
        },
        '[LOYALTY] Reward miss detected — paid orders with linked customer have no earn row'
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
    }
  }

  // Append disabled-loc rows so the output enumerates every venue.
  return [...results, ...disabledResults]
}

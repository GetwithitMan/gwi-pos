import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { scanRewardMisses } from '@/lib/domain/loyalty/reward-miss-monitor'
import { ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/loyalty-reward-miss — every 5 minutes (Ticket T9).
 *
 * Read-only observability cron. Emits a metric per location:
 *   `loyalty.orders_paid_with_customer_without_loyalty_txn_within_30s`
 *
 * For any non-zero location, also emits:
 *   - high-severity structured log `loyalty.reward_miss`
 *   - socket event `loyalty:reward_misses_detected` (admin dashboards)
 *
 * Disabled-loyalty venues are filtered out before query — no alerts ever
 * fire for venues that intentionally don't run a rewards program.
 *
 * Per CLAUDE.md cloud-routing: this cron uses `forAllVenues()` so the
 * underlying `db` proxy resolves to the correct venue DB on Vercel
 * (multi-tenant) and the local DB on a NUC.
 */
export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  const allResults: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    const results = await scanRewardMisses(venueDb)
    const totalCount = results.reduce((acc, r) => acc + r.count, 0)
    const enabledLocations = results.filter((r) => r.enabled).length
    // Surface the cap-exceeded signal in the cron response so MC/dashboards
    // can flag a venue whose true count is partially-sampled (PR #272 fix).
    const capExceeded = results.some((r) => r.capExceeded)
    allResults[slug] = {
      enabledLocations,
      totalMisses: totalCount,
      capExceeded,
      perLocation: results,
    }
  }, { label: 'cron:loyalty-reward-miss' })

  return ok({
    ...summary,
    venues: allResults,
    timestamp: new Date().toISOString(),
  })
}

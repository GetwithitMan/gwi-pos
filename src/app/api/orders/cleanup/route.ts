/**
 * POST /api/orders/cleanup
 *
 * Stale draft order TTL cleanup.
 *
 * Finds open orders with 0 items created more than 15 minutes ago,
 * cancels them, clears their tableId (unblocking the table), and emits
 * ORDER_CLOSED + orders:list-changed events for each.
 *
 * Intended to be called every 5 minutes by the NUC sync-agent or a cron job.
 *
 * Query params:
 *   locationId (required) — the location to clean up
 *   maxAgeMinutes (optional) — override the default 15-minute threshold
 *   dryRun (optional) — if "true", returns count without closing
 */

import { withVenue } from '@/lib/with-venue'
import { cleanupStaleOrders } from '@/lib/domain/cleanup/stale-order-cleanup'
import { logger } from '@/lib/logger'
import { err, ok, unauthorized } from '@/lib/api-response'

export const POST = withVenue(async (request) => {
  try {
    // Security: require CRON_SECRET or INTERNAL_API_SECRET
    const authHeader = request.headers.get('authorization')?.replace('Bearer ', '') || ''
    const apiKey = request.headers.get('x-api-key') || ''
    const cronSecret = process.env.CRON_SECRET
    const internalSecret = process.env.INTERNAL_API_SECRET
    const isAuthorized =
      (cronSecret && (authHeader === cronSecret || apiKey === cronSecret)) ||
      (internalSecret && (authHeader === internalSecret || apiKey === internalSecret))
    if (!isAuthorized) {
      return unauthorized('Unauthorized — CRON_SECRET or INTERNAL_API_SECRET required')
    }

    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const maxAgeMinutes = parseInt(searchParams.get('maxAgeMinutes') || '15', 10) || 15
    const dryRun = searchParams.get('dryRun') === 'true'

    if (!locationId) {
      return err('locationId is required')
    }

    if (isNaN(maxAgeMinutes) || maxAgeMinutes < 1) {
      return err('maxAgeMinutes must be a positive integer')
    }

    const result = await cleanupStaleOrders({
      locationId,
      maxAgeMinutes,
      dryRun,
      clearTable: true,
      reason: 'stale_draft_ttl',
    })

    if (dryRun) {
      return ok({
        dryRun: true,
        staleOrderCount: result.closedCount,
        cutoffTime: result.cutoffTime,
      })
    }

    return ok({
      cleaned: result.closedCount,
      orderIds: result.orderIds,
    })
  } catch (error) {
    logger.error('[orders/cleanup] Error:', error)
    return err(error instanceof Error ? error.message : 'Unknown error', 500)
  }
})

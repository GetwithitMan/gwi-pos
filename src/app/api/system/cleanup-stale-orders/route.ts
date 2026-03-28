import { withVenue } from '@/lib/with-venue'
import { cleanupStaleOrders } from '@/lib/domain/cleanup/stale-order-cleanup'
import { logger } from '@/lib/logger'
import { err, ok, unauthorized } from '@/lib/api-response'

/**
 * POST /api/system/cleanup-stale-orders
 *
 * Closes all $0 draft orders older than 4 hours.
 * These are orphaned orders from draft pre-creation that were never used.
 *
 * Callable manually (admin action) or by the 4 AM EOD cron.
 *
 * Query params:
 *   locationId (required) — the location to clean up
 *   maxAgeHours (optional) — override the default 4-hour threshold
 *   dryRun (optional) — if "true", returns count without closing
 */
export const POST = withVenue(async (request) => {
  try {
    // Security: require CRON_SECRET or INTERNAL_API_SECRET
    // This endpoint is called by the EOD cron or admin action — never by regular users.
    const authHeader = request.headers.get('authorization')?.replace('Bearer ', '') || ''
    const apiKey = request.headers.get('x-api-key') || ''
    const cronSecret = process.env.CRON_SECRET
    const internalSecret = process.env.INTERNAL_API_SECRET
    const isAuthorized = (cronSecret && (authHeader === cronSecret || apiKey === cronSecret)) ||
                         (internalSecret && (authHeader === internalSecret || apiKey === internalSecret))
    if (!isAuthorized) {
      return unauthorized('Unauthorized — CRON_SECRET or INTERNAL_API_SECRET required')
    }

    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const maxAgeHours = parseInt(searchParams.get('maxAgeHours') || '4', 10)
    const dryRun = searchParams.get('dryRun') === 'true'

    if (!locationId) {
      return err('locationId is required')
    }

    if (isNaN(maxAgeHours) || maxAgeHours < 1) {
      return err('maxAgeHours must be a positive integer')
    }

    const result = await cleanupStaleOrders({ locationId, maxAgeHours, dryRun })

    if (dryRun) {
      return ok({
          dryRun: true,
          staleOrderCount: result.closedCount,
          cutoffTime: result.cutoffTime,
        })
    }

    return ok(result)
  } catch (error) {
    logger.error('[cleanup-stale-orders] Error:', error)
    return err(error instanceof Error ? error.message : 'Unknown error', 500)
  }
})

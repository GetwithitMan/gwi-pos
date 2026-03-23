import { NextRequest, NextResponse } from 'next/server'
import { parseSettings, DEFAULT_EOD_SETTINGS } from '@/lib/settings'
import { executeEodReset } from '@/lib/eod'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

// PAY-P3-4: Datacap batch close is already handled by executeEodReset() when
// location settings have autoBatchClose=true and processor='datacap'.
// The cron runs within a 15-minute window after the configured batchCloseTime.
// If a venue misses the window (cron downtime, Vercel cold start), batch close
// will NOT retry until the next day. Consider adding a fallback check: if
// batchCloseSuccess was never recorded for today, retry on next cron invocation.
// Also consider calling /api/internal/datacap-reconciliation (PUT) here to
// auto-orphan stale pending sales before batch settlement.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb, slug) => {
    const locations = await venueDb.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    for (const loc of locations) {
      const parsed = parseSettings(loc.settings as Record<string, unknown> | null)
      const eod = parsed.eod ?? DEFAULT_EOD_SETTINGS
      const batchCloseTime = eod.batchCloseTime || '04:00'

      // Parse configured batch time
      const [batchHour, batchMinute] = batchCloseTime.split(':').map(Number)
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()

      // Check if we're within the 15-minute window after batch close time
      const batchMinuteOfDay = batchHour * 60 + batchMinute
      const currentMinuteOfDay = currentHour * 60 + currentMinute
      const minutesSinceBatch = currentMinuteOfDay - batchMinuteOfDay

      if (minutesSinceBatch < 0 || minutesSinceBatch >= 15) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'outside_batch_window' })
        continue
      }

      // Delegate all EOD logic to the shared function
      try {
        const result = await executeEodReset({
          locationId: loc.id,
          triggeredBy: 'cron',
        })

        if (result.alreadyRanToday) {
          allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'already_ran_today' })
          continue
        }

        allResults.push({
          slug,
          locationId: loc.id,
          rolledOverOrders: result.rolledOverOrders,
          tablesReset: result.tablesReset,
          entertainmentReset: result.entertainmentReset,
          entertainmentSessionsCharged: result.entertainmentSessionsCharged,
          entertainmentTotalCharges: result.entertainmentTotalCharges,
          waitlistCancelled: result.waitlistCancelled,
          tabsCaptured: result.tabsCaptured,
          tabsCapturedAmount: result.tabsCapturedAmount,
          tabsDeclined: result.tabsDeclined,
          tabsRolledOver: result.tabsRolledOver,
          batchCloseSuccess: result.batchCloseSuccess,
          businessDay: result.businessDay,
          warnings: result.warnings,
        })
      } catch (locErr) {
        allResults.push({
          slug,
          locationId: loc.id,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
        console.error(`[cron:eod-batch-close] Venue ${slug} location ${loc.id} failed:`, locErr)
      }
    }
  }, { label: 'cron:eod-batch-close' })

  return NextResponse.json({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}

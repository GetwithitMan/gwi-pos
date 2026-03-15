import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, DEFAULT_EOD_SETTINGS } from '@/lib/settings'
import { executeEodReset } from '@/lib/eod'
import { verifyCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const results: Record<string, unknown>[] = []

  try {
    const locations = await db.location.findMany({
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
        results.push({ locationId: loc.id, skipped: true, reason: 'outside_batch_window' })
        continue
      }

      // Delegate all EOD logic to the shared function
      try {
        const result = await executeEodReset({
          locationId: loc.id,
          triggeredBy: 'cron',
        })

        if (result.alreadyRanToday) {
          results.push({ locationId: loc.id, skipped: true, reason: 'already_ran_today' })
          continue
        }

        results.push({
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
        results.push({
          locationId: loc.id,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
        console.error(`[EOD Cron] Failed for location ${loc.id}:`, locErr)
      }
    }

    return NextResponse.json({
      ok: true,
      processed: results,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[EOD Auto Batch] Failed:', error)
    return NextResponse.json(
      { error: 'EOD auto batch close failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}

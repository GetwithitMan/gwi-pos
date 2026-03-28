import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

interface CronHealthEntry {
  name: string
  schedule: string
  lastRun: string | null
  alertThresholdMinutes: number
  isHealthy: boolean
}

/**
 * GET /api/health/crons — Reservation cron health check
 *
 * Returns the last successful run timestamp for each reservation cron,
 * inferred from the fields they update. Alert threshold = 2x schedule interval.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()

  try {
    // Hold expiry: last cancelled-by-cron reservation (actor='cron' + cancelled event)
    const lastHoldExpiry: { createdAt: Date }[] = await db.$queryRaw`
      SELECT "createdAt" FROM "ReservationEvent"
      WHERE "eventType" = 'cancelled' AND actor = 'cron'
      ORDER BY "createdAt" DESC LIMIT 1
    `

    // No-shows: last no_show_marked event by cron
    const lastNoShow: { createdAt: Date }[] = await db.$queryRaw`
      SELECT "createdAt" FROM "ReservationEvent"
      WHERE "eventType" = 'no_show_marked' AND actor = 'cron'
      ORDER BY "createdAt" DESC LIMIT 1
    `

    // Reminders: last reminder_24h_sent or reminder_2h_sent event
    const lastReminder: { createdAt: Date }[] = await db.$queryRaw`
      SELECT "createdAt" FROM "ReservationEvent"
      WHERE "eventType" IN ('reminder_24h_sent', 'reminder_2h_sent') AND actor = 'cron'
      ORDER BY "createdAt" DESC LIMIT 1
    `

    // Thank you: last thank_you_sent event
    const lastThankYou: { createdAt: Date }[] = await db.$queryRaw`
      SELECT "createdAt" FROM "ReservationEvent"
      WHERE "eventType" = 'thank_you_sent' AND actor = 'cron'
      ORDER BY "createdAt" DESC LIMIT 1
    `

    function buildEntry(
      name: string,
      schedule: string,
      alertMinutes: number,
      rows: { createdAt: Date }[]
    ): CronHealthEntry {
      const lastRun = rows[0]?.createdAt?.toISOString() ?? null
      const isHealthy = lastRun
        ? now.getTime() - new Date(lastRun).getTime() < alertMinutes * 60 * 1000
        : true // No runs yet is OK — cron may not have had work to do
      return { name, schedule, lastRun, alertThresholdMinutes: alertMinutes, isHealthy }
    }

    const entries: CronHealthEntry[] = [
      buildEntry('reservation-hold-expiry', '*/2 * * * *', 4, lastHoldExpiry),
      buildEntry('reservation-no-shows', '*/5 * * * *', 10, lastNoShow),
      buildEntry('reservation-reminders', '*/15 * * * *', 30, lastReminder),
      buildEntry('reservation-thank-you', '*/30 * * * *', 60, lastThankYou),
    ]

    const allHealthy = entries.every(e => e.isHealthy)

    return ok({
      ok: allHealthy,
      crons: entries,
      timestamp: now.toISOString(),
    })
  } catch (caughtErr) {
    console.error('[health/crons] Error:', err)
    return err('Internal error', 500)
  }
}

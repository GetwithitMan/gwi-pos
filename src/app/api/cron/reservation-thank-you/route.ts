import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendReservationNotification } from '@/lib/reservations/notifications'
import { parseSettings } from '@/lib/settings'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { createChildLogger } from '@/lib/logger'
import { ok } from '@/lib/api-response'
const log = createChildLogger('cron-reservation-thank-you')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/reservation-thank-you — Every 30 min
 *
 * Send thank-you messages to guests whose reservations completed 30+ min ago.
 * Atomic UPDATE ... WHERE thankYouSentAt IS NULL prevents double-sends.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000)
  const allProcessed: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    let sentCount = 0

    // Atomically claim un-sent thank-you messages
    const claimed: { id: string; locationId: string }[] = await venueDb.$queryRaw`
      UPDATE "Reservation"
      SET "thankYouSentAt" = ${now}
      WHERE status = 'completed'
        AND "thankYouSentAt" IS NULL
        AND "completedAt" IS NOT NULL
        AND "completedAt" < ${thirtyMinAgo}
      RETURNING id, "locationId"
    `

    for (const row of claimed) {
      try {
        const reservation = await venueDb.reservation.findUnique({
          where: { id: row.id },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          },
        })
        if (!reservation) continue

        const location = await venueDb.location.findUnique({
          where: { id: row.locationId },
          select: { name: true, settings: true, phone: true, slug: true },
        })
        if (!location) continue

        const settings = parseSettings(location.settings)
        const templates = settings.reservationTemplates

        await sendReservationNotification({
          reservation,
          templateKey: 'thankYou',
          db: venueDb,
          templates: templates || {},
          venueInfo: {
            name: location.name,
            phone: location.phone || undefined,
            slug: location.slug || '',
            baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://thepasspos.com',
          },
        })

        await venueDb.reservationEvent.create({
          data: {
            locationId: row.locationId,
            reservationId: row.id,
            eventType: 'thank_you_sent',
            actor: 'cron',
            details: {},
          },
        })

        sentCount++
      } catch (err) {
        console.error(`[cron:reservation-thank-you] Venue ${slug}: Failed for ${row.id}:`, err)
        // Rollback so it can be retried
        void venueDb.$executeRaw`
          UPDATE "Reservation" SET "thankYouSentAt" = NULL WHERE id = ${row.id}
        `.catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    allProcessed[slug] = { thankYouSent: sentCount }
  }, { label: 'cron:reservation-thank-you' })

  return ok({
    ...summary,
    processed: allProcessed,
    timestamp: now.toISOString(),
  })
}

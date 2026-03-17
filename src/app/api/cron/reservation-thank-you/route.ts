import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendReservationNotification } from '@/lib/reservations/notifications'
import { parseSettings } from '@/lib/settings'

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
  let sentCount = 0

  try {
    // Atomically claim un-sent thank-you messages
    const claimed: { id: string; locationId: string }[] = await db.$queryRaw`
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
        const reservation = await db.reservation.findUnique({
          where: { id: row.id },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
          },
        })
        if (!reservation) continue

        const location = await db.location.findUnique({
          where: { id: row.locationId },
          select: { name: true, settings: true, phone: true, slug: true },
        })
        if (!location) continue

        const settings = parseSettings(location.settings)
        const templates = settings.reservationTemplates

        await sendReservationNotification({
          reservation,
          templateKey: 'thankYou',
          db,
          templates: templates || {},
          venueInfo: {
            name: location.name,
            phone: location.phone || undefined,
            slug: location.slug || '',
            baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://thepasspos.com',
          },
        })

        await db.reservationEvent.create({
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
        console.error(`[reservation-thank-you] Failed for ${row.id}:`, err)
        // Rollback so it can be retried
        void db.$executeRaw`
          UPDATE "Reservation" SET "thankYouSentAt" = NULL WHERE id = ${row.id}
        `.catch(console.error)
      }
    }

    return NextResponse.json({
      ok: true,
      processed: { thankYouSent: sentCount },
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('[reservation-thank-you] Fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

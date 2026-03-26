import { NextRequest, NextResponse } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { sendReservationNotification } from '@/lib/reservations/notifications'
import { parseSettings } from '@/lib/settings'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('cron-reservation-reminders')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/reservation-reminders — Every 15 min
 *
 * 1. Send 24h reminders for confirmed reservations 23-25h away
 * 2. Send 2h reminders for confirmed reservations 1.5-2.5h away
 * Uses atomic UPDATE ... WHERE sentAt IS NULL pattern to prevent double-sends.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allProcessed: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    let reminder24hCount = 0
    let reminder2hCount = 0

    // ── Step 1: 24-hour reminders ────────────────────────────────
    const min24h = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    const max24h = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    // Atomically claim un-sent 24h reminders
    const claimed24h: { id: string; locationId: string }[] = await venueDb.$queryRaw`
      UPDATE "Reservation"
      SET "reminder24hSentAt" = ${now}
      WHERE status = 'confirmed'
        AND "reminder24hSentAt" IS NULL
        AND ("reservationDate" + ("reservationTime" || ':00')::time) BETWEEN ${min24h} AND ${max24h}
      RETURNING id, "locationId"
    `

    for (const row of claimed24h) {
      try {
        const reservation = await venueDb.reservation.findUnique({
          where: { id: row.id },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
            table: { select: { id: true, name: true } },
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
          templateKey: 'reminder24h',
          db: venueDb,
          templates: templates || {},
          venueInfo: {
            name: location.name,
            phone: location.phone || undefined,
            slug: location.slug || '',
            baseUrl: process.env.NEXT_PUBLIC_BASE_URL || 'https://thepasspos.com',
          },
        })

        // Write event
        await venueDb.reservationEvent.create({
          data: {
            locationId: row.locationId,
            reservationId: row.id,
            eventType: 'reminder_24h_sent',
            actor: 'cron',
            details: {},
          },
        })

        reminder24hCount++
      } catch (err) {
        console.error(`[cron:reservation-reminders] Venue ${slug}: 24h failed for ${row.id}:`, err)
        // Rollback the sentAt so it can be retried
        void venueDb.$executeRaw`
          UPDATE "Reservation" SET "reminder24hSentAt" = NULL WHERE id = ${row.id}
        `.catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    // ── Step 2: 2-hour reminders ─────────────────────────────────
    const min2h = new Date(now.getTime() + 1.5 * 60 * 60 * 1000)
    const max2h = new Date(now.getTime() + 2.5 * 60 * 60 * 1000)

    const claimed2h: { id: string; locationId: string }[] = await venueDb.$queryRaw`
      UPDATE "Reservation"
      SET "reminder2hSentAt" = ${now}
      WHERE status = 'confirmed'
        AND "reminder2hSentAt" IS NULL
        AND ("reservationDate" + ("reservationTime" || ':00')::time) BETWEEN ${min2h} AND ${max2h}
      RETURNING id, "locationId"
    `

    for (const row of claimed2h) {
      try {
        const reservation = await venueDb.reservation.findUnique({
          where: { id: row.id },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
            table: { select: { id: true, name: true } },
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
          templateKey: 'reminder2h',
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
            eventType: 'reminder_2h_sent',
            actor: 'cron',
            details: {},
          },
        })

        reminder2hCount++
      } catch (err) {
        console.error(`[cron:reservation-reminders] Venue ${slug}: 2h failed for ${row.id}:`, err)
        void venueDb.$executeRaw`
          UPDATE "Reservation" SET "reminder2hSentAt" = NULL WHERE id = ${row.id}
        `.catch(err => log.warn({ err }, 'Background task failed'))
      }
    }

    allProcessed[slug] = {
      reminder24h: reminder24hCount,
      reminder2h: reminder2hCount,
    }
  }, { label: 'cron:reservation-reminders' })

  return NextResponse.json({
    ...summary,
    processed: allProcessed,
    timestamp: now.toISOString(),
  })
}

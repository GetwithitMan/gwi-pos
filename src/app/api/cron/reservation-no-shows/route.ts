import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { transition } from '@/lib/reservations/state-machine'
import { parseSettings, DEFAULT_RESERVATION_SETTINGS } from '@/lib/settings'
import { dispatchReservationChanged } from '@/lib/socket-dispatch'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { notifyNuc } from '@/lib/cron-nuc-notify'
import { createChildLogger } from '@/lib/logger'
import { ok } from '@/lib/api-response'
const log = createChildLogger('cron-reservation-no-shows')

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/reservation-no-shows — Every 5 min
 *
 * 1. Find confirmed reservations past their time + noShowGraceMinutes
 * 2. Transition each to no_show
 * 3. Increment Customer.noShowCount, blacklist if threshold exceeded
 * 4. Forfeit deposit if rules say so
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allProcessed: Record<string, unknown> = {}

  const summary = await forAllVenues(async (venueDb, slug) => {
    let noShowCount = 0
    let blacklistedCount = 0

    // ── Step 1: Get all locations with confirmed reservations on or before today ──
    const locations: { id: string; settings: any }[] = await venueDb.$queryRaw`
      SELECT DISTINCT l.id, l.settings
      FROM "Location" l
      JOIN "Reservation" r ON r."locationId" = l.id
      WHERE r.status = 'confirmed'
        AND r."serviceDate" <= ${now}::date
    `

    for (const location of locations) {
      const settings = parseSettings(location.settings)
      const resSetting = settings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
      const graceMinutes = resSetting.noShowGraceMinutes ?? 15
      const blacklistThreshold = resSetting.noShowBlacklistAfterCount ?? 3

      // ── Step 2: Find no-show candidates for this location ──────
      // Compute the actual reservation datetime (serviceDate + reservationTime) and add
      // the grace period. Mark as no-show only when NOW exceeds that threshold.
      // This correctly handles cross-midnight reservations (e.g. 11:30 PM service date
      // = previous calendar day) by always using serviceDate instead of reservationDate.
      const candidates: { id: string; customerId: string | null; depositStatus: string | null }[] =
        await venueDb.$queryRaw`
          SELECT r.id, r."customerId", r."depositStatus"
          FROM "Reservation" r
          WHERE r."locationId" = ${location.id}
            AND r.status = 'confirmed'
            AND r."serviceDate" <= ${now}::date
            AND (
              r."serviceDate"::date + r."reservationTime"::time
                + (${graceMinutes} * interval '1 minute')
              < ${now}::timestamp
            )
        `

      // ── Step 3: Process each candidate ─────────────────────────
      for (const candidate of candidates) {
        try {
          await venueDb.$transaction(async (tx: any) => {
            await transition({
              reservationId: candidate.id,
              to: 'no_show',
              actor: { type: 'cron' },
              db: tx,
              locationId: location.id,
            })

            // Forfeit deposit if paid and settings allow
            if (candidate.depositStatus === 'paid') {
              const depositRules = settings.depositRules
              const shouldForfeit = !depositRules || depositRules.enabled !== false
              if (shouldForfeit) {
                await tx.$executeRaw`UPDATE "Reservation" SET "depositStatus" = 'forfeited' WHERE id = ${candidate.id}`
                await tx.reservationEvent.create({
                  data: {
                    locationId: location.id,
                    reservationId: candidate.id,
                    eventType: 'deposit_forfeited',
                    actor: 'cron',
                    details: { reason: 'no_show' },
                  },
                })
              }
            }

            // Increment customer no-show count + blacklist check
            if (candidate.customerId) {
              await tx.$executeRaw`UPDATE "Customer" SET "noShowCount" = COALESCE("noShowCount", 0) + 1 WHERE id = ${candidate.customerId}`

              const rows: { noShowCount: number }[] = await tx.$queryRaw`SELECT "noShowCount" FROM "Customer" WHERE id = ${candidate.customerId}`
              if (rows[0] && rows[0].noShowCount >= blacklistThreshold) {
                await tx.$executeRaw`UPDATE "Customer" SET "isBlacklisted" = true WHERE id = ${candidate.customerId}`
                blacklistedCount++
              }
            }
          })
          noShowCount++
          if (process.env.VERCEL) {
            void notifyNuc(slug, 'reservation:changed', {
              locationId: location.id,
              reservationId: candidate.id,
              action: 'no_show',
            }).catch(err => log.warn({ err }, 'Background task failed'))
          } else {
            void dispatchReservationChanged(location.id, {
              reservationId: candidate.id, action: 'no_show',
            }).catch(err => log.warn({ err }, 'Background task failed'))
          }
        } catch (err) {
          console.error(`[cron:reservation-no-shows] Venue ${slug}: Failed for ${candidate.id}:`, err)
        }
      }
    }

    allProcessed[slug] = {
      noShows: noShowCount,
      blacklisted: blacklistedCount,
    }
  }, { label: 'cron:reservation-no-shows' })

  return ok({
    ...summary,
    processed: allProcessed,
    timestamp: now.toISOString(),
  })
}

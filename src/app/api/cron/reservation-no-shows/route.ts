import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { transition } from '@/lib/reservations/state-machine'
import { parseSettings, DEFAULT_RESERVATION_SETTINGS } from '@/lib/settings'

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
  let noShowCount = 0
  let blacklistedCount = 0

  try {
    // ── Step 1: Get all locations with confirmed reservations today ──
    const locations: { id: string; settings: any }[] = await db.$queryRaw`
      SELECT DISTINCT l.id, l.settings
      FROM "Location" l
      JOIN "Reservation" r ON r."locationId" = l.id
      WHERE r.status = 'confirmed'
        AND r."reservationDate" <= ${now}::date
    `

    for (const location of locations) {
      const settings = parseSettings(location.settings)
      const resSetting = settings.reservationSettings ?? DEFAULT_RESERVATION_SETTINGS
      const graceMinutes = resSetting.noShowGraceMinutes ?? 15
      const blacklistThreshold = resSetting.noShowBlacklistAfterCount ?? 3

      // ── Step 2: Find no-show candidates for this location ──────
      // Reservation time + grace has passed
      const candidates: { id: string; customerId: string | null; depositStatus: string | null }[] =
        await db.$queryRaw`
          SELECT r.id, r."customerId", r."depositStatus"
          FROM "Reservation" r
          WHERE r."locationId" = ${location.id}
            AND r.status = 'confirmed'
            AND r."reservationDate" <= ${now}::date
            AND (
              r."reservationDate" < ${now}::date
              OR (
                EXTRACT(HOUR FROM ${now}::time) * 60 + EXTRACT(MINUTE FROM ${now}::time)
                > (CAST(SPLIT_PART(r."reservationTime", ':', 1) AS INT) * 60
                   + CAST(SPLIT_PART(r."reservationTime", ':', 2) AS INT)
                   + ${graceMinutes})
              )
            )
        `

      // ── Step 3: Process each candidate ─────────────────────────
      for (const candidate of candidates) {
        try {
          await db.$transaction(async (tx: any) => {
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
              // Default: forfeit on no-show (unless explicitly disabled)
              const shouldForfeit = !depositRules || depositRules.enabled !== false
              if (shouldForfeit) {
                await tx.$executeRawUnsafe(
                  `UPDATE "Reservation" SET "depositStatus" = 'forfeited' WHERE id = $1`,
                  candidate.id
                )
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
              await tx.$executeRawUnsafe(
                `UPDATE "Customer" SET "noShowCount" = COALESCE("noShowCount", 0) + 1 WHERE id = $1`,
                candidate.customerId
              )

              // Check if threshold exceeded
              const rows: { noShowCount: number }[] = await tx.$queryRawUnsafe(
                `SELECT "noShowCount" FROM "Customer" WHERE id = $1`,
                candidate.customerId
              )
              if (rows[0] && rows[0].noShowCount >= blacklistThreshold) {
                await tx.$executeRawUnsafe(
                  `UPDATE "Customer" SET "isBlacklisted" = true WHERE id = $1`,
                  candidate.customerId
                )
                blacklistedCount++
              }
            }
          })
          noShowCount++
        } catch (err) {
          console.error(`[reservation-no-shows] Failed for ${candidate.id}:`, err)
        }
      }
    }

    return NextResponse.json({
      ok: true,
      processed: {
        noShows: noShowCount,
        blacklisted: blacklistedCount,
      },
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('[reservation-no-shows] Fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

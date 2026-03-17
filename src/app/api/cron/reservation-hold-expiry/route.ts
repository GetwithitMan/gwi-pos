import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { transition } from '@/lib/reservations/state-machine'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/reservation-hold-expiry — Every 2 min
 *
 * 1. Cancel pending reservations whose holdExpiresAt has passed
 * 2. Clean up expired idempotency keys (>1 hour old)
 * 3. Clean up expired deposit tokens
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  let cancelledCount = 0
  let idempotencyKeysDeleted = 0
  let depositTokensDeleted = 0

  try {
    // ── Step 1: Find pending reservations with expired holds ──────
    // Atomic: only grab rows where holdExpiresAt IS NOT NULL to avoid re-processing
    const expiredHolds: { id: string; locationId: string }[] = await db.$queryRaw`
      UPDATE "Reservation"
      SET "holdExpiresAt" = NULL
      WHERE status = 'pending'
        AND "holdExpiresAt" IS NOT NULL
        AND "holdExpiresAt" < ${now}
      RETURNING id, "locationId"
    `

    // ── Step 2: Transition each to cancelled ─────────────────────
    for (const row of expiredHolds) {
      try {
        await db.$transaction(async (tx: any) => {
          await transition({
            reservationId: row.id,
            to: 'cancelled',
            actor: { type: 'cron' },
            reason: 'Hold expired — no deposit received',
            db: tx,
            locationId: row.locationId,
          })
        })
        cancelledCount++
      } catch (err) {
        console.error(`[reservation-hold-expiry] Failed to cancel ${row.id}:`, err)
      }
    }

    // ── Step 3: Clean up expired idempotency keys (>1 hour old) ──
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
    const idempResult = await db.$executeRaw`
      DELETE FROM "ReservationIdempotencyKey"
      WHERE "createdAt" < ${oneHourAgo}
    `
    idempotencyKeysDeleted = typeof idempResult === 'number' ? idempResult : 0

    // ── Step 4: Clean up expired deposit tokens ──────────────────
    const depositResult = await db.$executeRaw`
      DELETE FROM "ReservationDepositToken"
      WHERE "expiresAt" < ${now}
    `
    depositTokensDeleted = typeof depositResult === 'number' ? depositResult : 0

    return NextResponse.json({
      ok: true,
      processed: {
        cancelledHolds: cancelledCount,
        idempotencyKeysDeleted,
        depositTokensDeleted,
      },
      timestamp: now.toISOString(),
    })
  } catch (err) {
    console.error('[reservation-hold-expiry] Fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

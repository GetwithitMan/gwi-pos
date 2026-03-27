import { NextRequest, NextResponse } from 'next/server'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { parseSettings, DEFAULT_EOD_SETTINGS } from '@/lib/settings'
import { executeEodReset } from '@/lib/eod'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'

// PAY-P3-4: Datacap batch close is already handled by executeEodReset() when
// location settings have autoBatchClose=true and processor='datacap'.
// The cron runs within a 15-minute window after the configured batchCloseTime.
// If the window is missed (Vercel cold start, outage), catch-up logic runs
// EOD up to MAX_CATCHUP_MINUTES after the scheduled time, provided EOD hasn't
// already run today (idempotency via AuditLog in executeEodReset).
// Also consider calling /api/internal/datacap-reconciliation (PUT) here to
// auto-orphan stale pending sales before batch settlement.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Max time to wait for active tab-close operations to finish before proceeding
const ACTIVE_PAYMENT_WAIT_MS = 5_000
const ACTIVE_PAYMENT_POLL_MS = 500

// Max catch-up window: if the normal 15-minute window was missed, still execute
// EOD up to this many minutes after the scheduled batch close time.
const MAX_CATCHUP_MINUTES = 240 // 4 hours

/**
 * Check if any orders at this location have an active tab close or pending payment
 * in progress. These orders must NOT be touched by EOD batch close.
 *
 * Returns the count of actively-closing orders.
 */
async function countActivelyClosingOrders(
  venueDb: PrismaClient,
  locationId: string
): Promise<number> {
  const result = await venueDb.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    SELECT COUNT(*)::bigint as count
    FROM "Order"
    WHERE "locationId" = ${locationId}
      AND "deletedAt" IS NULL
      AND "status" = 'open'
      AND "orderType" = 'bar_tab'
      AND (
        "tabStatus" = 'closing'
        OR "tabStatus" = 'pending_auth'
      )
  `)
  return Number(result[0]?.count ?? 0)
}

/**
 * Count orders that have pending (unfinished) payments — these are orders where
 * a Payment record exists with status='pending' or 'processing', indicating a
 * terminal is mid-charge. EOD must not touch these orders.
 */
async function countOrdersWithPendingPayments(
  venueDb: PrismaClient,
  locationId: string
): Promise<number> {
  const result = await venueDb.$queryRaw<[{ count: bigint }]>(Prisma.sql`
    SELECT COUNT(DISTINCT o.id)::bigint as count
    FROM "Order" o
    INNER JOIN "Payment" p ON p."orderId" = o.id
    WHERE o."locationId" = ${locationId}
      AND o."deletedAt" IS NULL
      AND o."status" = 'open'
      AND p."status" IN ('pending', 'processing')
      AND p."deletedAt" IS NULL
  `)
  return Number(result[0]?.count ?? 0)
}

/**
 * Pre-flight safety check: Use FOR UPDATE SKIP LOCKED to verify how many idle
 * open bar tabs can actually be locked right now. Tabs locked by concurrent
 * payment transactions will be silently skipped. This runs in a short-lived
 * transaction just to count — the locks are released immediately.
 *
 * Returns { lockable, skippedByPayment } so we can log diagnostics.
 */
async function preflightTabLockCheck(
  venueDb: PrismaClient,
  locationId: string
): Promise<{ lockable: number; totalOpen: number }> {
  const counts = await venueDb.$transaction(async (tx) => {
    // Total open bar tabs
    const totalResult = await (tx as unknown as PrismaClient).$queryRaw<[{ count: bigint }]>(Prisma.sql`
      SELECT COUNT(*)::bigint as count
      FROM "Order"
      WHERE "locationId" = ${locationId}
        AND "deletedAt" IS NULL
        AND "status" = 'open'
        AND "orderType" = 'bar_tab'
    `)
    const totalOpen = Number(totalResult[0]?.count ?? 0)

    // Lockable tabs (idle, not in another transaction)
    const lockableResult = await (tx as unknown as PrismaClient).$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o.id
      FROM "Order" o
      WHERE o."locationId" = ${locationId}
        AND o."deletedAt" IS NULL
        AND o."status" = 'open'
        AND o."orderType" = 'bar_tab'
        AND (o."tabStatus" IS NULL OR o."tabStatus" NOT IN ('closing', 'pending_auth', 'closed'))
      FOR UPDATE SKIP LOCKED
    `)

    return { lockable: lockableResult.length, totalOpen }
  }, { timeout: 10_000 })

  return counts
}

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

      // Check if we're within the 15-minute window after batch close time,
      // or in the catch-up window (15 min to MAX_CATCHUP_MINUTES after).
      const batchMinuteOfDay = batchHour * 60 + batchMinute
      const currentMinuteOfDay = currentHour * 60 + currentMinute
      let minutesSinceBatch = currentMinuteOfDay - batchMinuteOfDay

      // Handle day wrap (e.g., batch at 23:50, current time 00:10 = 20 min ago)
      if (minutesSinceBatch < -720) minutesSinceBatch += 1440

      const isInNormalWindow = minutesSinceBatch >= 0 && minutesSinceBatch < 15
      const isInCatchupWindow = minutesSinceBatch >= 15 && minutesSinceBatch < MAX_CATCHUP_MINUTES
      let isCatchupRun = false

      if (!isInNormalWindow && !isInCatchupWindow) {
        allResults.push({ slug, locationId: loc.id, skipped: true, reason: 'outside_batch_window' })
        continue
      }

      if (isInCatchupWindow) {
        // Catch-up mode: the normal window was missed. executeEodReset() has
        // its own idempotency check (AuditLog lookup), so if EOD already ran
        // today this will short-circuit with alreadyRanToday=true. We only
        // proceed here to cover the case where it genuinely didn't run.
        isCatchupRun = true
        console.log(
          `[cron:eod-batch-close] ${slug} location ${loc.id}: ` +
          `catch-up mode — ${minutesSinceBatch} min after scheduled batch time ${batchCloseTime}`
        )
      }

      // ── Race protection: wait for active payment flows to finish ─────────
      // If a terminal is mid-payment (tabStatus='closing' or 'pending_auth'),
      // or has a Payment record in 'pending'/'processing' state, wait briefly
      // for it to complete. This prevents double-settlement.
      let activeClosings = await countActivelyClosingOrders(venueDb, loc.id)
      let pendingPayments = await countOrdersWithPendingPayments(venueDb, loc.id)
      const totalBlocking = activeClosings + pendingPayments

      if (totalBlocking > 0) {
        const waitStart = Date.now()
        while (
          (activeClosings + pendingPayments) > 0 &&
          (Date.now() - waitStart) < ACTIVE_PAYMENT_WAIT_MS
        ) {
          await new Promise(resolve => setTimeout(resolve, ACTIVE_PAYMENT_POLL_MS))
          activeClosings = await countActivelyClosingOrders(venueDb, loc.id)
          pendingPayments = await countOrdersWithPendingPayments(venueDb, loc.id)
        }

        if ((activeClosings + pendingPayments) > 0) {
          // Still have active closings after waiting — log warning but proceed.
          // executeEodReset's per-tab FOR UPDATE will handle the actual row locking;
          // we just wanted to avoid the common case of overlap.
          console.warn(
            `[cron:eod-batch-close] ${slug} location ${loc.id}: ` +
            `${activeClosings} tab(s) closing, ${pendingPayments} pending payment(s) ` +
            `after ${ACTIVE_PAYMENT_WAIT_MS}ms wait — proceeding with caution`
          )
        }
      }

      // ── Execute EOD with pre-flight lock diagnostics ─────────────────────
      // Run a FOR UPDATE SKIP LOCKED probe to see how many tabs are actually
      // lockable (not held by another transaction). This is diagnostic — the
      // real row locking happens inside executeEodReset's per-tab $transaction
      // which already uses FOR UPDATE on each order row.
      try {
        const preflight = await preflightTabLockCheck(venueDb, loc.id)

        if (preflight.totalOpen > 0 && preflight.lockable < preflight.totalOpen) {
          console.warn(
            `[cron:eod-batch-close] ${slug} location ${loc.id}: ` +
            `${preflight.totalOpen} open tabs, only ${preflight.lockable} lockable ` +
            `(${preflight.totalOpen - preflight.lockable} held by concurrent transactions)`
          )
        }

        const result = await executeEodReset({
          locationId: loc.id,
          triggeredBy: 'cron',
        })

        if (result.alreadyRanToday) {
          allResults.push({
            slug,
            locationId: loc.id,
            skipped: true,
            reason: 'already_ran_today',
            ...(isCatchupRun ? { catchupAttempt: true, minutesSinceBatch } : {}),
          })
          continue
        }

        allResults.push({
          slug,
          locationId: loc.id,
          ...(isCatchupRun ? { catchupRun: true, minutesSinceBatch } : {}),
          preflightLockable: preflight.lockable,
          preflightTotalOpen: preflight.totalOpen,
          activeClosingsAtStart: totalBlocking,
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

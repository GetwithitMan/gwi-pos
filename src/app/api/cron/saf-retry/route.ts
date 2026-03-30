import { NextRequest } from 'next/server'
import { Prisma, type PrismaClient } from '@/generated/prisma/client'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { requireDatacapClient } from '@/lib/datacap/helpers'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Advisory lock key for SAF retry cron. Prevents overlapping runs on the same
 * venue database (e.g., if the previous invocation is still processing).
 * Uses a fixed large integer derived from hashing "saf-retry-cron".
 */
const SAF_RETRY_LOCK_KEY = 839_274_651

/** Payments must be at least this old before we retry (avoid racing with in-progress uploads) */
const MIN_AGE_MINUTES = 5

/** Maximum retry attempts before marking NEEDS_ATTENTION */
const MAX_RETRIES = 10

/** Max readers to process per venue per cron invocation */
const MAX_READERS_PER_VENUE = 20

/**
 * Parse the retry count from the safError field.
 * We store retry metadata as a JSON prefix: `{"retryCount":N}|actual error message`
 * This avoids a schema migration while keeping the retry count persistent.
 */
function parseRetryCount(safError: string | null): number {
  if (!safError) return 0
  try {
    // Format: {"retryCount":N}|error message
    const pipeIdx = safError.indexOf('|')
    if (pipeIdx === -1) return 0
    const meta = JSON.parse(safError.slice(0, pipeIdx))
    return typeof meta.retryCount === 'number' ? meta.retryCount : 0
  } catch {
    // Not in our format — this is a first-time failure from the original forward
    return 0
  }
}

/**
 * Encode the retry count + error message into the safError field.
 */
function encodeRetryError(retryCount: number, errorMessage: string): string {
  return `${JSON.stringify({ retryCount })}|${errorMessage}`
}

interface PendingReader {
  readerId: string
  locationId: string
  paymentCount: number
}

/**
 * GET /api/cron/saf-retry
 * Automatic SAF upload retry cron — runs every 5 minutes.
 *
 * Retries failed SAF uploads that couldn't be forwarded to the payment processor.
 * SAF (Store-and-Forward) transactions are card payments approved offline by the
 * reader. They MUST eventually be uploaded to the processor for settlement.
 *
 * Targets:
 *   - safStatus = 'UPLOAD_FAILED' — previous forward attempt failed
 *   - safStatus = 'APPROVED_SAF_PENDING_UPLOAD' — never attempted (older than 5 min)
 *
 * Groups by paymentReaderId (each reader has its own SAF queue on the device).
 * For each reader: calls client.safForwardAll(readerId) to upload stored transactions.
 *
 * After MAX_RETRIES (10) failures, marks payments as 'NEEDS_ATTENTION' for manual
 * intervention (reader may be offline, misconfigured, or removed).
 *
 * Idempotent and safe to run every 5 minutes. Uses pg_try_advisory_lock to prevent
 * concurrent execution on the same venue.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const cutoff = new Date(now.getTime() - MIN_AGE_MINUTES * 60 * 1000)
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb: PrismaClient, slug: string) => {
    // ── Concurrency guard: try advisory lock, skip if another run is active ──
    const lockResult = await venueDb.$queryRaw<[{ acquired: boolean }]>(
      Prisma.sql`SELECT pg_try_advisory_lock(${SAF_RETRY_LOCK_KEY}) as acquired`
    )
    if (!lockResult[0]?.acquired) {
      allResults.push({ slug, skipped: true, reason: 'concurrent_run_active' })
      return
    }

    try {
      // ── Query readers with pending SAF uploads ──────────────────────────
      // Find distinct readers that have retryable payments older than the cutoff.
      // APPROVED_SAF_PENDING_UPLOAD: never forwarded (missed by EOD or manual forward)
      // UPLOAD_FAILED: previously attempted but failed
      const pendingReaders = await venueDb.$queryRaw<PendingReader[]>(Prisma.sql`
        SELECT
          p."paymentReaderId" as "readerId",
          o."locationId" as "locationId",
          COUNT(*)::int as "paymentCount"
        FROM "Payment" p
        INNER JOIN "Order" o ON o.id = p."orderId"
        WHERE p."safStatus" IN ('UPLOAD_FAILED', 'APPROVED_SAF_PENDING_UPLOAD')
          AND p."paymentReaderId" IS NOT NULL
          AND p."deletedAt" IS NULL
          AND o."deletedAt" IS NULL
          AND p."updatedAt" < ${cutoff}
        GROUP BY p."paymentReaderId", o."locationId"
        ORDER BY MIN(p."createdAt") ASC
        LIMIT ${MAX_READERS_PER_VENUE}
      `)

      if (pendingReaders.length === 0) {
        allResults.push({ slug, skipped: true, reason: 'no_pending_saf' })
        return
      }

      console.log(
        `[cron:saf-retry] ${slug}: Found ${pendingReaders.length} reader(s) with pending SAF uploads`
      )

      let totalForwarded = 0
      let totalFailed = 0
      let totalNeedsAttention = 0
      let totalPaymentsUpdated = 0
      const readerResults: Record<string, unknown>[] = []

      for (const reader of pendingReaders) {
        try {
          // ── Check retry counts before attempting forward ─────────────────
          // Load the payments for this reader to check individual retry counts.
          // Payments that have exceeded MAX_RETRIES get marked NEEDS_ATTENTION
          // without hitting the processor again.
          const payments = await venueDb.$queryRaw<Array<{
            id: string
            safStatus: string
            safError: string | null
          }>>(Prisma.sql`
            SELECT p.id, p."safStatus", p."safError"
            FROM "Payment" p
            INNER JOIN "Order" o ON o.id = p."orderId"
            WHERE p."paymentReaderId" = ${reader.readerId}
              AND o."locationId" = ${reader.locationId}
              AND p."safStatus" IN ('UPLOAD_FAILED', 'APPROVED_SAF_PENDING_UPLOAD')
              AND p."paymentReaderId" IS NOT NULL
              AND p."deletedAt" IS NULL
              AND o."deletedAt" IS NULL
              AND p."updatedAt" < ${cutoff}
            FOR UPDATE SKIP LOCKED
          `)

          if (payments.length === 0) continue // All locked by another process

          // ── Separate exhausted payments from retryable ones ─────────────
          const exhaustedIds: string[] = []
          const retryableIds: string[] = []
          let maxRetryCountSeen = 0

          for (const p of payments) {
            const retryCount = parseRetryCount(p.safError)
            if (retryCount > maxRetryCountSeen) maxRetryCountSeen = retryCount
            if (retryCount >= MAX_RETRIES) {
              exhaustedIds.push(p.id)
            } else {
              retryableIds.push(p.id)
            }
          }

          // ── Mark exhausted payments as NEEDS_ATTENTION ──────────────────
          if (exhaustedIds.length > 0) {
            await venueDb.$executeRaw(Prisma.sql`
              UPDATE "Payment"
              SET "safStatus" = 'NEEDS_ATTENTION',
                  "updatedAt" = NOW(),
                  "lastMutatedBy" = ${process.env.VERCEL ? 'cloud' : 'local'}
              WHERE id = ANY(${exhaustedIds})
            `)
            totalNeedsAttention += exhaustedIds.length
            totalPaymentsUpdated += exhaustedIds.length
            console.warn(
              `[cron:saf-retry] ${slug}: Marked ${exhaustedIds.length} payment(s) as NEEDS_ATTENTION ` +
              `for reader ${reader.readerId} (exceeded ${MAX_RETRIES} retries)`
            )
          }

          // ── Attempt SAF forward for retryable payments ──────────────────
          if (retryableIds.length === 0) {
            readerResults.push({
              readerId: reader.readerId,
              locationId: reader.locationId,
              needsAttention: exhaustedIds.length,
              forwarded: 0,
              retryable: 0,
            })
            continue
          }

          const client = await requireDatacapClient(reader.locationId)
          const response = await client.safForwardAll(reader.readerId)
          const success = response.cmdStatus === 'Success'
          const safForwarded = parseInt(response.safForwarded || '0', 10)

          if (success) {
            // ── Success: update all retryable payments to UPLOAD_SUCCESS ──
            await venueDb.$executeRaw(Prisma.sql`
              UPDATE "Payment"
              SET "safStatus" = 'UPLOAD_SUCCESS',
                  "safUploadedAt" = NOW(),
                  "safError" = NULL,
                  "updatedAt" = NOW(),
                  "lastMutatedBy" = ${process.env.VERCEL ? 'cloud' : 'local'}
              WHERE id = ANY(${retryableIds})
            `)
            totalForwarded += retryableIds.length
            totalPaymentsUpdated += retryableIds.length
            console.log(
              `[cron:saf-retry] ${slug}: SAF forward success for reader ${reader.readerId} ` +
              `— ${safForwarded} forwarded, ${retryableIds.length} payment(s) updated`
            )

            readerResults.push({
              readerId: reader.readerId,
              locationId: reader.locationId,
              success: true,
              safForwarded,
              paymentsUpdated: retryableIds.length,
              needsAttention: exhaustedIds.length,
            })
          } else {
            // ── Failure: increment retry count, record error ──────────────
            const errorMessage = response.textResponse || response.cmdStatus || 'SAF forward failed'
            const newRetryCount = maxRetryCountSeen + 1
            const encodedError = encodeRetryError(newRetryCount, errorMessage)

            await venueDb.$executeRaw(Prisma.sql`
              UPDATE "Payment"
              SET "safStatus" = 'UPLOAD_FAILED',
                  "safError" = ${encodedError},
                  "updatedAt" = NOW(),
                  "lastMutatedBy" = ${process.env.VERCEL ? 'cloud' : 'local'}
              WHERE id = ANY(${retryableIds})
            `)
            totalFailed += retryableIds.length
            totalPaymentsUpdated += retryableIds.length
            console.warn(
              `[cron:saf-retry] ${slug}: SAF forward failed for reader ${reader.readerId} ` +
              `(retry ${newRetryCount}/${MAX_RETRIES}): ${errorMessage}`
            )

            readerResults.push({
              readerId: reader.readerId,
              locationId: reader.locationId,
              success: false,
              error: errorMessage,
              retryCount: newRetryCount,
              paymentsAffected: retryableIds.length,
              needsAttention: exhaustedIds.length,
            })
          }
        } catch (readerErr) {
          totalFailed += reader.paymentCount
          const errMsg = readerErr instanceof Error ? readerErr.message : 'Unknown error'
          console.error(
            `[cron:saf-retry] ${slug}: Error processing reader ${reader.readerId}: ${errMsg}`
          )
          readerResults.push({
            readerId: reader.readerId,
            locationId: reader.locationId,
            error: errMsg,
          })
        }
      }

      // Trigger upstream sync if any payments were updated
      if (totalPaymentsUpdated > 0) {
        pushUpstream()
      }

      allResults.push({
        slug,
        readers: pendingReaders.length,
        forwarded: totalForwarded,
        failed: totalFailed,
        needsAttention: totalNeedsAttention,
        paymentsUpdated: totalPaymentsUpdated,
        readerResults,
      })
    } finally {
      // ── Always release the advisory lock ────────────────────────────────
      await venueDb.$queryRaw(
        Prisma.sql`SELECT pg_advisory_unlock(${SAF_RETRY_LOCK_KEY})`
      ).catch(err => {
        console.warn(`[cron:saf-retry] ${slug}: Failed to release advisory lock:`, err)
      })
    }
  }, { label: 'cron:saf-retry' })

  return ok({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}

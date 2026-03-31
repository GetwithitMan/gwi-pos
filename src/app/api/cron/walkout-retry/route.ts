import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { processWalkoutRetry } from '@/lib/domain/datacap/walkout-retry-service'
import type { PrismaClient } from '@/generated/prisma/client'
import { ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/walkout-retry
 * Automatic walkout retry cron — runs every 6 hours.
 *
 * Queries WalkoutRetry records where status='pending', nextRetryAt <= NOW(),
 * and retryCount < maxRetries. For each, calls the shared processWalkoutRetry
 * service which handles Datacap preAuthCapture, Payment creation, and
 * exponential backoff on failure.
 *
 * Card authorization holds expire in ~30 days — without this cron,
 * walkout revenue is lost if staff forgets to manually retry.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb: PrismaClient, slug: string) => {
    // Query pending retries that are due for processing.
    // Uses raw SQL because Prisma can't compare two columns (retryCount < maxRetries).
    const dueRetries = await venueDb.$queryRaw<Array<{
      id: string
      retryCount: number
      maxRetries: number
      amount: unknown
      locationId: string
      orderId: string
    }>>`SELECT id, "retryCount", "maxRetries", amount, "locationId", "orderId"
       FROM "WalkoutRetry"
       WHERE status = 'pending'
         AND "deletedAt" IS NULL
         AND "nextRetryAt" <= ${now}
         AND "retryCount" < "maxRetries"
       ORDER BY "nextRetryAt" ASC
       LIMIT 50`

    if (dueRetries.length === 0) {
      allResults.push({ slug, skipped: true, reason: 'no_pending_retries' })
      return
    }

    console.log(`[cron:walkout-retry] ${slug}: Processing ${dueRetries.length} pending walkout retry(ies)`)

    let collected = 0
    let failed = 0
    let exhausted = 0

    for (const retry of dueRetries) {
      try {
        // Acquire row-level lock to prevent double-processing on NUC restart
        const locked = await venueDb.$queryRaw<Array<{ id: string }>>`SELECT id FROM "WalkoutRetry" WHERE id = ${retry.id} AND status = ${'pending'} FOR UPDATE SKIP LOCKED`
        if (locked.length === 0) continue // Another process has it or status changed

        const result = await processWalkoutRetry(retry.id)

        if (result.success) {
          collected++
          console.log(
            `[cron:walkout-retry] ${slug}: Collected $${Number(retry.amount).toFixed(2)} ` +
            `for order ${retry.orderId} (retry ${retry.id})`
          )
        } else if (result.status === 'exhausted') {
          exhausted++
          console.warn(
            `[cron:walkout-retry] ${slug}: Exhausted retries for order ${retry.orderId} ` +
            `(retry ${retry.id}, count=${retry.retryCount}/${retry.maxRetries})`
          )
        } else {
          failed++
          console.log(
            `[cron:walkout-retry] ${slug}: Retry failed for order ${retry.orderId} ` +
            `(retry ${retry.id}): ${typeof result.error === 'string' ? result.error : result.error?.message || 'Unknown'}`
          )
        }
      } catch (err) {
        failed++
        console.error(
          `[cron:walkout-retry] ${slug}: Unexpected error processing retry ${retry.id}:`,
          err
        )
      }
    }

    allResults.push({
      slug,
      total: dueRetries.length,
      collected,
      failed,
      exhausted,
    })
  }, { label: 'cron:walkout-retry' })

  return ok({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}

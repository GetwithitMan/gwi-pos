/**
 * CardDetection Retention — Two-phase cleanup cron.
 *
 * Phase 1: Scrub recordNo on rows older than 24h (keep metadata for diagnostics)
 * Phase 2: Delete rows older than 30 days
 *
 * Runs nightly via cron. Uses server time (NOW()) as authoritative.
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('detection-cleanup')

export async function cleanupCardDetections(): Promise<{ scrubbed: number; deleted: number }> {
  // Phase 1: Scrub recordNo on rows older than 24h
  const scrubResult = await db.$executeRawUnsafe(
    `UPDATE "CardDetection" SET "recordNo" = NULL WHERE "createdAt" < NOW() - INTERVAL '24 hours' AND "recordNo" IS NOT NULL`
  )

  // Phase 2: Delete rows older than 30 days
  const deleteResult = await db.$executeRawUnsafe(
    `DELETE FROM "CardDetection" WHERE "createdAt" < NOW() - INTERVAL '30 days'`
  )

  log.info({ scrubbed: scrubResult, deleted: deleteResult }, 'CardDetection cleanup complete')

  return { scrubbed: scrubResult, deleted: deleteResult }
}

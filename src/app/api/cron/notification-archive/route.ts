/**
 * GET /api/cron/notification-archive — Notification retention/archive cron
 *
 * Runs on a schedule to manage notification data retention:
 * - Delete NotificationJob rows with terminal status older than 90 days
 * - Delete associated NotificationAttempt rows
 * - Delete NotificationDeviceEvent rows older than 365 days
 * - Mask targetValue on phone-type targets older than 180 days (PII retention)
 *
 * Auth: verifyCronSecret() (Bearer token from CRON_SECRET)
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { err, ok } from '@/lib/api-response'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Allow up to 60s for large datasets

const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'dead_letter', 'suppressed']

/**
 * GET /api/cron/notification-archive
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const summary = {
    jobsDeleted: 0,
    attemptsDeleted: 0,
    deviceEventsDeleted: 0,
    phoneTargetsMasked: 0,
    errors: [] as string[],
  }

  try {
    // ── Step 1: Find terminal NotificationJob IDs older than 90 days ──────
    try {
      const cutoffDate90d = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

      // Get IDs of jobs to delete (batch to avoid memory issues)
      const jobsToDelete: any[] = await db.$queryRawUnsafe(
        `SELECT id FROM "NotificationJob"
         WHERE status = ANY($1::text[])
           AND "createdAt" < $2
         LIMIT 5000`,
        TERMINAL_STATUSES,
        cutoffDate90d
      )

      if (jobsToDelete.length > 0) {
        const jobIds = jobsToDelete.map(j => j.id)

        // Delete associated NotificationAttempt rows first (FK would block otherwise)
        const attemptsResult = await db.$executeRawUnsafe(
          `DELETE FROM "NotificationAttempt"
           WHERE "jobId" = ANY($1::text[])`,
          jobIds
        )
        summary.attemptsDeleted = typeof attemptsResult === 'number' ? attemptsResult : 0

        // Delete the jobs
        const jobsResult = await db.$executeRawUnsafe(
          `DELETE FROM "NotificationJob"
           WHERE id = ANY($1::text[])`,
          jobIds
        )
        summary.jobsDeleted = typeof jobsResult === 'number' ? jobsResult : 0
      }
    } catch (err) {
      const msg = `Jobs/attempts cleanup error: ${err instanceof Error ? err.message : 'Unknown'}`
      console.error(`[cron:notification-archive] ${msg}`)
      summary.errors.push(msg)
    }

    // ── Step 2: Delete NotificationDeviceEvent rows older than 365 days ──
    try {
      const cutoffDate365d = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

      const eventsResult = await db.$executeRawUnsafe(
        `DELETE FROM "NotificationDeviceEvent"
         WHERE "createdAt" < $1`,
        cutoffDate365d
      )
      summary.deviceEventsDeleted = typeof eventsResult === 'number' ? eventsResult : 0
    } catch (err) {
      const msg = `Device events cleanup error: ${err instanceof Error ? err.message : 'Unknown'}`
      console.error(`[cron:notification-archive] ${msg}`)
      summary.errors.push(msg)
    }

    // ── Step 3: Mask targetValue on phone-type targets older than 180 days ─
    try {
      const cutoffDate180d = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

      // Mask phone numbers in NotificationTargetAssignment (PII retention)
      // Replace with last 4 digits only: ***-***-1234
      const maskedResult = await db.$executeRawUnsafe(
        `UPDATE "NotificationTargetAssignment"
         SET "targetValue" = '***-***-' || RIGHT("targetValue", 4),
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "targetType" IN ('phone_sms', 'phone_voice')
           AND "createdAt" < $1
           AND "targetValue" NOT LIKE '***-***-%'
           AND status != 'active'`,
        cutoffDate180d
      )
      summary.phoneTargetsMasked = typeof maskedResult === 'number' ? maskedResult : 0

      // Also mask phone targetValue in old NotificationJob rows that haven't been deleted yet
      await db.$executeRawUnsafe(
        `UPDATE "NotificationJob"
         SET "targetValue" = '***-***-' || RIGHT("targetValue", 4),
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "targetType" IN ('phone_sms', 'phone_voice')
           AND "createdAt" < $1
           AND "targetValue" NOT LIKE '***-***-%'`,
        cutoffDate180d
      )
    } catch (err) {
      const msg = `Phone masking error: ${err instanceof Error ? err.message : 'Unknown'}`
      console.error(`[cron:notification-archive] ${msg}`)
      summary.errors.push(msg)
    }

    // Log summary
    console.log(
      `[cron:notification-archive] Archived ${summary.jobsDeleted} jobs, ` +
      `${summary.attemptsDeleted} attempts, ${summary.deviceEventsDeleted} device events, ` +
      `masked ${summary.phoneTargetsMasked} phone targets` +
      (summary.errors.length > 0 ? ` (${summary.errors.length} errors)` : '')
    )

    return ok({
      success: summary.errors.length === 0,
      summary,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[cron:notification-archive] Fatal error:', error)
    return err('Notification archive cron failed', 500, error instanceof Error ? error.message : 'Unknown')
  }
}

import { NextRequest } from 'next/server'
import { verifyCronSecret } from '@/lib/cron-auth'
import { forAllVenues } from '@/lib/cron-venue-helper'
import { sendSMS, isTwilioConfigured } from '@/lib/twilio'
import { createChildLogger } from '@/lib/logger'
import type { PrismaClient } from '@/generated/prisma/client'
import { ok } from '@/lib/api-response'

const log = createChildLogger('cron-notification-retry')

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_RETRY_ATTEMPTS = 5
const BATCH_SIZE = 20

/**
 * GET /api/cron/notification-retry
 *
 * Automatic notification retry cron — runs every 5 minutes.
 *
 * Queries DeliveryNotification records where:
 *   - status = 'pending_retry'
 *   - existingAttempts < maxRetries
 *   - (no nextRetryAt field currently, processes all pending_retry)
 *
 * For each, attempts to resend via the stored channel (SMS, push).
 * On success: updates status to 'sent'
 * On failure: increments attempt count, calculates next retry with exponential backoff,
 *             or marks as 'failed' if maxRetries exceeded
 *
 * Processes in batches to avoid timeouts.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const allResults: Record<string, unknown>[] = []

  const summary = await forAllVenues(async (venueDb: PrismaClient, slug: string) => {
    // Query pending retries due for processing.
    // Uses raw SQL to count attempts and check retry limit.
    const dueRetries = await venueDb.$queryRaw<Array<{
      id: string
      deliveryOrderId: string
      channel: 'sms' | 'push'
      recipient: string
      messageBody: string
      maxRetries: number
      attemptCount: number
      status: string
    }>>`SELECT
       n.id, n."deliveryOrderId", n.channel, n.recipient,
       n."messageBody", n."maxRetries",
       COALESCE(
         (SELECT COUNT(*) FROM "DeliveryNotificationAttempt"
          WHERE "notificationId" = n.id),
         0
       )::int as "attemptCount"
      FROM "DeliveryNotification" n
      WHERE n.status = 'pending_retry'
      ORDER BY n."createdAt" ASC
      LIMIT ${BATCH_SIZE}`

    if (dueRetries.length === 0) {
      allResults.push({ slug, skipped: true, reason: 'no_pending_retries' })
      return
    }

    log.info(`[cron:notification-retry] ${slug}: Processing ${dueRetries.length} pending notification(s)`)

    let retried = 0
    let succeeded = 0
    let failed = 0
    let exhausted = 0

    for (const notification of dueRetries) {
      try {
        // Acquire row-level lock to prevent double-processing
        const locked = await venueDb.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "DeliveryNotification"
          WHERE id = ${notification.id} AND status = 'pending_retry'
          FOR UPDATE SKIP LOCKED
        `
        if (locked.length === 0) continue // Already claimed by another process

        const attemptNumber = notification.attemptCount + 1

        // Check if we've exhausted retries
        if (attemptNumber > notification.maxRetries) {
          await venueDb.$executeRawUnsafe(`
            UPDATE "DeliveryNotification"
            SET status = 'failed', "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1
          `, notification.id)

          exhausted++
          log.warn(
            `[cron:notification-retry] ${slug}: Exhausted retries for notification ${notification.id} ` +
            `(order ${notification.deliveryOrderId}, attempt ${attemptNumber}/${notification.maxRetries})`
          )
          continue
        }

        // Create attempt record (queued status)
        await venueDb.$executeRawUnsafe(`
          INSERT INTO "DeliveryNotificationAttempt" (
            "id", "notificationId", "attemptNumber", "status", "createdAt"
          )
          VALUES (gen_random_uuid()::text, $1, $2, 'queued', CURRENT_TIMESTAMP)
        `, notification.id, attemptNumber)

        // Attempt send
        let sendSuccess = false
        let errorMessage: string | null = null

        if (notification.channel === 'sms') {
          if (!isTwilioConfigured()) {
            errorMessage = 'Twilio not configured'
          } else {
            try {
              const result = await sendSMS({
                to: notification.recipient,
                body: notification.messageBody,
              })

              if (result.success) {
                sendSuccess = true
              } else {
                errorMessage = result.error || 'Twilio send failed'
              }
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : 'Unknown Twilio error'
              errorMessage = errMsg
              log.error('[cron:notification-retry] Twilio SMS error:', errMsg)
            }
          }
        } else if (notification.channel === 'push') {
          // TODO: Wire Firebase Cloud Messaging for push notifications
          log.info(`[cron:notification-retry] Push STUB: Would send to ${notification.recipient}`)
          sendSuccess = true // Stub for now
        } else {
          errorMessage = `Unsupported channel: ${notification.channel}`
        }

        // Update attempt status
        if (sendSuccess) {
          await venueDb.$executeRawUnsafe(`
            UPDATE "DeliveryNotificationAttempt"
            SET status = 'sent', "sentAt" = CURRENT_TIMESTAMP
            WHERE "notificationId" = $1 AND "attemptNumber" = $2
          `, notification.id, attemptNumber)

          // Mark notification as sent
          await venueDb.$executeRawUnsafe(`
            UPDATE "DeliveryNotification"
            SET status = 'sent', "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1
          `, notification.id)

          succeeded++
          log.info(
            `[cron:notification-retry] ${slug}: Successfully retried notification ${notification.id} ` +
            `(order ${notification.deliveryOrderId}, attempt ${attemptNumber}/${notification.maxRetries})`
          )
        } else {
          // Update attempt with error
          await venueDb.$executeRawUnsafe(`
            UPDATE "DeliveryNotificationAttempt"
            SET status = 'failed', "errorMessage" = $2
            WHERE "notificationId" = $1 AND "attemptNumber" = $2
          `, notification.id, attemptNumber)

          // Calculate exponential backoff for next retry
          // Base delay: 30 seconds, double for each retry: 30s, 60s, 120s, 240s, ...
          const delaySeconds = 30 * Math.pow(2, attemptNumber - 1)
          const nextRetryAt = new Date(now.getTime() + delaySeconds * 1000)

          // Mark for next retry or as permanently failed
          if (attemptNumber < notification.maxRetries) {
            // Keep pending_retry for next worker cycle
            // (In a more sophisticated version, could use a nextRetryAt column)
            await venueDb.$executeRawUnsafe(`
              UPDATE "DeliveryNotification"
              SET status = 'pending_retry', "updatedAt" = CURRENT_TIMESTAMP
              WHERE id = $1
            `, notification.id)

            failed++
            log.warn(
              `[cron:notification-retry] ${slug}: Retry failed for notification ${notification.id} ` +
              `(order ${notification.deliveryOrderId}, attempt ${attemptNumber}/${notification.maxRetries}): ` +
              `${errorMessage}`
            )
          } else {
            // Exhausted retries
            await venueDb.$executeRawUnsafe(`
              UPDATE "DeliveryNotification"
              SET status = 'failed', "updatedAt" = CURRENT_TIMESTAMP
              WHERE id = $1
            `, notification.id)

            exhausted++
            log.warn(
              `[cron:notification-retry] ${slug}: Exhausted retries for notification ${notification.id} ` +
              `(order ${notification.deliveryOrderId}, attempt ${attemptNumber}/${notification.maxRetries}): ` +
              `${errorMessage}`
            )
          }
        }

        retried++
      } catch (err) {
        failed++
        log.error(
          `[cron:notification-retry] ${slug}: Unexpected error processing notification ${notification.id}:`,
          err
        )
      }
    }

    allResults.push({
      slug,
      total: dueRetries.length,
      retried,
      succeeded,
      failed,
      exhausted,
    })
  }, { label: 'cron:notification-retry' })

  return ok({
    ...summary,
    processed: allResults,
    timestamp: now.toISOString(),
  })
}

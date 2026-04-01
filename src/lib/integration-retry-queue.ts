/**
 * Integration Retry Queue — database-backed retry for failed third-party API calls.
 *
 * Usage:
 *   await queueRetry(locationId, '7shifts', 'time_punch_create', { userId, clockIn, ... })
 *   await queueRetry(locationId, 'twilio', 'sms_send', { to, body, ... })
 *
 * A cron worker (POST /api/cron/integration-retry) drains pending entries with
 * exponential backoff (5s, 30s, 2m, 10m, 1h). Dead-lettered after 5 attempts.
 */

import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('integration-retry')

const BACKOFF_DELAYS_MS = [
  5_000,       // 5 seconds
  30_000,      // 30 seconds
  2 * 60_000,  // 2 minutes
  10 * 60_000, // 10 minutes
  60 * 60_000, // 1 hour
]

/**
 * Queue a failed integration call for retry.
 */
export async function queueRetry(
  locationId: string,
  integration: string,
  action: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db.integrationRetryEntry.create({
      data: {
        locationId,
        integration,
        action,
        payload: payload as any,
        nextRetryAt: new Date(Date.now() + BACKOFF_DELAYS_MS[0]),
      },
    })
    log.info({ locationId, integration, action }, 'Queued integration retry')
  } catch (err) {
    log.error({ err, locationId, integration, action }, 'Failed to queue integration retry')
  }
}

/**
 * Process pending retry entries. Called by cron worker.
 * Returns count of processed entries.
 */
export async function processRetryQueue(): Promise<{ processed: number; succeeded: number; failed: number; deadLettered: number }> {
  const stats = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0 }

  const entries = await db.integrationRetryEntry.findMany({
    where: {
      status: 'pending',
      nextRetryAt: { lte: new Date() },
    },
    orderBy: { nextRetryAt: 'asc' },
    take: 50, // Process max 50 per cron run
  })

  for (const entry of entries) {
    stats.processed++

    // Mark as processing (optimistic lock)
    await db.integrationRetryEntry.update({
      where: { id: entry.id },
      data: { status: 'processing' },
    })

    try {
      await executeRetry(entry.integration, entry.action, entry.payload as Record<string, unknown>, entry.locationId)

      // Success — mark completed
      await db.integrationRetryEntry.update({
        where: { id: entry.id },
        data: { status: 'completed', completedAt: new Date() },
      })
      stats.succeeded++
    } catch (err) {
      const nextRetry = entry.retryCount + 1
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      if (nextRetry >= entry.maxRetries) {
        // Dead letter — max retries exceeded
        await db.integrationRetryEntry.update({
          where: { id: entry.id },
          data: { status: 'dead_letter', lastError: errorMessage, retryCount: nextRetry },
        })
        log.error({ entryId: entry.id, integration: entry.integration, action: entry.action, retryCount: nextRetry }, 'Integration retry dead-lettered')
        stats.deadLettered++
      } else {
        // Schedule next retry with backoff
        const delayMs = BACKOFF_DELAYS_MS[Math.min(nextRetry, BACKOFF_DELAYS_MS.length - 1)]
        await db.integrationRetryEntry.update({
          where: { id: entry.id },
          data: {
            status: 'pending',
            lastError: errorMessage,
            retryCount: nextRetry,
            nextRetryAt: new Date(Date.now() + delayMs),
          },
        })
        stats.failed++
      }
    }
  }

  if (stats.processed > 0) {
    log.info(stats, 'Integration retry queue processed')
  }

  return stats
}

/**
 * Execute a retry for a specific integration + action.
 * Throws on failure (caller handles retry scheduling).
 */
async function executeRetry(
  integration: string,
  action: string,
  payload: Record<string, unknown>,
  locationId: string,
): Promise<void> {
  switch (integration) {
    case '7shifts': {
      const sevenShifts = await import('@/lib/7shifts-client')
      const { parseSettings } = await import('@/lib/settings')
      const { getLocationSettings } = await import('@/lib/location-cache')
      const locSettings = parseSettings(await getLocationSettings(locationId))
      const settings = locSettings.sevenShifts
      if (!settings?.clientId) throw new Error('7shifts not configured for this location')

      switch (action) {
        case 'time_punch_create':
          await sevenShifts.createTimePunch(settings, locationId, payload as any)
          break
        case 'receipt_create':
          await sevenShifts.createReceipt(settings, locationId, payload as any)
          break
        default:
          throw new Error(`Unknown 7shifts action: ${action}`)
      }
      break
    }

    case 'twilio': {
      const { sendSMS } = await import('@/lib/twilio')
      switch (action) {
        case 'sms_send': {
          const result = await sendSMS({ to: payload.to as string, body: payload.body as string })
          if (!result.success) throw new Error(result.error || 'SMS send failed')
          break
        }
        default:
          throw new Error(`Unknown twilio action: ${action}`)
      }
      break
    }

    default:
      throw new Error(`Unknown integration: ${integration}`)
  }
}

import { createHmac } from 'crypto'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cloud-events')

const MAX_QUEUE_SIZE = 1000
const RETRY_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 3_600_000
const DEFAULT_MAX_ATTEMPTS = 5

let workerInterval: ReturnType<typeof setInterval> | null = null

export async function queueCloudEvent(
  eventId: string,
  venueId: string,
  locationId: string,
  eventType: string,
  body: string,
): Promise<void> {
  try {
    await db.cloudEventQueue.create({
      data: {
        id: eventId,
        venueId,
        locationId,
        eventType,
        body: JSON.parse(body),
        status: 'pending',
        maxAttempts: DEFAULT_MAX_ATTEMPTS,
      },
    })

    // Scope cleanup to this venue's events only (prevents cross-tenant deletion)
    const count = await db.cloudEventQueue.count({ where: { locationId } })
    if (count > MAX_QUEUE_SIZE) {
      const oldest = await db.cloudEventQueue.findMany({
        where: { locationId },
        orderBy: { createdAt: 'asc' },
        take: count - MAX_QUEUE_SIZE,
        select: { id: true },
      })
      await db.cloudEventQueue.deleteMany({
        where: { id: { in: oldest.map(e => e.id) }, locationId },
      })
    }
  } catch (error) {
    log.error({ err: error, eventId }, 'Failed to queue event')
  }
}

async function processQueue(): Promise<void> {
  const cloudUrl = process.env.MISSION_CONTROL_URL || process.env.BACKOFFICE_API_URL
  if (!process.env.MISSION_CONTROL_URL && process.env.BACKOFFICE_API_URL) {
    console.warn('[DEPRECATED] Using BACKOFFICE_API_URL — migrate to MISSION_CONTROL_URL')
  }
  if (!cloudUrl) return

  try {
    const events = await db.cloudEventQueue.findMany({
      where: {
        status: { in: ['pending', 'failed'] },
        nextRetryAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    })

    for (const event of events) {
      // Check if max attempts exceeded -- move to dead_letter
      if (event.attempts >= event.maxAttempts) {
        await db.cloudEventQueue.update({
          where: { id: event.id },
          data: {
            status: 'dead_letter',
            lastError: event.lastError || 'Max attempts exceeded',
          },
        })
        log.error({ id: event.id, eventType: event.eventType, attempts: event.attempts }, 'Dead-lettered')
        continue
      }

      // Mark as processing
      await db.cloudEventQueue.update({
        where: { id: event.id },
        data: { status: 'processing' },
      })

      const bodyString = JSON.stringify(event.body)
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Server-Node-Id': process.env.SERVER_NODE_ID || '',
      }

      if (process.env.SERVER_API_KEY) {
        headers['X-Request-Signature'] = createHmac('sha256', process.env.SERVER_API_KEY)
          .update(bodyString)
          .digest('hex')
      } else {
        log.warn({ eventType: event.eventType }, 'SERVER_API_KEY not set — sending unsigned event')
      }

      try {
        const res = await fetch(`${cloudUrl}/api/events/ingest`, {
          method: 'POST',
          headers,
          body: bodyString,
          signal: AbortSignal.timeout(5000),
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }

        // Mark as completed and soft-delete
        await db.cloudEventQueue.update({
          where: { id: event.id },
          data: {
            status: 'completed',
            syncedAt: new Date(),
            deletedAt: new Date(),
          },
        })
        log.info({ eventType: event.eventType, id: event.id }, 'Retried successfully')
      } catch (error) {
        const attempts = event.attempts + 1
        const backoff = Math.min(Math.pow(2, attempts) * 1000, MAX_BACKOFF_MS)
        const errorMessage = error instanceof Error ? error.message : String(error)
        await db.cloudEventQueue.update({
          where: { id: event.id },
          data: {
            attempts,
            status: 'failed',
            lastError: errorMessage,
            nextRetryAt: new Date(Date.now() + backoff),
          },
        })
        log.error({ id: event.id, eventType: event.eventType, attempts, errMsg: errorMessage }, 'Retry failed')
      }
    }
  } catch (error) {
    log.error({ err: error }, 'Worker cycle failed')
  }
}

export function startCloudEventWorker(): void {
  if (workerInterval) return
  workerInterval = setInterval(() => {
    void processQueue().catch((err) => log.error({ err }, 'processQueue unhandled error'))
  }, RETRY_INTERVAL_MS)
  log.info({ intervalMs: RETRY_INTERVAL_MS }, 'Worker started')
}

export function stopCloudEventWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    log.info('Worker stopped')
  }
}

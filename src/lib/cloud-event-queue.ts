import { createHmac } from 'crypto'
import { db } from '@/lib/db'

const MAX_QUEUE_SIZE = 1000
const RETRY_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 3_600_000

let workerInterval: ReturnType<typeof setInterval> | null = null

export async function queueCloudEvent(
  eventId: string,
  venueId: string,
  eventType: string,
  body: string,
): Promise<void> {
  try {
    await db.cloudEventQueue.create({
      data: {
        id: eventId,
        venueId,
        eventType,
        body: JSON.parse(body),
      },
    })

    const count = await db.cloudEventQueue.count()
    if (count > MAX_QUEUE_SIZE) {
      const oldest = await db.cloudEventQueue.findMany({
        orderBy: { createdAt: 'asc' },
        take: count - MAX_QUEUE_SIZE,
        select: { id: true },
      })
      await db.cloudEventQueue.deleteMany({
        where: { id: { in: oldest.map(e => e.id) } },
      })
    }
  } catch (error) {
    console.error('[CloudEventQueue] Failed to queue event', { eventId, error })
  }
}

async function processQueue(): Promise<void> {
  const cloudUrl = process.env.BACKOFFICE_API_URL
  if (!cloudUrl) return

  try {
    const events = await db.cloudEventQueue.findMany({
      where: { nextRetryAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    })

    for (const event of events) {
      const bodyString = JSON.stringify(event.body)
      const signature = createHmac('sha256', process.env.SERVER_API_KEY || '')
        .update(bodyString)
        .digest('hex')

      try {
        const res = await fetch(`${cloudUrl}/api/events/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Server-Node-Id': process.env.SERVER_NODE_ID || '',
            'X-Request-Signature': signature,
          },
          body: bodyString,
        })

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }

        await db.cloudEventQueue.delete({ where: { id: event.id } })
        console.log(`[CloudEventQueue] Retried successfully: ${event.eventType} (${event.id})`)
      } catch (error) {
        const attempts = event.attempts + 1
        const backoff = Math.min(Math.pow(2, attempts) * 1000, MAX_BACKOFF_MS)
        await db.cloudEventQueue.update({
          where: { id: event.id },
          data: {
            attempts,
            nextRetryAt: new Date(Date.now() + backoff),
          },
        })
        console.error('[CloudEventQueue] Retry failed', { id: event.id, eventType: event.eventType, attempts, error })
      }
    }
  } catch (error) {
    console.error('[CloudEventQueue] Worker cycle failed', error)
  }
}

export function startCloudEventWorker(): void {
  if (workerInterval) return
  workerInterval = setInterval(() => {
    void processQueue().catch(console.error)
  }, RETRY_INTERVAL_MS)
  console.log('[CloudEventQueue] Worker started (30s interval)')
}

export function stopCloudEventWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('[CloudEventQueue] Worker stopped')
  }
}

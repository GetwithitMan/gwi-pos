import { createHmac, randomUUID } from 'crypto'
import { queueCloudEvent } from '@/lib/cloud-event-queue'

export async function emitCloudEvent(eventType: string, payload: unknown): Promise<void> {
  const cloudUrl = process.env.BACKOFFICE_API_URL
  if (!cloudUrl) return

  const eventId = randomUUID()
  const venueId = process.env.LOCATION_ID || (payload as Record<string, unknown>)?.venueId as string || ''

  const body = {
    eventId,
    venueId,
    eventType,
    occurredAt: new Date().toISOString(),
    payload,
  }

  const bodyString = JSON.stringify(body)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Server-Node-Id': process.env.SERVER_NODE_ID || '',
  }

  if (process.env.SERVER_API_KEY) {
    headers['X-Request-Signature'] = createHmac('sha256', process.env.SERVER_API_KEY)
      .update(bodyString)
      .digest('hex')
  } else {
    console.warn('[CloudEvent] SERVER_API_KEY not set — sending unsigned event', { eventType })
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

    console.log(`[CloudEvent] Emitted ${eventType} (${eventId})`)
  } catch (error) {
    console.error('[CloudEvent] Failed to emit', { eventType, eventId, error })
    await queueCloudEvent(eventId, venueId, venueId, eventType, bodyString)
  }
}

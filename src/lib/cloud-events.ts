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

    console.log(`[CloudEvent] Emitted ${eventType} (${eventId})`)
  } catch (error) {
    console.error('[CloudEvent] Failed to emit', { eventType, eventId, error })
    await queueCloudEvent(eventId, venueId, eventType, bodyString)
  }
}

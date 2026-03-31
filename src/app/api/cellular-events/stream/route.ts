/**
 * SSE endpoint for cellular terminal real-time event streaming.
 *
 * Cellular devices connect here instead of Socket.IO. Events are read
 * from the CellularEvent table (written by NUC's cellular-event-relay).
 *
 * Protocol:
 *   GET /api/cellular-events/stream
 *   Headers: Authorization: Bearer <cellular-jwt>
 *   Optional: Last-Event-ID (for reconnection catch-up)
 *   Response: text/event-stream
 */

import { NextRequest } from 'next/server'
import { verifyCellularToken } from '@/lib/cellular-auth'
import { db } from '@/lib/db'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('cellular-sse')

// Poll interval for checking new events (ms)
const POLL_INTERVAL_MS = 500
// Max SSE connection duration before client should reconnect (ms)
// Vercel Edge: 60s limit, Node.js: configurable. Stay under to avoid hard kills.
const MAX_CONNECTION_MS = 55_000
// Heartbeat interval to keep connection alive (ms)
const HEARTBEAT_INTERVAL_MS = 15_000

export const dynamic = 'force-dynamic'
// Use Node.js runtime for longer connection limits on Vercel Pro
export const maxDuration = 60

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const token = authHeader.slice(7)
  let tokenPayload: { terminalId: string; locationId: string; venueSlug?: string }
  try {
    // verifyCellularToken returns the payload directly, or null if invalid
    const result = await verifyCellularToken(token)
    if (!result) {
      return new Response('Invalid token', { status: 401 })
    }
    tokenPayload = result as unknown as typeof tokenPayload
  } catch {
    return new Response('Token verification failed', { status: 401 })
  }

  const { locationId } = tokenPayload
  if (!locationId) {
    return new Response('Missing locationId in token', { status: 400 })
  }

  // ── Last-Event-ID for reconnection ────────────────────────────────────
  const lastEventIdHeader = request.headers.get('last-event-id')
  let cursor = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : 0
  if (isNaN(cursor) || cursor < 0) cursor = 0

  // If no cursor, start from the latest event (don't replay entire history)
  if (cursor === 0) {
    try {
      const latest = await db.$queryRaw<[{ id: bigint }]>`SELECT COALESCE(MAX("id"), 0) as id FROM "CellularEvent" WHERE "locationId" = ${locationId}`
      cursor = Number(latest[0]?.id ?? 0)
    } catch {
      // Start from 0 if query fails
    }
  }

  log.info({ locationId, terminalId: tokenPayload.terminalId, cursor }, 'Cellular SSE stream opened')

  // ── SSE Stream ────────────────────────────────────────────────────────
  const encoder = new TextEncoder()
  const startTime = Date.now()

  const stream = new ReadableStream({
    async start(controller) {
      let lastHeartbeat = Date.now()
      let aborted = false

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        aborted = true
      })

      // Send initial comment to establish connection
      controller.enqueue(encoder.encode(':ok\n\n'))

      try {
        while (!aborted && (Date.now() - startTime) < MAX_CONNECTION_MS) {
          // Poll for new events
          try {
            const events = await db.$queryRaw<Array<{ id: bigint; event: string; data: unknown }>>`SELECT "id", "event", "data" FROM "CellularEvent" WHERE "locationId" = ${locationId} AND "id" > ${cursor} ORDER BY "id" ASC LIMIT 50`

            for (const evt of events) {
              const eventId = Number(evt.id)
              const sseFrame = `id: ${eventId}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`
              controller.enqueue(encoder.encode(sseFrame))
              cursor = eventId
            }
          } catch (err) {
            log.warn({ err }, 'Cellular SSE poll error')
          }

          // Heartbeat to keep connection alive
          const now = Date.now()
          if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
            controller.enqueue(encoder.encode(`:heartbeat ${now}\n\n`))
            lastHeartbeat = now
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
        }
      } catch (err) {
        if (!aborted) {
          log.error({ err }, 'Cellular SSE stream error')
        }
      } finally {
        try { controller.close() } catch { /* already closed */ }
        log.info({ locationId, duration: Date.now() - startTime }, 'Cellular SSE stream closed')
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

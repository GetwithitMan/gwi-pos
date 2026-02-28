import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import type { EventReplayResponse } from '@/lib/order-events/types'

async function authenticateTerminal(
  request: NextRequest
): Promise<
  | { terminal: { id: string; locationId: string; name: string }; error?: never }
  | { terminal?: never; error: NextResponse }
> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      ),
    }
  }
  const terminal = await db.terminal.findFirst({
    where: { deviceToken: token, deletedAt: null },
    select: { id: true, locationId: true, name: true },
  })
  if (!terminal) {
    return {
      error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }),
    }
  }
  return { terminal }
}

/**
 * GET /api/sync/events?orderId=xxx&afterSequence=0&limit=200
 *
 * Replays events for a single order, cursor-based by serverSequence.
 * Used by Android to catch up on events it missed (e.g. from other devices).
 *
 * Query params:
 *   - orderId (required): The order to fetch events for
 *   - afterSequence (optional, default 0): Return events with serverSequence > this value
 *   - limit (optional, default 200, max 1000): Max events per page
 *
 * Response: { events: [...], hasMore: boolean }
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const auth = await authenticateTerminal(request)
  if (auth.error) return auth.error
  const { locationId } = auth.terminal

  const { searchParams } = new URL(request.url)

  const orderId = searchParams.get('orderId')
  if (!orderId) {
    return NextResponse.json(
      { error: 'orderId query parameter is required' },
      { status: 400 }
    )
  }

  const afterSequence = Math.max(
    0,
    parseInt(searchParams.get('afterSequence') || '0', 10) || 0
  )

  const requestedLimit = parseInt(searchParams.get('limit') || '200', 10)
  const limit = Math.min(Math.max(1, requestedLimit || 200), 1000)

  // Fetch limit + 1 to detect hasMore without an extra query
  const rows = await db.orderEvent.findMany({
    where: {
      orderId,
      locationId,
      serverSequence: { gt: afterSequence },
    },
    orderBy: { serverSequence: 'asc' },
    take: limit + 1,
    select: {
      eventId: true,
      orderId: true,
      serverSequence: true,
      type: true,
      payloadJson: true,
      schemaVersion: true,
      deviceId: true,
      deviceCounter: true,
      correlationId: true,
      deviceCreatedAt: true,
    },
  })

  const hasMore = rows.length > limit
  const events = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
    eventId: row.eventId,
    orderId: row.orderId,
    serverSequence: row.serverSequence,
    type: row.type,
    payloadJson: row.payloadJson as Record<string, unknown>,
    schemaVersion: row.schemaVersion,
    deviceId: row.deviceId,
    deviceCounter: row.deviceCounter,
    correlationId: row.correlationId ?? null,
    deviceCreatedAt: row.deviceCreatedAt.toISOString(),
  }))

  return NextResponse.json({
    data: { events, hasMore } satisfies EventReplayResponse,
  })
})

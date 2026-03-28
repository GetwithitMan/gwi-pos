import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { renewLease, ListenerError } from '@/lib/domain/payment-readers/listener-service'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

// ─── Rate limit: max 1 heartbeat per 5s per terminal ─────────────────
interface HeartbeatRateLimitEntry {
  lastCallAt: number
}
const heartbeatRateMap = new Map<string, HeartbeatRateLimitEntry>()
const HEARTBEAT_MIN_INTERVAL_MS = 5_000

function checkHeartbeatRateLimit(terminalId: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = heartbeatRateMap.get(terminalId)

  if (entry && now - entry.lastCallAt < HEARTBEAT_MIN_INTERVAL_MS) {
    const retryAfterSeconds = Math.ceil((entry.lastCallAt + HEARTBEAT_MIN_INTERVAL_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  heartbeatRateMap.set(terminalId, { lastCallAt: now })

  // Evict oldest entry when map grows too large
  if (heartbeatRateMap.size > 1000) {
    const firstKey = heartbeatRateMap.keys().next().value
    if (firstKey) heartbeatRateMap.delete(firstKey)
  }

  return { allowed: true }
}

// POST /api/payment-readers/[id]/heartbeat
//
// Renews the lease TTL. Called every 8s from useCardListener.
// Validates sessionId + leaseVersion (fencing token).
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: readerId } = await params
    const body = await request.json().catch(() => ({}))
    const { terminalId, sessionId, leaseVersion } = body

    if (!terminalId || !sessionId || leaseVersion === undefined) {
      return err('Missing required fields: terminalId, sessionId, leaseVersion')
    }

    // Rate limit
    const rateCheck = checkHeartbeatRateLimit(terminalId)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many heartbeat requests. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) } }
      )
    }

    // Validate reader exists
    const reader = await db.paymentReader.findFirst({
      where: { id: readerId, deletedAt: null, isActive: true },
      select: { id: true, locationId: true },
    })
    if (!reader) {
      return notFound('Payment reader not found')
    }

    // Validate terminal belongs to same location
    const terminal = await db.terminal.findFirst({
      where: { id: terminalId, locationId: reader.locationId, deletedAt: null },
      select: { id: true },
    })
    if (!terminal) {
      return forbidden('Terminal not found or does not belong to this location')
    }

    // Renew lease — returns a Date (throws ListenerError on stale/lost lease)
    const leasedUntil = await renewLease(readerId, sessionId, leaseVersion)

    return ok({ leasedUntil: leasedUntil.toISOString() })
  } catch (error) {
    if (error instanceof ListenerError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus }
      )
    }
    console.error('Failed to renew heartbeat:', error)
    return err('Failed to renew heartbeat', 500)
  }
})

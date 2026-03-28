import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { acquireLease, pollForCard, ListenerError } from '@/lib/domain/payment-readers/listener-service'
import { err, ok } from '@/lib/api-response'

// ─── Rate limit: reject if same terminal called within 2s ─────────────
interface ListenRateLimitEntry {
  lastCallAt: number
}
const listenRateMap = new Map<string, ListenRateLimitEntry>()
const LISTEN_MIN_INTERVAL_MS = 2_000

function checkListenRateLimit(terminalId: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now()
  const entry = listenRateMap.get(terminalId)

  if (entry && now - entry.lastCallAt < LISTEN_MIN_INTERVAL_MS) {
    const retryAfterSeconds = Math.ceil((entry.lastCallAt + LISTEN_MIN_INTERVAL_MS - now) / 1000)
    return { allowed: false, retryAfterSeconds }
  }

  listenRateMap.set(terminalId, { lastCallAt: now })

  // Evict oldest entry when map grows too large
  if (listenRateMap.size > 1000) {
    const firstKey = listenRateMap.keys().next().value
    if (firstKey) listenRateMap.delete(firstKey)
  }

  return { allowed: true }
}

// POST /api/payment-readers/[id]/listen
//
// Lease behavior:
//   - No sessionId → acquire new lease
//   - With sessionId + leaseVersion → continue existing lease (validates fencing)
//   - Stale or mismatched leaseVersion → 409 stale_lease
//
// Polls CollectCardData, checks for existing tabs, returns card detection or timeout.
// recordNo is NEVER returned to the client — stays server-side in CardDetection.
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: readerId } = await params
    const body = await request.json().catch(() => ({}))
    const { terminalId, employeeId, sessionId, leaseVersion, timeoutSeconds } = body

    if (!terminalId || !employeeId) {
      return err('Missing required fields: terminalId, employeeId')
    }

    // Rate limit: reject rapid re-calls from the same terminal
    const rateCheck = checkListenRateLimit(terminalId)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many listen requests. Try again later.', code: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) } }
      )
    }

    // Validate reader belongs to this location and is active
    const reader = await db.paymentReader.findFirst({
      where: { id: readerId, deletedAt: null, isActive: true },
      select: { id: true, locationId: true, readerState: true },
    })
    if (!reader) {
      return NextResponse.json({ error: 'Payment reader not found', code: 'reader_offline' }, { status: 400 })
    }

    const locationId = reader.locationId

    // Validate terminal belongs to same location
    const terminal = await db.terminal.findFirst({
      where: { id: terminalId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!terminal) {
      return NextResponse.json({ error: 'Terminal not found or does not belong to this location', code: 'unauthorized' }, { status: 403 })
    }

    // Auth check
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error, code: 'unauthorized' }, { status: auth.status })
    }

    // Check reader state
    if (reader.readerState === 'offline') {
      return NextResponse.json({ error: 'Reader is offline', code: 'reader_offline' }, { status: 400 })
    }
    if (reader.readerState === 'busy') {
      return NextResponse.json({ error: 'Reader is busy with another transaction', code: 'reader_busy' }, { status: 400 })
    }
    if (reader.readerState === 'error_backoff') {
      return NextResponse.json({ error: 'Reader is in error backoff', code: 'error_backoff' }, { status: 400 })
    }

    // Lease acquisition or continuation
    let currentSessionId = sessionId
    let currentLeaseVersion = leaseVersion

    if (!sessionId) {
      // New session — acquire lease (throws ListenerError on conflict)
      const leaseResult = await acquireLease(readerId, terminalId)
      currentSessionId = leaseResult.sessionId
      currentLeaseVersion = leaseResult.leaseVersion
    }

    // Poll for card detection (throws ListenerError on stale lease / reader errors)
    const result = await pollForCard(
      readerId,
      locationId,
      terminalId,
      currentSessionId,
      currentLeaseVersion,
      timeoutSeconds || undefined,
    )

    // Return result — recordNo is NEVER included
    return ok(result)
  } catch (error) {
    if (error instanceof ListenerError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.httpStatus }
      )
    }
    console.error('Failed to listen for card:', error)
    return err('Failed to listen for card', 500)
  }
})

/**
 * Internal HA Rejoin API (MC-Arbitrated Failover — Phase 3)
 *
 * POST /api/internal/ha-rejoin
 * Body: RejoinCommand payload from MC fleet command
 * Returns 202 (Accepted) immediately — rejoin runs async.
 * Returns 412 if the node is not fenced (safety gate).
 *
 * GET /api/internal/ha-rejoin
 * Returns current rejoin status (in-progress or last result).
 *
 * Auth: INTERNAL_API_SECRET or HA_SHARED_SECRET (bearer token)
 */

import { NextRequest, NextResponse } from 'next/server'
import { err, ok, unauthorized } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

function authorize(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)

  // Accept either INTERNAL_API_SECRET or HA_SHARED_SECRET
  const internalSecret = process.env.INTERNAL_API_SECRET
  const haSecret = process.env.HA_SHARED_SECRET
  if (internalSecret && token === internalSecret) return true
  if (haSecret && token === haSecret) return true
  return false
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  try {
    const body = await request.json()

    // Validate required fields
    if (body.command !== 'REJOIN_AS_STANDBY') {
      return err('Expected command: REJOIN_AS_STANDBY', 400)
    }
    if (!body.newPrimaryIp || !body.fenceCommandId || !body.venueSlug) {
      return err('Missing required fields: newPrimaryIp, fenceCommandId, venueSlug', 400)
    }

    // Safety gate: node must be fenced before rejoin is allowed
    const { isFenced } = await import('@/lib/ha-fence')
    if (!isFenced()) {
      return err('Node is not fenced — rejoin refused (safety gate)', 412)
    }

    // Dynamic import — avoids loading child_process, fs, etc. on Vercel
    const { handleRejoin, isRejoinInProgress } = await import('@/lib/ha-rejoin')

    if (isRejoinInProgress()) {
      return err('Rejoin already in progress', 409)
    }

    // Fire async — do not await (return 202 immediately)
    void handleRejoin(body).catch((e: unknown) => {
      console.error('[HA-REJOIN] Unhandled rejoin error:', e)
    })

    return NextResponse.json(
      { data: { status: 'accepted', message: 'Rejoin started' } },
      { status: 202 }
    )
  } catch (caughtErr) {
    console.error('[HA-REJOIN] POST error:', caughtErr)
    return err('Internal error', 500)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  const { isRejoinInProgress, getLastRejoinResult } = await import('@/lib/ha-rejoin')
  const { isFenced, getFenceState } = await import('@/lib/ha-fence')

  const inProgress = isRejoinInProgress()
  const lastResult = getLastRejoinResult()
  const fenced = isFenced()
  const fenceState = getFenceState()

  return ok({
    inProgress,
    lastResult: lastResult || undefined,
    fenced,
    fenceState: fenceState || undefined,
    stationRole: process.env.STATION_ROLE || 'unknown',
  })
}

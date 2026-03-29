/**
 * Internal HA Promote API (MC-Arbitrated Failover — Phase 2)
 *
 * POST /api/internal/ha-promote
 * Body: PromoteCommand payload from MC fleet command
 * Returns 202 (Accepted) immediately — promotion runs async.
 *
 * GET /api/internal/ha-promote
 * Returns current promotion status (in-progress or last result).
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
    if (body.command !== 'PROMOTE') {
      return err('Expected command: PROMOTE', 400)
    }
    if (!body.oldPrimaryIp || !body.fenceCommandId || !body.venueSlug) {
      return err('Missing required fields: oldPrimaryIp, fenceCommandId, venueSlug', 400)
    }

    // Dynamic import — avoids loading child_process, fs, etc. on Vercel
    const { handlePromotion, isPromotionInProgress } = await import('@/lib/ha-promote')

    if (isPromotionInProgress()) {
      return err('Promotion already in progress', 409)
    }

    // Fire async — do not await (return 202 immediately)
    void handlePromotion(body).catch((e: unknown) => {
      console.error('[HA-PROMOTE] Unhandled promotion error:', e)
    })

    return NextResponse.json(
      { data: { status: 'accepted', message: 'Promotion started' } },
      { status: 202 }
    )
  } catch (caughtErr) {
    console.error('[HA-PROMOTE] POST error:', caughtErr)
    return err('Internal error', 500)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  const { isPromotionInProgress, getLastPromotionResult } = await import('@/lib/ha-promote')

  const inProgress = isPromotionInProgress()
  const lastResult = getLastPromotionResult()

  return ok({
    inProgress,
    lastResult: lastResult || undefined,
    stationRole: process.env.STATION_ROLE || 'unknown',
  })
}

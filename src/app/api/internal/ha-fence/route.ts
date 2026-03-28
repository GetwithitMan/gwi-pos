/**
 * Internal HA Fence API (STONITH-lite)
 *
 * Called by the NEW primary's promote.sh to tell the OLD primary to step down.
 * Persists fence state to disk so it survives process restarts.
 *
 * POST /api/internal/ha-fence
 * Body: { action: "step_down", newPrimary: string, fenceCommandId?: string, reason?: string }
 * Body: { action: "unfence" }
 *
 * GET /api/internal/ha-fence — returns current fence status
 *
 * Auth: INTERNAL_API_SECRET or HA_SHARED_SECRET (bearer token)
 */

import { NextRequest, NextResponse } from 'next/server'
import { err, ok, unauthorized } from '@/lib/api-response'
import { fence, unfence, isFenced, getFenceState } from '@/lib/ha-fence'

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

    if (body.action === 'step_down') {
      console.error('[HA-FENCE] Received step-down request from new primary:', body.newPrimary)

      // Persist fence to disk (survives restart) + set in-memory
      fence({
        by: body.fenceCommandId || body.newPrimary || 'unknown',
        reason: body.reason || 'MC-arbitrated failover: standby promoted',
      })

      console.error('[HA-FENCE] Node is now FENCED (persistent). No writes will be accepted.')
      return ok({ status: 'stepped_down', persistent: true })
    }

    if (body.action === 'unfence') {
      console.error('[HA-FENCE] Received unfence request')

      unfence()

      const restoredRole = process.env.STATION_ROLE || 'backup'
      console.error('[HA-FENCE] Node is now UNFENCED. Restored role:', restoredRole)
      return ok({ status: 'unfenced', restoredRole })
    }

    return err('Unknown action')
  } catch (caughtErr) {
    console.error('[HA-FENCE] POST error:', caughtErr)
    return err('Internal error', 500)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  const fenced = isFenced()
  const fenceState = getFenceState()

  return ok({
    stationRole: process.env.STATION_ROLE || 'unknown',
    isFenced: fenced,
    persistent: true,
    fenceState: fenceState || undefined,
  })
}

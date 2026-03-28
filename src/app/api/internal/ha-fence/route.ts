/**
 * Internal HA Fence API (STONITH-lite)
 *
 * Called by the NEW primary's promote.sh to tell the OLD primary to step down.
 * Sets STATION_ROLE=fenced so that proxy.ts rejects all write requests,
 * preventing split-brain.
 *
 * POST /api/internal/ha-fence
 * Body: { action: "step_down", newPrimary: string }
 *
 * Auth: INTERNAL_API_SECRET or HA_SHARED_SECRET (bearer token)
 */

import { NextRequest } from 'next/server'
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

    if (body.action === 'step_down') {
      console.error('[HA-FENCE] Received step-down request from new primary:', body.newPrimary)

      // Set a flag that prevents this node from accepting writes.
      // proxy.ts checks this on every non-GET/HEAD request.
      process.env.STATION_ROLE = 'fenced'

      console.error('[HA-FENCE] Node is now FENCED. No writes will be accepted.')
      return ok({ status: 'stepped_down' })
    }

    return err('Unknown action')
  } catch (err) {
    console.error('[HA-FENCE] POST error:', err)
    return err('Internal error', 500)
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorize(request)) {
    return unauthorized('Unauthorized')
  }

  return ok({
    stationRole: process.env.STATION_ROLE || 'unknown',
    isFenced: process.env.STATION_ROLE === 'fenced',
  })
}

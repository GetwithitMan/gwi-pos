import { NextResponse } from 'next/server'
import { emitToLocation } from '@/lib/socket-server'
import { getLocationId } from '@/lib/location-cache'

/**
 * POST /api/internal/reload-terminals
 *
 * Broadcasts system:reload to all terminals at this location.
 * Called by the NUC sync-agent when Mission Control sends a RELOAD_TERMINALS command.
 */
export async function POST(request: Request) {
  // Auth: require valid API key or Bearer token — no localhost bypass
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  const secret = process.env.PROVISION_API_KEY || process.env.INTERNAL_API_SECRET
  if (!apiKey || !secret || apiKey !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No locationId configured' }, { status: 500 })
    }

    void emitToLocation(locationId, 'system:reload', {}).catch(console.error)

    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('[Reload Terminals] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

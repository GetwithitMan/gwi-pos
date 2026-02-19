import { NextResponse } from 'next/server'
import { emitToLocation } from '@/lib/socket-server'
import { getLocationId } from '@/lib/location-cache'

/**
 * POST /api/internal/reload-terminal
 *
 * Broadcasts system:reload to all terminals at this location.
 * A future enhancement could target a specific terminal's socket room,
 * but for now we reload all terminals (same as reload-terminals).
 *
 * Body: { terminalId: string }
 *
 * Called by the NUC sync-agent when Mission Control sends a RELOAD_TERMINAL command.
 */
export async function POST(request: Request) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No locationId configured' }, { status: 500 })
    }

    const body = await request.json()
    const { terminalId } = body as { terminalId?: string }

    if (!terminalId) {
      return NextResponse.json({ error: 'terminalId is required' }, { status: 400 })
    }

    // Emit to the entire location — terminal-specific rooms are not yet implemented.
    // The terminalId is included in the payload so clients can filter if needed.
    void emitToLocation(locationId, 'system:reload', { terminalId }).catch(console.error)

    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('[Reload Terminal] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

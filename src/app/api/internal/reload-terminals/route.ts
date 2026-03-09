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
  // C16: API key validation + localhost fallback for backward compatibility
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  if (!apiKey || apiKey !== process.env.INTERNAL_API_SECRET) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
    const isLocal = ['127.0.0.1', '::1', 'localhost'].includes(ip)
    if (!isLocal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

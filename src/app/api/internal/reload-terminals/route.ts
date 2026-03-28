import { emitToLocation } from '@/lib/socket-server'
import { getLocationId } from '@/lib/location-cache'
import { createChildLogger } from '@/lib/logger'
import { err, ok, unauthorized } from '@/lib/api-response'
const log = createChildLogger('internal-reload-terminals')

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
    return unauthorized('Unauthorized')
  }

  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No locationId configured', 500)
    }

    void emitToLocation(locationId, 'system:reload', {}).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({ ok: true })
  } catch (err) {
    console.error('[Reload Terminals] Error:', err)
    return err('Internal error', 500)
  }
}

import { NextResponse } from 'next/server'
import { config } from '@/lib/system-config'
import { unauthorized } from '@/lib/api-response'
import { getAndroidProxyStats } from '@/lib/android-proxy-stats'

/**
 * GET /api/internal/android-proxy-stats
 *
 * Returns process-local counters for the NUC's Android update proxy routes so
 * the heartbeat payload can surface `androidProxyForwarded5m` /
 * `androidProxyLastError` / `androidProxyCacheServes5m` to Mission Control.
 *
 * Auth: x-api-key header (PROVISION_API_KEY). Matches the posture of
 * /api/internal/nuc-readiness so heartbeat.sh can reuse the same credential.
 */
export async function GET(request: Request) {
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== config.provisionApiKey) {
    return unauthorized('Unauthorized')
  }

  return NextResponse.json(getAndroidProxyStats(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}

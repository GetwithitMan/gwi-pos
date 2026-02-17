/**
 * Fire-and-forget notification to Mission Control that venue data changed.
 *
 * When POS API routes run on Vercel (cloud), Socket.io is not available,
 * so we notify MC which relays to the NUC via the SSE command channel.
 *
 * On the NUC, MC_BASE_URL is not set, so this is a no-op (Socket.io
 * handles local updates directly).
 */

type NotifyDomain = 'menu' | 'floorplan' | 'settings' | 'employees' | 'order-types'

interface NotifyParams {
  locationId: string
  domain: NotifyDomain
  action?: 'created' | 'updated' | 'deleted'
  entityId?: string
}

export function notifyDataChanged(params: NotifyParams): void {
  const mcBaseUrl = process.env.MC_BASE_URL
  const secret = process.env.FLEET_NOTIFY_SECRET

  // On NUC, these env vars don't exist — Socket.io handles it locally
  if (!mcBaseUrl || !secret) return

  // Fire-and-forget — never block the API response
  fetch(`${mcBaseUrl}/api/fleet/commands/notify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${secret}`,
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(3000),
  }).catch((err) => {
    console.warn('[Cloud Notify] Failed to notify MC:', err instanceof Error ? err.message : err)
  })
}

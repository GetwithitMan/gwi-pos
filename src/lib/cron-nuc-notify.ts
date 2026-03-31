/**
 * NUC notification helper for cron jobs running on Vercel.
 *
 * On NUC: calls socket dispatch functions directly (same process).
 * On Vercel: POSTs to the venue's NUC via /api/internal/socket/broadcast
 *   if nuc_base_url is known in the registry. Falls back to no-op with warning.
 *
 * This bridges the gap where cron jobs on Vercel need to trigger real-time
 * socket events that only the NUC's Socket.IO server can emit.
 */

/**
 * Notify a venue's NUC to emit a socket event.
 *
 * @param slug - Venue slug (used to look up NUC URL from registry)
 * @param event - Socket broadcast event type (e.g., 'FLOOR_PLAN_UPDATE')
 * @param payload - Event payload
 * @returns true if notification was sent successfully, false otherwise
 */
export async function notifyNuc(
  slug: string,
  event: string,
  payload: any,
): Promise<boolean> {
  // ── NUC mode: call socket dispatch directly ────────────────────────
  if (!process.env.VERCEL) {
    try {
      // Dynamic import to avoid pulling in socket-server on Vercel
      const socketModule = await import('@/lib/socket-server')
      if (payload?.locationId && socketModule.emitToLocation) {
        await socketModule.emitToLocation(payload.locationId, event, payload)
        return true
      }
      return false
    } catch {
      // Socket server not initialized (dev mode without custom server)
      return false
    }
  }

  // ── Vercel mode: POST to NUC's broadcast endpoint ──────────────────
  const { Prisma } = await import('@/generated/prisma/client')
  const { masterClient } = await import('@/lib/db')
  const internalSecret = process.env.INTERNAL_API_SECRET
  if (!internalSecret) {
    console.warn(`[cron-nuc-notify] INTERNAL_API_SECRET not set, cannot notify NUC for ${slug}`)
    return false
  }

  let nucBaseUrl: string | null = null
  try {
    const rows = await masterClient.$queryRaw<{ nuc_base_url: string | null }[]>(
      Prisma.sql`SELECT nuc_base_url FROM "_cron_venue_registry" WHERE slug = ${slug}`,
    )
    nucBaseUrl = rows[0]?.nuc_base_url ?? null
  } catch {
    // Registry table may not exist
    console.warn(`[cron-nuc-notify] Failed to query NUC URL for ${slug}`)
    return false
  }

  if (!nucBaseUrl) {
    // NUC URL not registered — this is expected for venues without a NUC
    // (cloud-only mode) or before NUC registration
    return false
  }

  try {
    const url = `${nucBaseUrl}/api/internal/socket/broadcast`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': internalSecret,
      },
      body: JSON.stringify({
        type: event,
        locationId: payload?.locationId || '',
        payload,
      }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    })

    if (!response.ok) {
      console.warn(
        `[cron-nuc-notify] NUC ${slug} returned ${response.status} for event ${event}`
      )
      return false
    }

    return true
  } catch (err) {
    console.warn(
      `[cron-nuc-notify] Failed to reach NUC for ${slug}:`,
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

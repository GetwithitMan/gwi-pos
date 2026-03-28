import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateLocationCache } from '@/lib/location-cache'
import { registerVenueDbName } from '@/lib/db-venue-cache'
import { err, notFound, ok, unauthorized } from '@/lib/api-response'

/**
 * POST /api/internal/online-ordering/enabled
 *
 * Called by Mission Control to push the online ordering enable/disable state
 * down to the POS. MC is the authoritative source for this toggle.
 *
 * Also syncs:
 *   - orderCode: the MC-assigned order code for the customer ordering URL
 *   - databaseName: the actual Neon database name for this venue
 *     (registered in the venue DB name cache so getDbForVenue works
 *      even if the database name doesn't match the slug convention)
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *   x-venue-slug: venue slug (set by custom server for DB routing)
 *
 * Body:
 *   { enabled: boolean, orderCode?: string, databaseName?: string }
 *
 * Response:
 *   { success: true }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return unauthorized('Unauthorized')
  }

  const venueSlug = request.headers.get('x-venue-slug')

  const body = await request.json()
  const { enabled, orderCode, databaseName } = body

  if (typeof enabled !== 'boolean') {
    return err('enabled must be a boolean')
  }

  // ── Register venue database name in cache ────────────────────────────
  // This ensures getDbForVenue(slug) works even when the actual Neon
  // database name doesn't match the slug convention (gwi_pos_{slug}).
  if (venueSlug && databaseName) {
    registerVenueDbName(venueSlug, databaseName)
  }

  // ── Find location ─────────────────────────────────────────────────────
  const location = await db.location.findFirst({
    select: { id: true, settings: true },
  })

  if (!location) {
    return notFound('Location not found')
  }

  // ── Merge enabled into settings.onlineOrdering ────────────────────────
  const existing = (location.settings as Record<string, unknown>) ?? {}
  const existingOnlineOrdering = (existing.onlineOrdering as Record<string, unknown>) ?? {}

  const updatedSettings = {
    ...existing,
    onlineOrdering: {
      ...existingOnlineOrdering,
      enabled,
      ...(orderCode && { orderCode }),
      ...(databaseName && { databaseName }),
    },
  }

  await db.location.update({
    where: { id: location.id },
    data: { settings: updatedSettings },
  })

  invalidateLocationCache(location.id)

  return ok({ success: true })
})

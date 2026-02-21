import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateLocationCache } from '@/lib/location-cache'

/**
 * POST /api/internal/online-ordering/enabled
 *
 * Called by Mission Control to push the online ordering enable/disable state
 * down to the POS. MC is the authoritative source for this toggle.
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *   x-venue-slug: venue slug (set by custom server for DB routing)
 *
 * Body:
 *   { enabled: boolean }
 *
 * Response:
 *   { success: true }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { enabled } = body

  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  // ── Find location ─────────────────────────────────────────────────────
  const location = await db.location.findFirst({
    select: { id: true, settings: true },
  })

  if (!location) {
    return NextResponse.json({ error: 'Location not found' }, { status: 404 })
  }

  // ── Merge enabled into settings.onlineOrdering ────────────────────────
  const existing = (location.settings as Record<string, unknown>) ?? {}
  const existingOnlineOrdering = (existing.onlineOrdering as Record<string, unknown>) ?? {}

  const updatedSettings = {
    ...existing,
    onlineOrdering: {
      ...existingOnlineOrdering,
      enabled,
    },
  }

  await db.location.update({
    where: { id: location.id },
    data: { settings: updatedSettings },
  })

  invalidateLocationCache(location.id)

  return NextResponse.json({ success: true })
})

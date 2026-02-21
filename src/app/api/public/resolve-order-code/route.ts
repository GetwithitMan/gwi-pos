/**
 * Public: Resolve Order Code
 *
 * GET /api/public/resolve-order-code?slug=gwi-admin-dev
 *
 * Looks up a Location by its slug and returns the locationId for the
 * online ordering flow. No authentication required.
 *
 * Architectural note:
 *   Does NOT use withVenue() — public route, no authenticated venue context.
 *   Uses db proxy directly (same pattern as /api/online/menu). The slug
 *   provides tenant isolation: only the matching location is returned.
 *
 * Online ordering gate:
 *   Checks settings.onlineOrdering.enabled (JSON field on Location.settings).
 *   If the field is absent (legacy locations), defaults to ALLOWED so that
 *   venues set up before the onlineOrdering settings key was introduced
 *   continue to work. Once the master switch UI is shipped, operators can
 *   explicitly disable it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const slug = searchParams.get('slug')

    if (!slug) {
      return NextResponse.json(
        { error: 'slug query parameter is required' },
        { status: 400 }
      )
    }

    // Route directly to the venue's database — the slug IS the database identifier.
    // Public routes don't carry x-venue-slug headers (middleware passes them through
    // unmodified), so we can't rely on the db proxy's header-based routing here.
    let venueDb
    try {
      venueDb = getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        slug: true,
        settings: true,
      },
    })

    if (!location) {
      return NextResponse.json(
        { error: 'Location not found' },
        { status: 404 }
      )
    }

    // ── Online ordering gate ────────────────────────────────────────────────
    // Check settings.onlineOrdering.enabled (JSON).
    // If the key is absent, default to ALLOWED (backward-compatible).
    const settings = location.settings as Record<string, unknown> | null
    const onlineOrderingSettings = settings?.onlineOrdering as Record<string, unknown> | null | undefined

    // Also support a flat settings.onlineOrderingEnabled boolean for
    // future-proofing in case the schema evolves to use that shape.
    const enabledViaNestedKey = onlineOrderingSettings?.enabled
    const enabledViaFlatKey = settings?.onlineOrderingEnabled

    const explicitlyDisabled =
      enabledViaNestedKey === false || enabledViaFlatKey === false

    if (explicitlyDisabled) {
      return NextResponse.json(
        { error: 'Online ordering is not available at this location' },
        { status: 403 }
      )
    }

    // ── Extract online ordering settings with defaults ──────────────────────
    const prepTime = (onlineOrderingSettings?.prepTime as number) ?? 20
    const hours = (onlineOrderingSettings?.hours as unknown[]) ?? [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      open: '11:00',
      close: '22:00',
      closed: false,
    }))
    const tipSuggestions = (onlineOrderingSettings?.tipSuggestions as number[]) ?? [15, 18, 20]
    const defaultTip = (onlineOrderingSettings?.defaultTip as number) ?? 18
    const orderTypes = (onlineOrderingSettings?.orderTypes as string[]) ?? ['takeout']

    // ── Success ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      locationId: location.id,
      name: location.name,
      slug: location.slug,
      prepTime,
      hours,
      tipSuggestions,
      defaultTip,
      orderTypes,
    })
  } catch (error) {
    console.error('[GET /api/public/resolve-order-code] Error:', error)
    return NextResponse.json(
      { error: 'Failed to resolve location' },
      { status: 500 }
    )
  }
}

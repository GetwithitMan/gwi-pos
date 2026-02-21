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
import { db } from '@/lib/db'

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

    // Look up location by slug (soft-delete safe)
    const location = await db.location.findFirst({
      where: {
        slug,
        // Location model has no deletedAt — use isActive as the live-ness check
        isActive: true,
      },
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

    // ── Success ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      locationId: location.id,
      name: location.name,
      slug: location.slug,
    })
  } catch (error) {
    console.error('[GET /api/public/resolve-order-code] Error:', error)
    return NextResponse.json(
      { error: 'Failed to resolve location' },
      { status: 500 }
    )
  }
}

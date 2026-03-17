/**
 * GET /api/public/portal/[slug]/branding — Public branding endpoint
 *
 * No auth. Returns venue branding (colors, logo, features).
 * Cache-Control: public, max-age=300 (5 min browser cache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { mergeWithDefaults } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return NextResponse.json({ error: 'Venue slug is required' }, { status: 400 })
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    const settings = mergeWithDefaults(location.settings as any)
    const portal = settings.venuePortal

    // If portal is not enabled, return minimal data
    if (!portal?.enabled) {
      return NextResponse.json(
        { error: 'Customer portal is not enabled for this venue' },
        { status: 404 },
      )
    }

    const response = NextResponse.json({
      locationName: location.name,
      brandColor: portal.brandColor || '#3B82F6',
      brandColorSecondary: portal.brandColorSecondary || portal.brandColor || '#3B82F6',
      logoUrl: portal.logoUrl || null,
      bannerUrl: portal.bannerUrl || null,
      tagline: portal.tagline || null,
      features: {
        rewards: portal.rewardsPageEnabled ?? false,
        orderHistory: portal.orderHistoryEnabled ?? false,
        cakeOrdering: portal.cakeOrderingOnPortal ?? false,
      },
    })

    response.headers.set('Cache-Control', 'public, max-age=300')
    return response
  } catch (error) {
    console.error('[GET /api/public/portal/[slug]/branding] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch branding' }, { status: 500 })
  }
}

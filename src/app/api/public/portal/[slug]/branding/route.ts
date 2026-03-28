/**
 * GET /api/public/portal/[slug]/branding — Public branding endpoint
 *
 * No auth. Returns venue branding (colors, logo, features).
 * Cache-Control: public, max-age=300 (5 min browser cache).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { mergeWithDefaults } from '@/lib/settings'
import { err, notFound } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  context: any,
) {
  try {
    const { slug } = (await context.params) as { slug: string }

    if (!slug) {
      return err('Venue slug is required')
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return notFound('Location not found')
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true },
    })

    if (!location) {
      return notFound('Location not found')
    }

    const settings = mergeWithDefaults(location.settings as any)
    const portal = settings.venuePortal

    // If portal is not enabled, return minimal data
    if (!portal?.enabled) {
      return notFound('Customer portal is not enabled for this venue')
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
        cakeOrdering: (portal.cakeOrderingOnPortal && settings.cakeOrdering?.enabled) ?? false,
      },
    })

    response.headers.set('Cache-Control', 'public, max-age=300')
    return response
  } catch (error) {
    console.error('[GET /api/public/portal/[slug]/branding] Error:', error)
    return err('Failed to fetch branding', 500)
  }
}

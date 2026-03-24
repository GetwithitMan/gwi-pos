/**
 * GET /api/public/site/[slug]/bootstrap — Site bootstrap endpoint
 *
 * No auth. Returns everything needed to render the site shell in a single call:
 * venue info, branding, section toggles, content, hours, capabilities, ordering config.
 *
 * Cache-Control: public, s-maxage=300 (5 min CDN, browser revalidates).
 * Vary: x-venue-slug to prevent cross-venue CDN leaks.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDbForVenue } from '@/lib/db'
import { getSiteBootstrapData } from '@/lib/site-bootstrap'
import { SiteBootstrapSchema } from '@/lib/site-api-schemas'
import { checkOnlineRateLimit } from '@/lib/online-rate-limiter'

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

    // ── Rate limit ──────────────────────────────────────────────────────────
    const ip =
      _request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      _request.headers.get('x-real-ip') ||
      'unknown'
    const rateCheck = checkOnlineRateLimit(ip, slug, 'menu') // 30/min
    if (!rateCheck.allowed) {
      const resp = NextResponse.json(
        { error: 'Too many requests. Please try again shortly.' },
        { status: 429 }
      )
      resp.headers.set('Retry-After', String(rateCheck.retryAfterSeconds ?? 60))
      return resp
    }

    // ── Resolve venue DB ───────────────────────────────────────────
    let venueDb
    try {
      venueDb = await getDbForVenue(slug)
    } catch {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Get location ─────────────────────────────────────────────
    const location = await venueDb.location.findFirst({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        timezone: true,
        settings: true,
      },
    })

    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 })
    }

    // ── Build bootstrap payload ──────────────────────────────────
    const data = await getSiteBootstrapData(venueDb, location.id, {
      name: location.name,
      address: location.address,
      phone: location.phone,
      timezone: location.timezone,
      settings: location.settings,
    })

    // ── Validate with Zod (dev safety net — strips unexpected fields) ──
    const validated = SiteBootstrapSchema.parse(data)

    // ── Response with CDN caching ────────────────────────────────
    const response = NextResponse.json(validated)
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60')
    response.headers.set('Vary', 'x-venue-slug')

    return response
  } catch (error) {
    console.error('[GET /api/public/site/[slug]/bootstrap] Error:', error)
    return NextResponse.json({ error: 'Failed to load site data' }, { status: 500 })
  }
}

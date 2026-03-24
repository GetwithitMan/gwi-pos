/**
 * POST /api/public/delivery/quote
 *
 * Phase G stub — delivery eligibility engine placeholder.
 * Always returns serviceable: false until delivery zones are configured.
 *
 * TODO: When delivery is enabled, this endpoint will:
 *   - Check delivery zones configured for the venue location
 *   - Validate the customer address against zone boundaries (polygon/radius)
 *   - Calculate delivery fee from the matched zone's fee rules (flat, distance-based, or tiered)
 *   - Estimate total time = kitchen prep time + dispatch travel time
 *   - Check minimum order requirement from zone configuration
 *   - Return serviceable: true with fee, estimated minutes, and zone details
 *
 * No authentication required — public endpoint.
 */

import { NextRequest, NextResponse } from 'next/server'

interface QuoteBody {
  slug: string
  address: string
  city?: string
  zip?: string
}

export async function POST(request: NextRequest) {
  let body: QuoteBody
  try {
    body = (await request.json()) as QuoteBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.slug) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (!body.address?.trim()) {
    return NextResponse.json({ error: 'address is required' }, { status: 400 })
  }

  // Stub response — delivery not yet available
  return NextResponse.json({
    serviceable: false,
    reason: 'Delivery coming soon',
    fee: 0,
    estimatedMinutes: 0,
  })
}

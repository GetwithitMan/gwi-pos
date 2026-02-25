import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { scaleService } from '@/lib/scale/scale-service'
import { withVenue } from '@/lib/with-venue'

// GET - Get current weight reading (HTTP fallback when socket unavailable)
export const GET = withVenue(async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const scale = await db.scale.findFirst({
      where: { id, locationId, deletedAt: null },
    })
    if (!scale) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    const reading = await scaleService.getWeight(id)

    return NextResponse.json({ data: reading })
  } catch (error) {
    console.error('Failed to read scale weight:', error)
    const message = error instanceof Error ? error.message : 'Failed to read weight'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})

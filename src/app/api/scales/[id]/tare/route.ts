import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { scaleService } from '@/lib/scale/scale-service'
import { withVenue } from '@/lib/with-venue'

// POST - Send tare command to scale
export const POST = withVenue(async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    let scale
    try {
      scale = await db.scale.findFirst({
        where: { id, locationId, deletedAt: null },
      })
    } catch {
      // Scale table doesn't exist on un-migrated DB
      return NextResponse.json(
        { error: 'Scale feature not available - database migration required' },
        { status: 503 }
      )
    }
    if (!scale) {
      return NextResponse.json({ error: 'Scale not found' }, { status: 404 })
    }

    await scaleService.tare(id)

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to tare scale:', error)
    const message = error instanceof Error ? error.message : 'Failed to tare scale'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})

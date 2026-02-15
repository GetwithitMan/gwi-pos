import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { createServerTiming } from '@/lib/perf-timing'
import { getFloorPlanSnapshot } from '@/lib/snapshot'

/**
 * GET /api/floorplan/snapshot?locationId=...
 *
 * Single endpoint returning tables + sections + elements + openOrdersCount.
 * Replaces 4 separate fetches on FloorPlanHome mount (3 parallel + 1 count).
 * All queries run in parallel within one serverless invocation.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get('locationId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  const timing = createServerTiming()
  timing.start('total')

  try {
    timing.start('db')
    const snapshot = await getFloorPlanSnapshot(locationId)
    timing.end('db', 'Parallel queries + mapping')

    timing.end('total')
    const response = NextResponse.json(snapshot)
    return timing.apply(response)
  } catch (error) {
    console.error('[floorplan/snapshot] GET error:', error)
    return NextResponse.json({ error: 'Failed to load floor plan' }, { status: 500 })
  }
})

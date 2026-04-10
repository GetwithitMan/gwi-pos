import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { createServerTiming } from '@/lib/perf-timing'
import { getFloorPlanSnapshot } from '@/lib/snapshot'
import { err } from '@/lib/api-response'

/**
 * GET /api/floorplan/snapshot?locationId=...
 *
 * Single endpoint returning tables + sections + elements + openOrdersCount.
 * Replaces 4 separate fetches on FloorPlanHome mount (3 parallel + 1 count).
 * All queries run in parallel within one serverless invocation.
 */
export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest) {
  const locationId = request.nextUrl.searchParams.get('locationId')

  if (!locationId) {
    return err('locationId required')
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
    return err('Failed to load floor plan', 500)
  }
}))

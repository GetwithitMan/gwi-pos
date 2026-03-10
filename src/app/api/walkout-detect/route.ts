import { NextRequest, NextResponse } from 'next/server'
import { withVenue } from '@/lib/with-venue'
import { detectPotentialWalkouts } from '@/lib/walkout-detector'

/**
 * POST /api/walkout-detect
 *
 * Scan for potential walkouts at a location. Can be triggered by cron or manually.
 * Does NOT auto-close or auto-mark orders — just flags them for manager review.
 *
 * Body: { locationId: string }
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { locationId } = body

    if (!locationId) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      )
    }

    const result = await detectPotentialWalkouts(locationId)

    return NextResponse.json({
      data: {
        flaggedCount: result.flaggedCount,
        flaggedOrders: result.flaggedOrders,
        message: result.flaggedCount > 0
          ? `${result.flaggedCount} potential walkout(s) flagged for review`
          : 'No potential walkouts detected',
      },
    })
  } catch (error) {
    console.error('[WalkoutDetect] Failed:', error)
    return NextResponse.json(
      { error: 'Failed to run walkout detection', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
})

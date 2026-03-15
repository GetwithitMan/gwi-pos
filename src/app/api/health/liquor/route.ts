import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/health/liquor
 * Monitoring endpoint for liquor inventory health.
 * Returns key metrics for alerting on data integrity issues.
 */
export const GET = withVenue(async function GET() {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

    const [
      needsVerificationCount,
      deductionFailedCount,
      missingLinkedBottleCount,
    ] = await Promise.all([
      // Bottles flagged for verification
      db.bottleProduct.count({
        where: { locationId, needsVerification: true, deletedAt: null },
      }),
      // Failed deductions in last 24h
      db.inventoryItemTransaction.count({
        where: {
          locationId,
          type: 'deduction_failed',
          createdAt: { gte: twentyFourHoursAgo },
        },
      }),
      // Spirit modifiers missing bottle link in last 24h
      db.orderItemModifier.count({
        where: {
          spiritTier: { not: null },
          linkedBottleProductId: null,
          createdAt: { gte: twentyFourHoursAgo },
          orderItem: {
            order: { locationId },
          },
        },
      }),
    ])

    return NextResponse.json({
      status: 'ok',
      locationId,
      timestamp: new Date().toISOString(),
      metrics: {
        needsVerificationCount,
        deductionFailedCount,
        missingLinkedBottleCount,
        backfillCount: 0, // Placeholder — requires counter infrastructure
      },
    })
  } catch (error) {
    console.error('Failed to generate liquor health report:', error)
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 })
  }
})

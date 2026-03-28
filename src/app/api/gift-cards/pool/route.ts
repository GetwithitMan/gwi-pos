/**
 * Gift Card Pool Status API
 *
 * GET /api/gift-cards/pool?locationId=...
 *
 * Returns pool inventory counts: total, available (unactivated), activated,
 * grouped by batch. Includes low-pool alert based on location settings.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { parseSettings } from '@/lib/settings'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(
  request: NextRequest,
) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // ── Count pool cards by status ──────────────────────────────────────
    const poolSources = ['import', 'range']

    const [unactivatedCount, activatedCount] = await Promise.all([
      db.giftCard.count({
        where: {
          locationId,
          status: 'unactivated',
          source: { in: poolSources },
          deletedAt: null,
        },
      }),
      db.giftCard.count({
        where: {
          locationId,
          status: { not: 'unactivated' },
          source: { in: poolSources },
          deletedAt: null,
        },
      }),
    ])

    const total = unactivatedCount + activatedCount

    // ── Group by batch ──────────────────────────────────────────────────
    const batches = await db.giftCard.groupBy({
      by: ['batchId', 'source'],
      where: {
        locationId,
        source: { in: poolSources },
        deletedAt: null,
        batchId: { not: null },
      },
      _count: { id: true },
      _min: { createdAt: true },
    })

    // For each batch, count available (unactivated)
    const batchIds = batches.map(b => b.batchId).filter((id): id is string => id !== null)

    const batchAvailable = batchIds.length > 0
      ? await db.giftCard.groupBy({
          by: ['batchId'],
          where: {
            locationId,
            batchId: { in: batchIds },
            status: 'unactivated',
            deletedAt: null,
          },
          _count: { id: true },
        })
      : []

    const availableByBatch = new Map(batchAvailable.map(b => [b.batchId, b._count.id]))

    const byBatch = batches.map(b => ({
      batchId: b.batchId,
      source: b.source,
      count: b._count.id,
      available: availableByBatch.get(b.batchId!) ?? 0,
      createdAt: b._min.createdAt,
    }))

    // ── Read low pool threshold from settings ───────────────────────────
    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { settings: true },
    })
    const settings = parseSettings(location?.settings)
    const threshold = settings.payments?.giftCardLowPoolThreshold ?? 10

    return ok({
      total,
      available: unactivatedCount,
      activated: activatedCount,
      lowPoolAlert: unactivatedCount < threshold,
      threshold,
      byBatch,
    })
  } catch (error) {
    console.error('Failed to fetch gift card pool status:', error)
    return err('Failed to fetch gift card pool status', 500)
  }
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('liquor.bottles.reorder')

/**
 * PUT /api/liquor/bottles/reorder
 * Reorder bottles within a spirit category by updating sortOrder
 */
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { bottleIds } = body

    if (!bottleIds || !Array.isArray(bottleIds)) {
      return err('bottleIds array is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Verify all bottles belong to this location
    const bottles = await db.bottleProduct.findMany({
      where: {
        id: { in: bottleIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (bottles.length !== bottleIds.length) {
      return notFound('One or more bottles not found')
    }

    // Update sortOrder for each bottle
    await db.$transaction(
      bottleIds.map((id: string, index: number) =>
        db.bottleProduct.update({
          where: { id },
          data: {
            sortOrder: index,
            lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
          },
        })
      )
    )

    void notifyDataChanged({ locationId, domain: 'liquor', action: 'updated', entityId: bottleIds[0] })
    void pushUpstream()

    // Real-time cross-terminal update
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      name: 'bottles-reorder',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in liquor.bottles.reorder'))

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to reorder bottles:', error)
    return err('Failed to reorder bottles', 500)
  }
}))

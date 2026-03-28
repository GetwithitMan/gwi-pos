import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('liquor.categories.reorder')

/**
 * PUT /api/liquor/categories/reorder
 * Reorder spirit categories by updating sortOrder
 */
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { categoryIds } = body

    if (!categoryIds || !Array.isArray(categoryIds)) {
      return err('categoryIds array is required')
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Verify all categories belong to this location
    const categories = await db.spiritCategory.findMany({
      where: {
        id: { in: categoryIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (categories.length !== categoryIds.length) {
      return notFound('One or more categories not found')
    }

    // Update sortOrder for each category
    await db.$transaction(
      categoryIds.map((id: string, index: number) =>
        db.spiritCategory.update({
          where: { id },
          data: { sortOrder: index, lastMutatedBy: 'cloud' },
        })
      )
    )

    // Real-time cross-terminal update
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      name: 'categories-reorder',
    }).catch(err => log.warn({ err }, 'fire-and-forget failed in liquor.categories.reorder'))

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to reorder categories:', error)
    return err('Failed to reorder categories', 500)
  }
}))

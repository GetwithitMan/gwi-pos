import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { getRequestLocationId } from '@/lib/request-context'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'

const log = createChildLogger('ingredients.bulk-move')

/**
 * PUT /api/ingredients/bulk-move
 * Move multiple ingredients to a different category
 */
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientIds, categoryId } = body

    // Validation
    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return err('ingredientIds must be a non-empty array')
    }

    // categoryId can be null or empty string to move to "Uncategorized"
    const targetCategoryId = categoryId || null

    // If categoryId is provided, verify it exists
    if (targetCategoryId) {
      const category = await db.ingredientCategory.findUnique({
        where: { id: targetCategoryId },
        select: { id: true, name: true },
      })

      if (!category) {
        return err('Target category not found')
      }
    }

    // Update all ingredients in a transaction
    const result = await db.$transaction(async (tx) => {
      const updateResult = await tx.ingredient.updateMany({
        where: {
          id: { in: ingredientIds },
          deletedAt: null,
        },
        data: {
          categoryId: targetCategoryId,
        },
      })

      return updateResult.count
    })

    if (result > 0) {
      pushUpstream()
    }

    // Real-time cross-terminal update — need locationId for socket dispatch
    if (result > 0) {
      // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
      let bulkMoveLocationId = getRequestLocationId()
      if (!bulkMoveLocationId) {
        const sample = await db.ingredient.findFirst({
          where: { id: { in: ingredientIds } },
          select: { locationId: true },
        })
        bulkMoveLocationId = sample?.locationId
      }
      if (bulkMoveLocationId) {
        void emitToLocation(bulkMoveLocationId, 'inventory:changed', { action: 'bulk-move' }).catch(err => log.warn({ err }, 'socket emit failed'))
      }
    }

    return ok({
      success: true,
      movedCount: result,
    })
  } catch (error) {
    console.error('Failed to bulk move ingredients:', error)
    return err('Failed to move ingredients', 500)
  }
}))

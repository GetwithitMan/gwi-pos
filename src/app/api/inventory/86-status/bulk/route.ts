import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { dispatchMenuStockChanged } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('inventory-86-status-bulk')

/**
 * POST /api/inventory/86-status/bulk
 *
 * Bulk update 86 status for multiple ingredients.
 * Useful for donut shops clearing multiple items at once.
 */
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const body = await request.json()
    const { ingredientIds, is86d, employeeId } = body

    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return NextResponse.json(
        { error: 'ingredientIds array is required' },
        { status: 400 }
      )
    }

    if (is86d === undefined) {
      return NextResponse.json(
        { error: 'is86d is required' },
        { status: 400 }
      )
    }

    // Update all ingredients in bulk
    const result = await db.ingredient.updateMany({
      where: {
        id: { in: ingredientIds },
        locationId,
        deletedAt: null
      },
      data: {
        is86d,
        last86dAt: is86d ? new Date() : null,
        last86dBy: is86d ? employeeId : null
      }
    })

    // Get updated ingredients for response
    const updated = await db.ingredient.findMany({
      where: {
        id: { in: ingredientIds },
        locationId,
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        is86d: true
      }
    })

    // Fetch affected menu items for socket dispatch
    const affectedMenuItemLinks = await db.menuItemIngredient.findMany({
      where: {
        ingredientId: { in: ingredientIds },
        deletedAt: null,
      },
      select: {
        menuItem: { select: { id: true } },
      },
    })
    const affectedMenuItemIds = [...new Set(affectedMenuItemLinks.map(l => l.menuItem.id))]

    // Dispatch stock status change for each affected menu item (fire-and-forget)
    for (const itemId of affectedMenuItemIds) {
      void dispatchMenuStockChanged(locationId, {
        itemId,
        stockStatus: is86d ? 'out_of_stock' : 'in_stock',
        isOrderableOnline: !is86d,
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Emit inventory:86-status-changed for admin UI refresh
    void emitToLocation(locationId, 'inventory:86-status-changed', {
      ingredientIds,
      is86d,
      affectedMenuItemIds,
      bulk: true,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      data: {
        updatedCount: result.count,
        ingredients: updated,
        message: is86d
          ? `${result.count} items marked as 86.`
          : `${result.count} items are back in stock.`
      }
    })
  } catch (error) {
    console.error('Error bulk updating 86 status:', error)
    return NextResponse.json({ error: 'Failed to bulk update 86 status' }, { status: 500 })
  }
}))

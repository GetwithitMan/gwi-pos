import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, ok } from '@/lib/api-response'

/**
 * POST /api/menu/items/bulk
 *
 * Fetch multiple menu items by ID in a single query.
 * Used by quick bar, bulk lookups, etc.
 * Replaces N individual GET /api/menu/items/{id} calls with 1 query.
 */
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    const { itemIds } = (await request.json()) as { itemIds: string[] }

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return err('itemIds array required')
    }

    if (itemIds.length > 50) {
      return err('Maximum 50 items per request')
    }

    const items = await db.menuItem.findMany({
      where: { id: { in: itemIds }, locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        itemType: true,
        category: { select: { id: true, name: true, categoryType: true } },
      },
    })

    // Preserve request order
    const itemMap = new Map(items.map(i => [i.id, i]))
    const ordered = itemIds
      .map(id => itemMap.get(id))
      .filter(Boolean)
      .map(item => ({
        id: item!.id,
        name: item!.name,
        price: Number(item!.price),
        categoryId: item!.categoryId,
        itemType: item!.itemType,
        categoryType: item!.category?.categoryType ?? null,
      }))

    return ok({ items: ordered })
  } catch (error) {
    console.error('[menu/items/bulk] POST error:', error)
    return err('Failed to fetch items', 500)
  }
}))

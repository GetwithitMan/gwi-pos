import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { getLocationId } from '@/lib/location-cache'
import { err, ok } from '@/lib/api-response'

/**
 * GET /api/liquor/menu-items
 * List all menu items in liquor categories (what shows on POS)
 */
export const GET = withVenue(withAuth('ADMIN', async function GET(request: NextRequest) {
  try {
    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return err('No location found')
    }

    // Get all liquor categories
    const liquorCategories = await db.category.findMany({
      where: {
        locationId,
        categoryType: 'liquor',
        deletedAt: null,
      },
      select: { id: true },
    })

    const categoryIds = liquorCategories.map(c => c.id)

    // Get all menu items in liquor categories
    const menuItems = await db.menuItem.findMany({
      where: {
        locationId,
        categoryId: { in: categoryIds },
        deletedAt: null,
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            categoryType: true,
          },
        },
        linkedBottleProduct: {
          select: {
            id: true,
            name: true,
            tier: true,
            pourCost: true,
            spiritCategory: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    })

    return ok(menuItems.map((item) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        isActive: item.isActive,
        showOnPOS: item.showOnPOS,
        category: item.category,
        linkedBottleProduct: item.linkedBottleProduct
          ? {
              id: item.linkedBottleProduct.id,
              name: item.linkedBottleProduct.name,
              tier: item.linkedBottleProduct.tier,
              pourCost: item.linkedBottleProduct.pourCost
                ? Number(item.linkedBottleProduct.pourCost)
                : null,
              spiritCategory: item.linkedBottleProduct.spiritCategory,
            }
          : null,
      })))
  } catch (error) {
    console.error('Failed to fetch liquor menu items:', error)
    return err('Failed to fetch liquor menu items', 500)
  }
}))

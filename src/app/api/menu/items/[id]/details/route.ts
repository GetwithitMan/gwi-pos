import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

/**
 * GET /api/menu/items/[id]/details
 * Returns item detail for the long-hold popover: name, description, category, recipe + ingredients, 86'd status.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const item = await db.menuItem.findFirst({
      where: { id, locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        isAvailable: true,
        is86d: true,
        itemType: true,
        category: {
          select: { id: true, name: true, categoryType: true },
        },
        recipe: {
          select: {
            id: true,
            totalCost: true,
            foodCostPct: true,
            ingredients: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                quantity: true,
                unit: true,
                cost: true,
                notes: true,
                inventoryItem: {
                  select: { id: true, name: true, storageUnit: true },
                },
                prepItem: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
        ingredients: {
          where: { deletedAt: null },
          select: {
            id: true,
            ingredient: {
              select: { id: true, name: true },
            },
            isDefault: true,
            isRequired: true,
          },
        },
      },
    })

    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: item.id,
        name: item.name,
        description: item.description,
        price: Number(item.price),
        isAvailable: item.isAvailable,
        is86d: item.is86d,
        itemType: item.itemType,
        category: item.category ? {
          id: item.category.id,
          name: item.category.name,
          categoryType: item.category.categoryType,
        } : null,
        recipe: item.recipe ? {
          totalCost: item.recipe.totalCost ? Number(item.recipe.totalCost) : null,
          foodCostPct: item.recipe.foodCostPct ? Number(item.recipe.foodCostPct) : null,
          ingredients: item.recipe.ingredients.map(ing => ({
            id: ing.id,
            name: ing.inventoryItem?.name || ing.prepItem?.name || 'Unknown',
            quantity: ing.quantity ? Number(ing.quantity) : null,
            unit: ing.unit,
            cost: ing.cost ? Number(ing.cost) : null,
            notes: ing.notes,
          })),
        } : null,
        ingredients: item.ingredients.map(ing => ({
          id: ing.id,
          name: ing.ingredient?.name || 'Unknown',
          isDefault: ing.isDefault,
          isRequired: ing.isRequired,
        })),
      },
    })
  } catch (error) {
    console.error('[menu/items/[id]/details] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch item details' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'
import { getActorFromRequest, requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { err, notFound, ok } from '@/lib/api-response'

/**
 * GET /api/menu/items/[id]/details
 * Returns item detail for the long-hold popover: name, description, category, recipe + ingredients, availability.
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return err('locationId is required')
    }

    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || request.nextUrl.searchParams.get('employeeId')
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const item = await db.menuItem.findFirst({
      where: { id, locationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        isAvailable: true,
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
              select: { id: true, name: true, is86d: true },
            },
            isIncluded: true,
          },
        },
      },
    })

    if (!item) {
      return notFound('Item not found')
    }

    // Derive 86'd status from ingredients
    const hasOutOfStockIngredient = item.ingredients.some(
      (mi) => mi.ingredient?.is86d === true
    )

    return ok({
        id: item.id,
        name: item.name,
        description: item.description,
        price: Number(item.price),
        isAvailable: item.isAvailable,
        is86d: hasOutOfStockIngredient,
        itemType: item.itemType,
        category: item.category ? {
          id: item.category.id,
          name: item.category.name,
          categoryType: item.category.categoryType,
        } : null,
        recipe: item.recipe ? {
          totalCost: item.recipe.totalCost ? Number(item.recipe.totalCost) : null,
          foodCostPct: item.recipe.foodCostPct ? Number(item.recipe.foodCostPct) : null,
          ingredients: item.recipe.ingredients.map((ing) => ({
            id: ing.id,
            name: ing.inventoryItem?.name || ing.prepItem?.name || 'Unknown',
            quantity: ing.quantity ? Number(ing.quantity) : null,
            unit: ing.unit,
            cost: ing.cost ? Number(ing.cost) : null,
            notes: ing.notes,
          })),
        } : null,
        ingredients: item.ingredients.map((mi) => ({
          id: mi.id,
          name: mi.ingredient?.name || 'Unknown',
          isIncluded: mi.isIncluded,
          is86d: mi.ingredient?.is86d ?? false,
        })),
      })
  } catch (error) {
    console.error('[menu/items/[id]/details] Error:', error)
    return err('Failed to fetch item details', 500)
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/menu/items/[id]/ingredients - Get ingredients for a menu item
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params

    // Verify menu item exists
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    const ingredients = await db.menuItemIngredient.findMany({
      where: { menuItemId },
      include: {
        ingredient: {
          include: {
            swapModifierGroup: {
              select: {
                id: true,
                name: true,
                modifiers: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    name: true,
                    price: true,
                  },
                  orderBy: { sortOrder: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: ingredients.map(mi => ({
        id: mi.id,
        ingredientId: mi.ingredientId,
        name: mi.ingredient.name,
        category: mi.ingredient.category,
        isIncluded: mi.isIncluded,
        sortOrder: mi.sortOrder,
        // Modification options (use override if set, otherwise ingredient default)
        allowNo: mi.ingredient.allowNo,
        allowLite: mi.ingredient.allowLite,
        allowOnSide: mi.ingredient.allowOnSide,
        allowExtra: mi.ingredient.allowExtra,
        extraPrice: Number(mi.extraPriceOverride ?? mi.ingredient.extraPrice),
        allowSwap: mi.ingredient.allowSwap,
        swapUpcharge: Number(mi.swapUpchargeOverride ?? mi.ingredient.swapUpcharge),
        // Swap options
        swapModifierGroup: mi.ingredient.swapModifierGroup ? {
          id: mi.ingredient.swapModifierGroup.id,
          name: mi.ingredient.swapModifierGroup.name,
          modifiers: mi.ingredient.swapModifierGroup.modifiers.map(m => ({
            id: m.id,
            name: m.name,
            price: Number(m.price),
          })),
        } : null,
        // Override flags
        hasExtraPriceOverride: mi.extraPriceOverride !== null,
        hasSwapUpchargeOverride: mi.swapUpchargeOverride !== null,
      })),
    })
  } catch (error) {
    console.error('Error fetching menu item ingredients:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredients' }, { status: 500 })
  }
}

// POST /api/menu/items/[id]/ingredients - Save ingredients for a menu item
// Replaces all existing ingredient links
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId } = await params
    const body = await request.json()
    const { ingredients } = body // Array of { ingredientId, isIncluded?, extraPriceOverride?, swapUpchargeOverride? }

    if (!Array.isArray(ingredients)) {
      return NextResponse.json({ error: 'ingredients array is required' }, { status: 400 })
    }

    // Verify menu item exists and get locationId
    const menuItem = await db.menuItem.findUnique({
      where: { id: menuItemId },
      select: { id: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    // Verify all ingredient IDs exist
    const ingredientIds = ingredients.map(i => i.ingredientId)
    const existingIngredients = await db.ingredient.findMany({
      where: { id: { in: ingredientIds }, locationId: menuItem.locationId },
      select: { id: true },
    })
    const existingIds = new Set(existingIngredients.map(i => i.id))
    const invalidIds = ingredientIds.filter(id => !existingIds.has(id))
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: `Invalid ingredient IDs: ${invalidIds.join(', ')}` },
        { status: 400 }
      )
    }

    // Delete existing and create new in a transaction
    await db.$transaction(async (tx) => {
      // Delete existing links
      await tx.menuItemIngredient.deleteMany({
        where: { menuItemId },
      })

      // Create new links
      if (ingredients.length > 0) {
        await tx.menuItemIngredient.createMany({
          data: ingredients.map((ing, index) => ({
            locationId: menuItem.locationId,
            menuItemId,
            ingredientId: ing.ingredientId,
            isIncluded: ing.isIncluded ?? true,
            sortOrder: ing.sortOrder ?? index,
            extraPriceOverride: ing.extraPriceOverride ?? null,
            swapUpchargeOverride: ing.swapUpchargeOverride ?? null,
          })),
        })
      }
    })

    // Fetch and return updated ingredients
    const updated = await db.menuItemIngredient.findMany({
      where: { menuItemId },
      include: {
        ingredient: {
          include: {
            swapModifierGroup: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: updated.map(mi => ({
        id: mi.id,
        ingredientId: mi.ingredientId,
        name: mi.ingredient.name,
        category: mi.ingredient.category,
        isIncluded: mi.isIncluded,
        sortOrder: mi.sortOrder,
        extraPrice: Number(mi.extraPriceOverride ?? mi.ingredient.extraPrice),
        swapUpcharge: Number(mi.swapUpchargeOverride ?? mi.ingredient.swapUpcharge),
      })),
    })
  } catch (error) {
    console.error('Error saving menu item ingredients:', error)
    return NextResponse.json({ error: 'Failed to save ingredients' }, { status: 500 })
  }
}

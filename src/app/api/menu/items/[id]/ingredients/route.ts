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
            swapGroup: {
              select: {
                id: true,
                name: true,
                ingredients: {
                  where: { isActive: true, deletedAt: null },
                  select: {
                    id: true,
                    name: true,
                    extraPrice: true,
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
        allowNo: mi.allowNo ?? mi.ingredient.allowNo,
        allowLite: mi.allowLite ?? mi.ingredient.allowLite,
        allowOnSide: mi.allowOnSide ?? mi.ingredient.allowOnSide,
        allowExtra: mi.allowExtra ?? mi.ingredient.allowExtra,
        extraPrice: Number(mi.extraPrice ?? mi.ingredient.extraPrice),
        allowSwap: mi.ingredient.allowSwap,
        swapUpcharge: Number(mi.ingredient.swapUpcharge),
        // Swap options (ingredients that can be swapped for this one)
        swapGroup: mi.ingredient.swapGroup ? {
          id: mi.ingredient.swapGroup.id,
          name: mi.ingredient.swapGroup.name,
          ingredients: mi.ingredient.swapGroup.ingredients.map(ing => ({
            id: ing.id,
            name: ing.name,
            extraPrice: Number(ing.extraPrice),
          })),
        } : null,
        // Override flags
        hasExtraPriceOverride: mi.extraPrice !== null,
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
    // Array of { ingredientId, isIncluded?, allowNo?, allowLite?, allowExtra?, allowOnSide?, extraPriceOverride?, swapUpchargeOverride? }
    const { ingredients } = body

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
            isBase: ing.isBase ?? true,
            sortOrder: ing.sortOrder ?? index,
            quantity: ing.quantity ?? null,
            unit: ing.unit ?? null,
            // Pre-modifier overrides (null = use ingredient defaults)
            allowNo: ing.allowNo ?? null,
            allowLite: ing.allowLite ?? null,
            allowExtra: ing.allowExtra ?? null,
            allowOnSide: ing.allowOnSide ?? null,
            extraPrice: ing.extraPrice ?? null,
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
            swapGroup: {
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
        isBase: mi.isBase,
        sortOrder: mi.sortOrder,
        extraPrice: Number(mi.extraPrice ?? mi.ingredient.extraPrice),
        swapUpcharge: Number(mi.ingredient.swapUpcharge),
      })),
    })
  } catch (error) {
    console.error('Error saving menu item ingredients:', error)
    return NextResponse.json({ error: 'Failed to save ingredients' }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/menu/items/[id]/recipe
 * Get recipe ingredients for a menu item (cocktail)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get the menu item with its recipe
    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        price: true,
        recipeIngredients: {
          include: {
            bottleProduct: {
              select: {
                id: true,
                name: true,
                brand: true,
                displayName: true,
                tier: true,
                pourCost: true,
                pourSizeOz: true,
                spiritCategory: {
                  select: {
                    id: true,
                    name: true,
                    displayName: true,
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Calculate total pour cost
    const ingredients = menuItem.recipeIngredients.map((ing) => ({
      id: ing.id,
      bottleProductId: ing.bottleProductId,
      bottleProduct: {
        ...ing.bottleProduct,
        pourCost: ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : null,
        pourSizeOz: ing.bottleProduct.pourSizeOz ? Number(ing.bottleProduct.pourSizeOz) : null,
      },
      pourCount: Number(ing.pourCount),
      pourSizeOz: ing.pourSizeOz ? Number(ing.pourSizeOz) : null,
      isRequired: ing.isRequired,
      isSubstitutable: ing.isSubstitutable,
      sortOrder: ing.sortOrder,
      notes: ing.notes,
      ingredientCost: ing.bottleProduct.pourCost
        ? Number(ing.bottleProduct.pourCost) * Number(ing.pourCount)
        : 0,
    }))

    const totalPourCost = ingredients.reduce(
      (sum, ing) => sum + ing.ingredientCost,
      0
    )

    const sellPrice = Number(menuItem.price)
    const profitMargin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

    return NextResponse.json({
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      sellPrice,
      ingredients,
      totalPourCost: Math.round(totalPourCost * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
    })
  } catch (error) {
    console.error('Failed to fetch recipe:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recipe' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/menu/items/[id]/recipe
 * Save recipe ingredients for a menu item
 * Replaces all existing ingredients with the new list
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { ingredients } = body

    if (!Array.isArray(ingredients)) {
      return NextResponse.json(
        { error: 'Ingredients must be an array' },
        { status: 400 }
      )
    }

    // Verify menu item exists
    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: { id: true, name: true, price: true },
    })

    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Validate all bottle product IDs exist
    const bottleIds = ingredients.map((ing: any) => ing.bottleProductId)
    const bottles = await db.bottleProduct.findMany({
      where: { id: { in: bottleIds } },
      select: { id: true, pourCost: true },
    })

    const foundIds = new Set(bottles.map((b) => b.id))
    const missingIds = bottleIds.filter((id: string) => !foundIds.has(id))

    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: `Bottle products not found: ${missingIds.join(', ')}` },
        { status: 400 }
      )
    }

    // Delete existing ingredients and create new ones in a transaction
    await db.$transaction(async (tx) => {
      // Delete existing ingredients
      await tx.recipeIngredient.deleteMany({
        where: { menuItemId: id },
      })

      // Create new ingredients
      if (ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: ingredients.map((ing: any, index: number) => ({
            menuItemId: id,
            bottleProductId: ing.bottleProductId,
            pourCount: ing.pourCount || 1,
            pourSizeOz: ing.pourSizeOz || null,
            isRequired: ing.isRequired !== false,
            isSubstitutable: ing.isSubstitutable !== false,
            sortOrder: ing.sortOrder ?? index,
            notes: ing.notes || null,
          })),
        })
      }
    })

    // Fetch the updated recipe to return
    const updatedRecipe = await db.recipeIngredient.findMany({
      where: { menuItemId: id },
      include: {
        bottleProduct: {
          select: {
            id: true,
            name: true,
            brand: true,
            displayName: true,
            tier: true,
            pourCost: true,
            pourSizeOz: true,
            spiritCategory: {
              select: {
                id: true,
                name: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Calculate totals
    const resultIngredients = updatedRecipe.map((ing) => ({
      id: ing.id,
      bottleProductId: ing.bottleProductId,
      bottleProduct: {
        ...ing.bottleProduct,
        pourCost: ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : null,
        pourSizeOz: ing.bottleProduct.pourSizeOz ? Number(ing.bottleProduct.pourSizeOz) : null,
      },
      pourCount: Number(ing.pourCount),
      pourSizeOz: ing.pourSizeOz ? Number(ing.pourSizeOz) : null,
      isRequired: ing.isRequired,
      isSubstitutable: ing.isSubstitutable,
      sortOrder: ing.sortOrder,
      notes: ing.notes,
      ingredientCost: ing.bottleProduct.pourCost
        ? Number(ing.bottleProduct.pourCost) * Number(ing.pourCount)
        : 0,
    }))

    const totalPourCost = resultIngredients.reduce(
      (sum, ing) => sum + ing.ingredientCost,
      0
    )

    const sellPrice = Number(menuItem.price)
    const profitMargin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

    return NextResponse.json({
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      sellPrice,
      ingredients: resultIngredients,
      totalPourCost: Math.round(totalPourCost * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
    })
  } catch (error) {
    console.error('Failed to save recipe:', error)
    return NextResponse.json(
      { error: 'Failed to save recipe' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/menu/items/[id]/recipe
 * Remove all recipe ingredients from a menu item
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.recipeIngredient.deleteMany({
      where: { menuItemId: id },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete recipe:', error)
    return NextResponse.json(
      { error: 'Failed to delete recipe' },
      { status: 500 }
    )
  }
}

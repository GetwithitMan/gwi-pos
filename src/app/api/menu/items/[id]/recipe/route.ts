import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuItemChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// Shared include shape for recipe queries
const recipeInclude = {
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
  ingredient: {
    select: {
      id: true,
      name: true,
      categoryRelation: {
        select: { id: true, name: true, icon: true, color: true },
      },
      standardQuantity: true,
      standardUnit: true,
      purchaseCost: true,
      unitsPerPurchase: true,
      inventoryItemId: true,
      inventoryItem: {
        select: { id: true, costPerUnit: true, storageUnit: true },
      },
    },
  },
} as const

/** Calculate cost for a single recipe ingredient */
function calcIngredientCost(ing: any): number {
  // Spirit ingredient — cost from pour
  if (ing.bottleProduct) {
    const pourCost = ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : 0
    return pourCost * Number(ing.pourCount)
  }
  // Food ingredient — cost from inventory item or purchase info
  if (ing.ingredient) {
    const qty = ing.quantity ? Number(ing.quantity) : 0
    if (ing.ingredient.inventoryItem?.costPerUnit) {
      return Number(ing.ingredient.inventoryItem.costPerUnit) * qty
    }
    if (ing.ingredient.purchaseCost && ing.ingredient.unitsPerPurchase) {
      return (Number(ing.ingredient.purchaseCost) / Number(ing.ingredient.unitsPerPurchase)) * qty
    }
  }
  return 0
}

/** Map a raw recipe ingredient to the API response shape */
function mapIngredient(ing: any) {
  return {
    id: ing.id,
    // Spirit fields
    bottleProductId: ing.bottleProductId,
    bottleProduct: ing.bottleProduct
      ? {
          ...ing.bottleProduct,
          pourCost: ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : null,
          pourSizeOz: ing.bottleProduct.pourSizeOz ? Number(ing.bottleProduct.pourSizeOz) : null,
        }
      : null,
    // Food fields
    ingredientId: ing.ingredientId,
    ingredient: ing.ingredient
      ? {
          ...ing.ingredient,
          standardQuantity: ing.ingredient.standardQuantity ? Number(ing.ingredient.standardQuantity) : null,
          purchaseCost: ing.ingredient.purchaseCost ? Number(ing.ingredient.purchaseCost) : null,
          unitsPerPurchase: ing.ingredient.unitsPerPurchase ? Number(ing.ingredient.unitsPerPurchase) : null,
        }
      : null,
    // Common fields
    pourCount: Number(ing.pourCount),
    pourSizeOz: ing.pourSizeOz ? Number(ing.pourSizeOz) : null,
    quantity: ing.quantity ? Number(ing.quantity) : null,
    unit: ing.unit,
    isRequired: ing.isRequired,
    isSubstitutable: ing.isSubstitutable,
    sortOrder: ing.sortOrder,
    notes: ing.notes,
    type: ing.bottleProductId ? 'spirit' : 'food',
    ingredientCost: calcIngredientCost(ing),
  }
}

/**
 * GET /api/menu/items/[id]/recipe
 * Get recipe ingredients for a menu item (cocktail)
 */
export const GET = withVenue(async function GET(
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
          include: recipeInclude,
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

    const ingredients = menuItem.recipeIngredients.map(mapIngredient)
    const totalPourCost = ingredients.reduce((sum, ing) => sum + ing.ingredientCost, 0)
    const sellPrice = Number(menuItem.price)
    const profitMargin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

    return NextResponse.json({ data: {
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      sellPrice,
      ingredients,
      totalPourCost: Math.round(totalPourCost * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
    } })
  } catch (error) {
    console.error('Failed to fetch recipe:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recipe' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/menu/items/[id]/recipe
 * Save recipe ingredients for a menu item
 * Replaces all existing ingredients with the new list
 */
export const POST = withVenue(async function POST(
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
      select: { id: true, name: true, price: true, locationId: true },
    })

    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Split into spirit and food ingredients
    const spiritIngs = ingredients.filter((ing: any) => ing.bottleProductId)
    const foodIngs = ingredients.filter((ing: any) => ing.ingredientId && !ing.bottleProductId)

    // Validate each ingredient has either bottleProductId or ingredientId
    for (const ing of ingredients) {
      if (!ing.bottleProductId && !ing.ingredientId) {
        return NextResponse.json(
          { error: 'Each ingredient must have either bottleProductId or ingredientId' },
          { status: 400 }
        )
      }
    }

    // Validate all bottle product IDs exist
    if (spiritIngs.length > 0) {
      const bottleIds = spiritIngs.map((ing: any) => ing.bottleProductId)
      const bottles = await db.bottleProduct.findMany({
        where: { id: { in: bottleIds } },
        select: { id: true },
      })
      const foundIds = new Set(bottles.map((b) => b.id))
      const missingIds = bottleIds.filter((bid: string) => !foundIds.has(bid))
      if (missingIds.length > 0) {
        return NextResponse.json(
          { error: `Bottle products not found: ${missingIds.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Validate all ingredient IDs exist
    if (foodIngs.length > 0) {
      const ingIds = foodIngs.map((ing: any) => ing.ingredientId)
      const found = await db.ingredient.findMany({
        where: { id: { in: ingIds } },
        select: { id: true },
      })
      const foundIds = new Set(found.map((i) => i.id))
      const missingIds = ingIds.filter((iid: string) => !foundIds.has(iid))
      if (missingIds.length > 0) {
        return NextResponse.json(
          { error: `Ingredients not found: ${missingIds.join(', ')}` },
          { status: 400 }
        )
      }
    }

    // Delete existing ingredients and create new ones in a transaction
    await db.$transaction(async (tx) => {
      await tx.recipeIngredient.deleteMany({
        where: { menuItemId: id },
      })

      if (ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: ingredients.map((ing: any, index: number) => ({
            locationId: menuItem.locationId,
            menuItemId: id,
            bottleProductId: ing.bottleProductId || null,
            ingredientId: ing.ingredientId || null,
            pourCount: ing.pourCount || 1,
            pourSizeOz: ing.pourSizeOz || null,
            quantity: ing.quantity ?? null,
            unit: ing.unit || null,
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
      include: recipeInclude,
      orderBy: { sortOrder: 'asc' },
    })

    const resultIngredients = updatedRecipe.map(mapIngredient)
    const totalPourCost = resultIngredients.reduce((sum, ing) => sum + ing.ingredientCost, 0)
    const sellPrice = Number(menuItem.price)
    const profitMargin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

    // Fire-and-forget socket dispatch for real-time menu updates
    void dispatchMenuItemChanged(menuItem.locationId, {
      itemId: id,
      action: 'updated',
      changes: { recipe: true },
    }).catch(() => {})

    return NextResponse.json({ data: {
      menuItemId: menuItem.id,
      menuItemName: menuItem.name,
      sellPrice,
      ingredients: resultIngredients,
      totalPourCost: Math.round(totalPourCost * 100) / 100,
      profitMargin: Math.round(profitMargin * 10) / 10,
    } })
  } catch (error) {
    console.error('Failed to save recipe:', error)
    return NextResponse.json(
      { error: 'Failed to save recipe' },
      { status: 500 }
    )
  }
})

/**
 * PATCH /api/menu/items/[id]/recipe
 * Add a single ingredient to an existing recipe without replacing others
 * Used by auto-link to add the linked bottle at position 0
 */
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { bottleProductId, pourCount, isSubstitutable } = await request.json()

    if (!bottleProductId) {
      return NextResponse.json(
        { error: 'bottleProductId is required' },
        { status: 400 }
      )
    }

    // Verify menu item exists
    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: { id: true, locationId: true },
    })
    if (!menuItem) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Check if this bottle is already in the recipe
    const existing = await db.recipeIngredient.findFirst({
      where: { menuItemId: id, bottleProductId },
    })
    if (existing) {
      return NextResponse.json({ data: { alreadyExists: true } })
    }

    // Validate bottle exists
    const bottle = await db.bottleProduct.findUnique({
      where: { id: bottleProductId },
      select: { id: true },
    })
    if (!bottle) {
      return NextResponse.json(
        { error: 'Bottle product not found' },
        { status: 400 }
      )
    }

    // Add at position 0, shift existing ingredients
    await db.$transaction([
      db.recipeIngredient.updateMany({
        where: { menuItemId: id },
        data: { sortOrder: { increment: 1 } },
      }),
      db.recipeIngredient.create({
        data: {
          locationId: menuItem.locationId,
          menuItemId: id,
          bottleProductId,
          pourCount: pourCount ?? 1,
          isSubstitutable: isSubstitutable !== false,
          sortOrder: 0,
        },
      }),
    ])

    // Fetch the updated recipe to return
    const updatedRecipe = await db.recipeIngredient.findMany({
      where: { menuItemId: id },
      include: recipeInclude,
      orderBy: { sortOrder: 'asc' },
    })

    const resultIngredients = updatedRecipe.map(mapIngredient)

    // Fire-and-forget socket dispatch
    void dispatchMenuItemChanged(menuItem.locationId, {
      itemId: id,
      action: 'updated',
      changes: { recipe: true },
    }).catch(() => {})

    return NextResponse.json({ data: { ingredients: resultIngredients } })
  } catch (error) {
    console.error('Failed to add recipe ingredient:', error)
    return NextResponse.json(
      { error: 'Failed to add recipe ingredient' },
      { status: 500 }
    )
  }
})

/**
 * DELETE /api/menu/items/[id]/recipe
 * Remove all recipe ingredients from a menu item
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get locationId for socket dispatch
    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: { locationId: true },
    })

    await db.recipeIngredient.deleteMany({
      where: { menuItemId: id },
    })

    // Fire-and-forget socket dispatch for real-time menu updates
    if (menuItem) {
      void dispatchMenuItemChanged(menuItem.locationId, {
        itemId: id,
        action: 'updated',
        changes: { recipe: true },
      }).catch(() => {})
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete recipe:', error)
    return NextResponse.json(
      { error: 'Failed to delete recipe' },
      { status: 500 }
    )
  }
})

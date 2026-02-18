import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

/**
 * GET /api/liquor/recipes
 * List all cocktails that have recipes defined
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get('categoryId')
    const hasRecipe = searchParams.get('hasRecipe')

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Find all menu items in liquor categories (or optionally filtered by category)
    const menuItems = await db.menuItem.findMany({
      where: {
        locationId,
        isActive: true,
        category: {
          categoryType: 'liquor',
          ...(categoryId && { id: categoryId }),
        },
        ...(hasRecipe === 'true' && {
          recipeIngredients: {
            some: {},
          },
        }),
        ...(hasRecipe === 'false' && {
          recipeIngredients: {
            none: {},
          },
        }),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        recipeIngredients: {
          include: {
            bottleProduct: {
              select: {
                id: true,
                name: true,
                tier: true,
                pourCost: true,
                spiritCategory: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
    })

    // Calculate pour cost and margin for each item
    const cocktails = menuItems.map((item) => {
      const ingredients = item.recipeIngredients.map((ing) => ({
        id: ing.id,
        bottleProductId: ing.bottleProductId,
        bottleProductName: ing.bottleProduct.name,
        spiritCategory: ing.bottleProduct.spiritCategory.name,
        tier: ing.bottleProduct.tier,
        pourCount: Number(ing.pourCount),
        pourCost: ing.bottleProduct.pourCost ? Number(ing.bottleProduct.pourCost) : 0,
        isSubstitutable: ing.isSubstitutable,
        ingredientCost: ing.bottleProduct.pourCost
          ? Number(ing.bottleProduct.pourCost) * Number(ing.pourCount)
          : 0,
      }))

      const totalPourCost = ingredients.reduce(
        (sum, ing) => sum + ing.ingredientCost,
        0
      )

      const sellPrice = Number(item.price)
      const profitMargin = sellPrice > 0 ? ((sellPrice - totalPourCost) / sellPrice) * 100 : 0

      return {
        id: item.id,
        name: item.name,
        description: item.description,
        sellPrice,
        category: item.category,
        hasRecipe: ingredients.length > 0,
        ingredientCount: ingredients.length,
        ingredients: ingredients.length > 0 ? ingredients : undefined,
        totalPourCost: Math.round(totalPourCost * 100) / 100,
        profitMargin: Math.round(profitMargin * 10) / 10,
        grossProfit: Math.round((sellPrice - totalPourCost) * 100) / 100,
      }
    })

    // Summary stats
    const withRecipes = cocktails.filter((c) => c.hasRecipe)
    const avgMargin = withRecipes.length > 0
      ? withRecipes.reduce((sum, c) => sum + c.profitMargin, 0) / withRecipes.length
      : 0

    return NextResponse.json({
      cocktails,
      summary: {
        total: cocktails.length,
        withRecipes: withRecipes.length,
        withoutRecipes: cocktails.length - withRecipes.length,
        averageMargin: Math.round(avgMargin * 10) / 10,
      },
    })
  } catch (error) {
    console.error('Failed to fetch cocktail recipes:', error)
    return NextResponse.json(
      { error: 'Failed to fetch cocktail recipes' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/ingredients/:id/recipe-cost
 *
 * Returns aggregated recipe cost for an ingredient
 * Reduces network chatter by calculating total cost server-side
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Get the ingredient with its recipe components
    const ingredient = await db.ingredient.findUnique({
      where: { id },
      include: {
        recipeComponents: {
          where: { deletedAt: null },
          include: {
            component: {
              select: {
                id: true,
                name: true,
                standardQuantity: true,
                standardUnit: true,
                purchaseCost: true,
                unitsPerPurchase: true,
                parentIngredient: {
                  select: {
                    purchaseCost: true,
                    unitsPerPurchase: true,
                    standardUnit: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!ingredient) {
      return NextResponse.json(
        { error: 'Ingredient not found' },
        { status: 404 }
      )
    }

    // Calculate total recipe cost
    let totalCost = 0
    const componentCosts: Array<{
      componentId: string
      name: string
      quantity: number
      unit: string
      costPerUnit: number | null
      totalCost: number
    }> = []

    for (const recipeComponent of ingredient.recipeComponents) {
      const component = recipeComponent.component
      let costPerUnit: number | null = null

      // Determine cost per unit based on source
      if (component.purchaseCost && component.unitsPerPurchase) {
        // Direct purchase cost
        costPerUnit = Number(component.purchaseCost) / Number(component.unitsPerPurchase)
      } else if (component.parentIngredient?.purchaseCost && component.parentIngredient?.unitsPerPurchase) {
        // Parent's purchase cost
        costPerUnit = Number(component.parentIngredient.purchaseCost) / Number(component.parentIngredient.unitsPerPurchase)
      }

      const componentTotalCost = costPerUnit ? costPerUnit * Number(recipeComponent.quantity) : 0
      totalCost += componentTotalCost

      componentCosts.push({
        componentId: component.id,
        name: component.name,
        quantity: Number(recipeComponent.quantity),
        unit: recipeComponent.unit,
        costPerUnit,
        totalCost: componentTotalCost,
      })
    }

    // Calculate cost per output unit if recipe yield is defined
    let costPerOutputUnit: number | null = null
    if (ingredient.recipeYieldQuantity && Number(ingredient.recipeYieldQuantity) > 0) {
      costPerOutputUnit = totalCost / Number(ingredient.recipeYieldQuantity)
    }

    return NextResponse.json({
      data: {
        ingredientId: ingredient.id,
        totalRecipeCost: totalCost,
        recipeYieldQuantity: ingredient.recipeYieldQuantity ? Number(ingredient.recipeYieldQuantity) : null,
        recipeYieldUnit: ingredient.recipeYieldUnit,
        costPerOutputUnit,
        componentCosts,
      },
    })
  } catch (error) {
    console.error('Recipe cost calculation error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate recipe cost' },
      { status: 500 }
    )
  }
})

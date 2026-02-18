import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { convert } from '@/lib/unit-conversions'
import { withVenue } from '@/lib/with-venue'

/**
 * Calculate cost per unit for a single ingredient from DB data (no HTTP calls).
 * Handles: delivered (purchaseCost), recipe (sum components), parent fallback.
 */
async function calculateIngredientCost(ingredientId: string): Promise<{
  costPerUnit: number | null
  costUnit: string
  costSource: 'purchase' | 'recipe' | 'parent' | 'unknown'
}> {
  const ingredient = await db.ingredient.findUnique({
    where: { id: ingredientId },
    include: {
      parentIngredient: true,
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
              sourceType: true,
              // For components that are themselves prep items
              parentIngredientId: true,
              parentIngredient: {
                select: {
                  purchaseCost: true,
                  unitsPerPurchase: true,
                  standardUnit: true,
                  standardQuantity: true,
                  // Check if parent has a recipe (for recursive cost)
                  recipeYieldQuantity: true,
                  recipeYieldUnit: true,
                },
              },
            },
          },
        },
      },
      inventoryItem: true,
    },
  })

  if (!ingredient) {
    return { costPerUnit: null, costUnit: 'each', costSource: 'unknown' }
  }

  let costPerUnit: number | null = null
  let costUnit = ingredient.standardUnit || 'each'
  let costSource: 'purchase' | 'recipe' | 'parent' | 'unknown' = 'unknown'

  // 1. If this is a delivered item with purchaseCost, use that directly
  if (ingredient.purchaseCost) {
    const unitsQty = Number(ingredient.unitsPerPurchase) || Number(ingredient.standardQuantity) || 1
    costPerUnit = Number(ingredient.purchaseCost) / unitsQty
    costUnit = ingredient.standardUnit || 'each'
    costSource = 'purchase'
    return { costPerUnit: Math.round(costPerUnit * 10000) / 10000, costUnit, costSource }
  }

  // 2. If this has a recipe, calculate cost from components directly (no HTTP)
  if (ingredient.recipeComponents.length > 0) {
    let totalRecipeCost = 0
    let allComponentsHaveCost = true

    for (const recipeComp of ingredient.recipeComponents) {
      const comp = recipeComp.component
      let compCostPerUnit: number | null = null

      // Try component's own purchase cost first
      if (comp.purchaseCost) {
        const compUnits = Number(comp.unitsPerPurchase) || Number(comp.standardQuantity) || 1
        compCostPerUnit = Number(comp.purchaseCost) / compUnits
      }
      // Fallback: check parent's purchase cost (for prep items used in recipes)
      else if (comp.parentIngredient?.purchaseCost) {
        const parentUnits = Number(comp.parentIngredient.unitsPerPurchase) || Number(comp.parentIngredient.standardQuantity) || 1
        compCostPerUnit = Number(comp.parentIngredient.purchaseCost) / parentUnits
      }

      if (compCostPerUnit !== null) {
        const compQty = Number(recipeComp.quantity)
        totalRecipeCost += compCostPerUnit * compQty
      } else {
        allComponentsHaveCost = false
      }
    }

    if (totalRecipeCost > 0) {
      const recipeYieldQty = Number(ingredient.recipeYieldQuantity) || Number(ingredient.standardQuantity) || 1
      costPerUnit = totalRecipeCost / recipeYieldQty
      costUnit = ingredient.recipeYieldUnit || ingredient.standardUnit || 'each'
      costSource = 'recipe'
      return { costPerUnit: Math.round(costPerUnit * 10000) / 10000, costUnit, costSource }
    }
  }

  // 3. If this is a prep item (has parent), derive cost from parent
  if (ingredient.parentIngredientId && ingredient.parentIngredient) {
    const parentCost = await calculateIngredientCost(ingredient.parentIngredientId)

    if (parentCost.costPerUnit !== null) {
      const inputQty = Number(ingredient.inputQuantity) || Number(ingredient.portionSize) || 1
      const inputUnit = ingredient.inputUnit || ingredient.portionUnit || ingredient.parentIngredient.standardUnit || 'each'
      const outputQty = Number(ingredient.outputQuantity) || 1
      const outputUnit = ingredient.outputUnit || 'each'
      const yieldPercent = Number(ingredient.yieldPercent) || 1

      // Convert input to parent's cost unit if needed
      const parentUnit = parentCost.costUnit || ingredient.parentIngredient.standardUnit || 'each'
      let inputInParentUnits = inputQty

      if (inputUnit !== parentUnit) {
        const converted = convert(inputQty, inputUnit, parentUnit)
        if (converted !== null) {
          inputInParentUnits = converted
        }
      }

      // Calculate: (parentCost * inputAmount) / outputAmount / yieldPercent
      const inputCost = parentCost.costPerUnit * inputInParentUnits
      costPerUnit = inputCost / outputQty / yieldPercent
      costUnit = outputUnit
      costSource = 'parent'
      return { costPerUnit: Math.round(costPerUnit * 10000) / 10000, costUnit, costSource }
    }
  }

  // 4. If linked to inventory item with cost
  if (ingredient.inventoryItem?.costPerUnit) {
    costPerUnit = Number(ingredient.inventoryItem.costPerUnit)
    costUnit = ingredient.standardUnit || 'each'
    costSource = 'purchase'
    return { costPerUnit: Math.round(costPerUnit * 10000) / 10000, costUnit, costSource }
  }

  return { costPerUnit: null, costUnit, costSource: 'unknown' }
}

/**
 * GET /api/ingredients/[id]/cost
 *
 * Returns the cost per unit for an ingredient.
 * For delivered items: Uses purchase price
 * For recipe items: Sums component costs directly from DB
 * For prep items: Derives cost from parent ingredient
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const result = await calculateIngredientCost(id)

    if (result.costPerUnit === null) {
      return NextResponse.json({ data: {
        costPerUnit: null,
        costUnit: result.costUnit,
        costSource: 'unknown',
        message: 'No cost data available. Set up purchase price or link to inventory.',
      } })
    }

    return NextResponse.json({ data: {
      costPerUnit: result.costPerUnit,
      costUnit: result.costUnit,
      costSource: result.costSource,
    } })
  } catch (error) {
    console.error('Failed to calculate ingredient cost:', error)
    return NextResponse.json(
      { error: 'Failed to calculate cost' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import db from '@/lib/db'
import { convert } from '@/lib/unit-conversions'

/**
 * GET /api/ingredients/[id]/cost
 *
 * Returns the cost per unit for an ingredient.
 * For inventory items: Uses last purchase price or recipe cost
 * For prep items: Derives cost from parent ingredient
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // Fetch the ingredient with parent and recipe info
    const ingredient = await db.ingredient.findUnique({
      where: { id },
      include: {
        parentIngredient: true,
        // Recipe components for inventory items
        recipeComponents: {
          include: {
            component: true,
          },
        },
        // Linked inventory item for cost tracking
        inventoryItem: true,
      },
    })

    if (!ingredient) {
      return NextResponse.json(
        { error: 'Ingredient not found' },
        { status: 404 }
      )
    }

    let costPerUnit: number | null = null
    let costUnit = ingredient.standardUnit || 'each'
    let costSource: 'purchase' | 'recipe' | 'parent' | 'unknown' = 'unknown'

    // 1. If this is a prep item (has parent), derive cost from parent
    if (ingredient.parentIngredientId && ingredient.parentIngredient) {
      const parent = ingredient.parentIngredient

      // Get parent's cost recursively
      const parentCostResponse = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/ingredients/${parent.id}/cost`
      )

      if (parentCostResponse.ok) {
        const parentCostData = await parentCostResponse.json()
        const parentCostPerUnit = parentCostData.costPerUnit

        if (parentCostPerUnit !== null) {
          // Calculate cost based on input/output transformation
          const inputQty = Number(ingredient.inputQuantity) || Number(ingredient.portionSize) || 1
          const inputUnit = ingredient.inputUnit || ingredient.portionUnit || parent.standardUnit || 'each'
          const outputQty = Number(ingredient.outputQuantity) || 1
          const outputUnit = ingredient.outputUnit || 'each'
          const yieldPercent = Number(ingredient.yieldPercent) || 1

          // Convert input to parent's unit if needed
          const parentUnit = parent.standardUnit || 'each'
          let inputInParentUnits = inputQty

          if (inputUnit !== parentUnit) {
            const converted = convert(inputQty, inputUnit, parentUnit)
            if (converted !== null) {
              inputInParentUnits = converted
            }
          }

          // Calculate: (parentCost * inputAmount) / outputAmount / yieldPercent
          const inputCost = parentCostPerUnit * inputInParentUnits
          costPerUnit = inputCost / outputQty / yieldPercent
          costUnit = outputUnit
          costSource = 'parent'
        }
      }
    }

    // 2. If this has a recipe, calculate cost from recipe components
    if (costPerUnit === null && ingredient.recipeComponents.length > 0) {
      let totalRecipeCost = 0
      let allComponentsHaveCost = true

      for (const recipeComp of ingredient.recipeComponents) {
        // Get component cost
        try {
          const compCostResponse = await fetch(
            `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/ingredients/${recipeComp.componentId}/cost`
          )

          if (compCostResponse.ok) {
            const compCostData = await compCostResponse.json()
            const compCostPerUnit = compCostData.costPerUnit

            if (compCostPerUnit !== null) {
              // Convert component quantity to component's standard unit if needed
              const compQty = Number(recipeComp.quantity)
              const compUnit = recipeComp.unit
              const compStdUnit = recipeComp.component.standardUnit || compUnit

              let qtyInStdUnits = compQty
              if (compUnit !== compStdUnit) {
                const converted = convert(compQty, compUnit, compStdUnit)
                if (converted !== null) {
                  qtyInStdUnits = converted
                }
              }

              totalRecipeCost += compCostPerUnit * qtyInStdUnits
            } else {
              allComponentsHaveCost = false
            }
          } else {
            allComponentsHaveCost = false
          }
        } catch (err) {
          allComponentsHaveCost = false
        }
      }

      if (allComponentsHaveCost && totalRecipeCost > 0) {
        // Divide by recipe yield to get cost per unit
        const recipeYieldQty = Number(ingredient.recipeYieldQuantity) || Number(ingredient.standardQuantity) || 1
        costPerUnit = totalRecipeCost / recipeYieldQty
        costUnit = ingredient.recipeYieldUnit || ingredient.standardUnit || 'each'
        costSource = 'recipe'
      }
    }

    // 3. If this is a delivered item with purchaseCost set, use that
    if (costPerUnit === null && ingredient.sourceType === 'delivered' && ingredient.purchaseCost) {
      // purchaseCost is the total cost for one purchase unit (case, bag, etc.)
      // unitsPerPurchase is how many storage units are in that purchase
      // So cost per unit = purchaseCost / unitsPerPurchase
      const unitsQty = Number(ingredient.unitsPerPurchase) || Number(ingredient.standardQuantity) || 1
      costPerUnit = Number(ingredient.purchaseCost) / unitsQty
      costUnit = ingredient.standardUnit || 'each'
      costSource = 'purchase'
    }

    // 4. If linked to inventory item, use that cost
    if (costPerUnit === null && ingredient.inventoryItem) {
      // TODO: Get actual cost from InventoryItem's last purchase price
      // For now, return null - this would need integration with invoice/purchase tracking
      costSource = 'purchase'
    }

    // 5. Fall back to a placeholder calculation (standardQuantity-based)
    // In production, this would integrate with actual purchase/invoice data
    if (costPerUnit === null) {
      // No cost available - return null to indicate cost needs to be set up
      return NextResponse.json({
        costPerUnit: null,
        costUnit,
        costSource: 'unknown',
        message: 'No cost data available. Set up purchase price or link to inventory.',
      })
    }

    return NextResponse.json({
      costPerUnit: Math.round(costPerUnit * 10000) / 10000, // Round to 4 decimal places
      costUnit,
      costSource,
    })
  } catch (error) {
    console.error('Failed to calculate ingredient cost:', error)
    return NextResponse.json(
      { error: 'Failed to calculate cost' },
      { status: 500 }
    )
  }
}

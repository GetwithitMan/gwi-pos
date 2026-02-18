'use server'

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/ingredients/[id]/hierarchy
 * Returns the full hierarchy for an inventory item:
 * - inventoryItem: the main item details
 * - recipeIngredients[]: ingredients used in its recipe (if any)
 * - prepItems[]: prep items derived from this inventory item
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params

    // Fetch the main inventory item
    const inventoryItem = await db.ingredient.findUnique({
      where: { id },
      include: {
        categoryRelation: true,
        inventoryItem: true,
        // Get recipe components (ingredients used to make this item)
        recipeComponents: {
          include: {
            component: {
              include: {
                categoryRelation: true,
              },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        // Get child ingredients (prep items made from this)
        childIngredients: {
          where: { deletedAt: null },
          include: {
            categoryRelation: true,
            prepItem: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!inventoryItem) {
      return NextResponse.json(
        { error: 'Inventory item not found' },
        { status: 404 }
      )
    }

    // If this is a prep item (has a parent), redirect to parent hierarchy
    if (inventoryItem.parentIngredientId) {
      return NextResponse.json(
        { error: 'This is a prep item. Use the parent inventory item ID instead.' },
        { status: 400 }
      )
    }

    // Transform recipe components into recipeIngredients format
    const recipeIngredients = inventoryItem.recipeComponents.map((rc) => ({
      id: rc.id,
      componentId: rc.componentId,
      name: rc.component.name,
      type: 'ingredient' as const,
      quantity: Number(rc.quantity),
      unit: rc.unit,
      costPerUnit: null as number | null, // Would need cost calculation
      category: rc.component.categoryRelation?.name || null,
    }))

    // Transform child ingredients into prepItems format
    const prepItems = inventoryItem.childIngredients.map((child) => ({
      id: child.id,
      name: child.name,
      type: 'prep' as const,
      preparationType: child.preparationType,
      // Explicit input/output model
      inputQuantity: child.inputQuantity ? Number(child.inputQuantity) : null,
      inputUnit: child.inputUnit,
      outputQuantity: child.outputQuantity ? Number(child.outputQuantity) : null,
      outputUnit: child.outputUnit,
      // Legacy fields for backwards compatibility
      portionSize: child.portionSize ? Number(child.portionSize) : null,
      portionUnit: child.portionUnit,
      yieldPercent: child.yieldPercent ? Number(child.yieldPercent) : null,
      // Daily count settings
      isDailyCountItem: child.isDailyCountItem,
      countPrecision: child.countPrecision,
      currentPrepStock: child.currentPrepStock ? Number(child.currentPrepStock) : null,
      lowStockThreshold: child.lowStockThreshold ? Number(child.lowStockThreshold) : null,
      criticalStockThreshold: child.criticalStockThreshold ? Number(child.criticalStockThreshold) : null,
      // Status
      isActive: child.isActive,
      category: child.categoryRelation?.name || null,
    }))

    // Format the main inventory item
    const formattedInventoryItem = {
      id: inventoryItem.id,
      name: inventoryItem.name,
      type: 'inventory' as const,
      description: inventoryItem.description,
      // Delivery size
      standardQuantity: inventoryItem.standardQuantity ? Number(inventoryItem.standardQuantity) : null,
      standardUnit: inventoryItem.standardUnit,
      // Recipe yield (for batch items)
      recipeYieldQuantity: inventoryItem.recipeYieldQuantity ? Number(inventoryItem.recipeYieldQuantity) : null,
      recipeYieldUnit: inventoryItem.recipeYieldUnit,
      // Category
      category: inventoryItem.categoryRelation?.name || null,
      categoryId: inventoryItem.categoryId,
      // Status
      isActive: inventoryItem.isActive,
      // Counts
      recipeCount: recipeIngredients.length,
      prepCount: prepItems.length,
    }

    return NextResponse.json({ data: {
      inventoryItem: formattedInventoryItem,
      recipeIngredients,
      prepItems,
    } })
  } catch (error) {
    console.error('Error fetching ingredient hierarchy:', error)
    return NextResponse.json(
      { error: 'Failed to fetch hierarchy' },
      { status: 500 }
    )
  }
})

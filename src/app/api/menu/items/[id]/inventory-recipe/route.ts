import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  calculateIngredientCosts,
  calculateRecipeCosting,
  toNumber
} from '@/lib/inventory-calculations'
import { createMenuItemRecipeSchema, validateRequest } from '@/lib/validations'

// GET - Get inventory recipe for menu item (food costing)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: { id: true, name: true, price: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    const recipe = await db.menuItemRecipe.findUnique({
      where: { menuItemId: id },
      include: {
        ingredients: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                name: true,
                storageUnit: true,
                costPerUnit: true,
                yieldCostPerUnit: true
              },
            },
            prepItem: {
              select: {
                id: true,
                name: true,
                outputUnit: true,
                costPerUnit: true
              },
            },
          },
        },
      },
    })

    if (!recipe) {
      return NextResponse.json({ recipe: null, menuItem })
    }

    // Calculate ingredient costs using shared utility
    const { ingredients, totalCost } = calculateIngredientCosts(recipe.ingredients)

    // Calculate costing metrics
    const sellPrice = toNumber(menuItem.price)
    const costing = calculateRecipeCosting(totalCost, sellPrice)

    return NextResponse.json({
      recipe: {
        ...recipe,
        totalCost,
        ingredients,
      },
      menuItem: {
        ...menuItem,
        price: sellPrice,
      },
      costing,
    })
  } catch (error) {
    console.error('Get menu item inventory recipe error:', error)
    return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
  }
}

// POST - Create or update inventory recipe for menu item
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createMenuItemRecipeSchema, body)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { portionSize, portionUnit, prepInstructions, ingredients } = validation.data

    const menuItem = await db.menuItem.findUnique({
      where: { id },
      select: { id: true, locationId: true, price: true },
    })

    if (!menuItem) {
      return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
    }

    // Use a transaction to ensure atomic updates
    const recipe = await db.$transaction(async (tx) => {
      // Check if recipe exists
      const existingRecipe = await tx.menuItemRecipe.findUnique({
        where: { menuItemId: id },
      })

      if (existingRecipe) {
        // Delete existing ingredients
        await tx.menuItemRecipeIngredient.deleteMany({
          where: { recipeId: existingRecipe.id },
        })

        // Update recipe
        return tx.menuItemRecipe.update({
          where: { id: existingRecipe.id },
          data: {
            totalCost: null, // Will be recalculated
            foodCostPct: null,
            ingredients: ingredients ? {
              create: ingredients.map((ing, index) => ({
                locationId: menuItem.locationId,
                inventoryItemId: ing.inventoryItemId || null,
                prepItemId: ing.prepItemId || null,
                quantity: ing.quantity,
                unit: ing.unit,
                sortOrder: index,
              })),
            } : undefined,
          },
          include: {
            ingredients: {
              include: {
                inventoryItem: {
                  select: {
                    id: true,
                    name: true,
                    storageUnit: true,
                    costPerUnit: true,
                    yieldCostPerUnit: true
                  },
                },
                prepItem: {
                  select: {
                    id: true,
                    name: true,
                    outputUnit: true,
                    costPerUnit: true
                  },
                },
              },
            },
          },
        })
      } else {
        // Create new recipe
        return tx.menuItemRecipe.create({
          data: {
            locationId: menuItem.locationId,
            menuItemId: id,
            ingredients: ingredients ? {
              create: ingredients.map((ing, index) => ({
                locationId: menuItem.locationId,
                inventoryItemId: ing.inventoryItemId || null,
                prepItemId: ing.prepItemId || null,
                quantity: ing.quantity,
                unit: ing.unit,
                sortOrder: index,
              })),
            } : undefined,
          },
          include: {
            ingredients: {
              include: {
                inventoryItem: {
                  select: {
                    id: true,
                    name: true,
                    storageUnit: true,
                    costPerUnit: true,
                    yieldCostPerUnit: true
                  },
                },
                prepItem: {
                  select: {
                    id: true,
                    name: true,
                    outputUnit: true,
                    costPerUnit: true
                  },
                },
              },
            },
          },
        })
      }
    })

    // Calculate ingredient costs using shared utility (uses yieldCostPerUnit consistently)
    const { ingredients: processedIngredients, totalCost } = calculateIngredientCosts(recipe.ingredients)

    // Update the recipe with calculated costs
    const sellPrice = toNumber(menuItem.price)
    const foodCostPct = sellPrice > 0 ? (totalCost / sellPrice) * 100 : 0

    await db.menuItemRecipe.update({
      where: { id: recipe.id },
      data: {
        totalCost,
        foodCostPct,
      },
    })

    const costing = calculateRecipeCosting(totalCost, sellPrice)

    return NextResponse.json({
      recipe: {
        ...recipe,
        totalCost,
        foodCostPct,
        ingredients: processedIngredients,
      },
      costing,
    })
  } catch (error) {
    console.error('Save menu item inventory recipe error:', error)
    return NextResponse.json({ error: 'Failed to save recipe' }, { status: 500 })
  }
}

// DELETE - Remove inventory recipe from menu item
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const recipe = await db.menuItemRecipe.findUnique({
      where: { menuItemId: id },
    })

    if (!recipe) {
      return NextResponse.json({ error: 'Recipe not found' }, { status: 404 })
    }

    // Use transaction for atomic soft delete
    await db.$transaction(async (tx) => {
      // Soft delete ingredients first
      await tx.menuItemRecipeIngredient.updateMany({
        where: { recipeId: recipe.id },
        data: { deletedAt: new Date() },
      })

      // Soft delete recipe
      await tx.menuItemRecipe.update({
        where: { id: recipe.id },
        data: { deletedAt: new Date() },
      })
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete menu item inventory recipe error:', error)
    return NextResponse.json({ error: 'Failed to delete recipe' }, { status: 500 })
  }
}

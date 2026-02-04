import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PUT(request: NextRequest) {
  try {
    const { ingredientIds, parentIngredientId, categoryId, isBaseIngredient } = await request.json()

    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return NextResponse.json(
        { error: 'ingredientIds array is required' },
        { status: 400 }
      )
    }

    // Validate parentIngredientId exists if provided
    if (parentIngredientId) {
      const parent = await db.ingredient.findUnique({
        where: { id: parentIngredientId },
        select: { id: true, locationId: true },
      })

      if (!parent) {
        return NextResponse.json(
          { error: 'Parent ingredient not found' },
          { status: 404 }
        )
      }

      // Verify all ingredients belong to the same location as parent
      const ingredients = await db.ingredient.findMany({
        where: {
          id: { in: ingredientIds },
          deletedAt: null,
        },
        select: { id: true, locationId: true },
      })

      const mismatchedLocations = ingredients.filter(i => i.locationId !== parent.locationId)
      if (mismatchedLocations.length > 0) {
        return NextResponse.json(
          { error: 'Cannot move ingredients from different locations' },
          { status: 400 }
        )
      }

      // Prevent circular references
      if (ingredientIds.includes(parentIngredientId)) {
        return NextResponse.json(
          { error: 'Cannot set an ingredient as its own parent' },
          { status: 400 }
        )
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      parentIngredientId: parentIngredientId || null,
      isBaseIngredient: isBaseIngredient ?? !parentIngredientId,
    }

    // If moving to uncategorized (no parent), clear category
    if (!parentIngredientId && categoryId !== undefined) {
      updateData.categoryId = categoryId
    }

    // Perform bulk update
    const result = await db.ingredient.updateMany({
      where: {
        id: { in: ingredientIds },
        deletedAt: null,
      },
      data: updateData,
    })

    return NextResponse.json({
      data: {
        movedCount: result.count,
      },
    })
  } catch (error) {
    console.error('Bulk parent update error:', error)
    return NextResponse.json(
      { error: 'Failed to update ingredients' },
      { status: 500 }
    )
  }
}

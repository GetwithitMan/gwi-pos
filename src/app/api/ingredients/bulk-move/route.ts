import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * PUT /api/ingredients/bulk-move
 * Move multiple ingredients to a different category
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientIds, categoryId } = body

    // Validation
    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return NextResponse.json(
        { error: 'ingredientIds must be a non-empty array' },
        { status: 400 }
      )
    }

    // categoryId can be null or empty string to move to "Uncategorized"
    const targetCategoryId = categoryId || null

    // If categoryId is provided, verify it exists
    if (targetCategoryId) {
      const category = await db.ingredientCategory.findUnique({
        where: { id: targetCategoryId },
        select: { id: true, name: true },
      })

      if (!category) {
        return NextResponse.json(
          { error: 'Target category not found' },
          { status: 400 }
        )
      }
    }

    // Update all ingredients in a transaction
    const result = await db.$transaction(async (tx) => {
      const updateResult = await tx.ingredient.updateMany({
        where: {
          id: { in: ingredientIds },
          deletedAt: null,
        },
        data: {
          categoryId: targetCategoryId,
        },
      })

      return updateResult.count
    })

    return NextResponse.json({
      success: true,
      movedCount: result,
    })
  } catch (error) {
    console.error('Failed to bulk move ingredients:', error)
    return NextResponse.json(
      { error: 'Failed to move ingredients' },
      { status: 500 }
    )
  }
})

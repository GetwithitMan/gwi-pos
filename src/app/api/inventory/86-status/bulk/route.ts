import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * POST /api/inventory/86-status/bulk
 *
 * Bulk update 86 status for multiple ingredients.
 * Useful for donut shops clearing multiple items at once.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientIds, is86d, employeeId } = body

    if (!ingredientIds || !Array.isArray(ingredientIds) || ingredientIds.length === 0) {
      return NextResponse.json(
        { error: 'ingredientIds array is required' },
        { status: 400 }
      )
    }

    if (is86d === undefined) {
      return NextResponse.json(
        { error: 'is86d is required' },
        { status: 400 }
      )
    }

    // Update all ingredients in bulk
    const result = await db.ingredient.updateMany({
      where: {
        id: { in: ingredientIds },
        deletedAt: null
      },
      data: {
        is86d,
        last86dAt: is86d ? new Date() : null,
        last86dBy: is86d ? employeeId : null
      }
    })

    // Get updated ingredients for response
    const updated = await db.ingredient.findMany({
      where: {
        id: { in: ingredientIds },
        deletedAt: null
      },
      select: {
        id: true,
        name: true,
        is86d: true
      }
    })

    return NextResponse.json({
      data: {
        updatedCount: result.count,
        ingredients: updated,
        message: is86d
          ? `${result.count} items marked as 86.`
          : `${result.count} items are back in stock.`
      }
    })
  } catch (error) {
    console.error('Error bulk updating 86 status:', error)
    return NextResponse.json({ error: 'Failed to bulk update 86 status' }, { status: 500 })
  }
}

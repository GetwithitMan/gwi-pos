import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

/**
 * PUT /api/liquor/categories/reorder
 * Reorder spirit categories by updating sortOrder
 */
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { categoryIds } = body

    if (!categoryIds || !Array.isArray(categoryIds)) {
      return NextResponse.json(
        { error: 'categoryIds array is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify all categories belong to this location
    const categories = await db.spiritCategory.findMany({
      where: {
        id: { in: categoryIds },
        locationId,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (categories.length !== categoryIds.length) {
      return NextResponse.json(
        { error: 'One or more categories not found' },
        { status: 404 }
      )
    }

    // Update sortOrder for each category
    await db.$transaction(
      categoryIds.map((id: string, index: number) =>
        db.spiritCategory.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    )

    // Real-time cross-terminal update
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      name: 'categories-reorder',
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to reorder categories:', error)
    return NextResponse.json(
      { error: 'Failed to reorder categories' },
      { status: 500 }
    )
  }
})

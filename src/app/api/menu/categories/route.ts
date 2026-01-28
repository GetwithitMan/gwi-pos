import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, color, categoryType } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Get the location (for now using first location)
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Get max sort order
    const maxSortOrder = await db.category.aggregate({
      where: { locationId: location.id },
      _max: { sortOrder: true }
    })

    const category = await db.category.create({
      data: {
        locationId: location.id,
        name: name.trim(),
        color: color || '#3b82f6',
        categoryType: categoryType || 'food',
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
      }
    })

    return NextResponse.json({
      id: category.id,
      name: category.name,
      color: category.color,
      categoryType: category.categoryType,
      isActive: category.isActive,
      itemCount: 0
    })
  } catch (error) {
    console.error('Failed to create category:', error)
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    )
  }
}

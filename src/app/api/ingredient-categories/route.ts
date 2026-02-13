import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET /api/ingredient-categories - List all categories for location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const categories = await db.ingredientCategory.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        _count: {
          select: {
            ingredients: {
              where: { deletedAt: null, isActive: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: categories.map(cat => ({
        ...cat,
        ingredientCount: cat._count.ingredients,
        _count: undefined,
      })),
    })
  } catch (error) {
    console.error('Error fetching ingredient categories:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient categories' }, { status: 500 })
  }
})

// POST /api/ingredient-categories - Create a new category
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      icon,
      color,
      sortOrder,
      needsVerification,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'locationId and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await db.ingredientCategory.findFirst({
      where: { locationId, name, deletedAt: null },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A category with this name already exists' },
        { status: 409 }
      )
    }

    // Auto-assign the next code number (IMMUTABLE after creation)
    const maxCode = await db.ingredientCategory.aggregate({
      where: { locationId },
      _max: { code: true },
    })
    const nextCode = (maxCode._max.code ?? 0) + 1

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.ingredientCategory.aggregate({
        where: { locationId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    const category = await db.ingredientCategory.create({
      data: {
        locationId,
        code: nextCode,
        name,
        description,
        icon,
        color,
        sortOrder: finalSortOrder,
        needsVerification: needsVerification ?? false,
      },
    })

    return NextResponse.json({
      data: {
        ...category,
        ingredientCount: 0,
      },
    })
  } catch (error) {
    console.error('Error creating ingredient category:', error)
    return NextResponse.json({ error: 'Failed to create ingredient category' }, { status: 500 })
  }
})

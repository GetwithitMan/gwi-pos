import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

/**
 * GET /api/liquor/categories
 * List all spirit categories for the location
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const isActive = searchParams.get('isActive')
    const includeBottles = searchParams.get('includeBottles') === 'true'

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const categories = await db.spiritCategory.findMany({
      where: {
        locationId,
        ...(isActive !== null && { isActive: isActive === 'true' }),
      },
      include: {
        _count: {
          select: {
            bottleProducts: true,
            spiritModifierGroups: true,
          },
        },
        ...(includeBottles && {
          bottleProducts: {
            where: { isActive: true },
            orderBy: [
              { tier: 'asc' },
              { name: 'asc' },
            ],
            select: {
              id: true,
              name: true,
              brand: true,
              displayName: true,
              tier: true,
              pourCost: true,
              isActive: true,
            },
          },
        }),
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json(
      categories.map((category) => ({
        id: category.id,
        name: category.name,
        displayName: category.displayName,
        description: category.description,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
        bottleCount: category._count.bottleProducts,
        modifierGroupCount: category._count.spiritModifierGroups,
        createdAt: category.createdAt,
        updatedAt: category.updatedAt,
        ...((category as any).bottleProducts && {
          bottleProducts: (category as any).bottleProducts.map((b: any) => ({
            ...b,
            pourCost: b.pourCost ? Number(b.pourCost) : null,
          })),
        }),
      }))
    )
  } catch (error) {
    console.error('Failed to fetch spirit categories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch spirit categories' },
      { status: 500 }
    )
  }
})

/**
 * POST /api/liquor/categories
 * Create a new spirit category
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, displayName, description } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Get max sort order
    const maxSortOrder = await db.spiritCategory.aggregate({
      where: { locationId },
      _max: { sortOrder: true },
    })

    const category = await db.spiritCategory.create({
      data: {
        locationId,
        name: name.trim(),
        displayName: displayName?.trim() || null,
        description: description?.trim() || null,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
      },
    })

    return NextResponse.json({
      id: category.id,
      name: category.name,
      displayName: category.displayName,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      bottleCount: 0,
      modifierGroupCount: 0,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    })
  } catch (error) {
    console.error('Failed to create spirit category:', error)
    return NextResponse.json(
      { error: 'Failed to create spirit category' },
      { status: 500 }
    )
  }
})

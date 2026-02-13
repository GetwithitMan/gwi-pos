import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// GET - List all categories for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    const locationFilter = locationId ? { locationId } : {}

    const categories = await db.category.findMany({
      where: { isActive: true, deletedAt: null, ...locationFilter },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            menuItems: { where: { deletedAt: null, isActive: true } }
          }
        }
      }
    })

    return NextResponse.json({
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        categoryType: c.categoryType || 'food',
        categoryShow: c.categoryShow || 'all',
        isActive: c.isActive,
        itemCount: c._count.menuItems,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch categories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
})

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, color, categoryType, categoryShow, printerIds } = body

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
        categoryShow: categoryShow || 'all',
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        ...(printerIds && { printerIds }),
      }
    })

    // Dispatch socket event for real-time menu structure update
    dispatchMenuStructureChanged(location.id, {
      action: 'category-created',
      entityId: category.id,
      entityType: 'category',
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch category created event:', err)
    })

    return NextResponse.json({
      id: category.id,
      name: category.name,
      color: category.color,
      categoryType: category.categoryType,
      categoryShow: category.categoryShow,
      isActive: category.isActive,
      printerIds: category.printerIds,
      itemCount: 0
    })
  } catch (error) {
    console.error('Failed to create category:', error)
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    )
  }
})

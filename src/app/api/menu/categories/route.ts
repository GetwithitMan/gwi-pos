import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET - List all categories for a location
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    // Get the location ID (cached)
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const categories = await db.category.findMany({
      where: { isActive: true, deletedAt: null, locationId },
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

    // Get the location ID (cached)
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Get max sort order
    const maxSortOrder = await db.category.aggregate({
      where: { locationId },
      _max: { sortOrder: true }
    })

    const category = await db.category.create({
      data: {
        locationId,
        name: name.trim(),
        color: color || '#3b82f6',
        categoryType: categoryType || 'food',
        categoryShow: categoryShow || 'all',
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        ...(printerIds && { printerIds }),
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch for real-time menu updates
    void emitToLocation(locationId, 'menu:changed', { action: 'category_created' }).catch(() => {})

    // Dispatch socket event for real-time menu structure update
    dispatchMenuStructureChanged(locationId, {
      action: 'category-created',
      entityId: category.id,
      entityType: 'category',
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch category created event:', err)
    })

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId, domain: 'menu', action: 'created', entityId: category.id })

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

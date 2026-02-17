import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { withVenue } from '@/lib/with-venue'

export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, color, categoryType, categoryShow, printerIds } = body
    const locationId = body.locationId || request.nextUrl.searchParams.get('locationId')

    // Verify the category belongs to this location before updating
    if (locationId) {
      const existing = await db.category.findFirst({
        where: { id, locationId },
      })
      if (!existing) {
        return NextResponse.json({ error: 'Category not found' }, { status: 404 })
      }
    }

    const category = await db.category.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(color && { color }),
        ...(categoryType && { categoryType }),
        ...(categoryShow && { categoryShow }),
        // Allow setting printerIds to null to clear it (empty array also becomes null)
        ...(printerIds !== undefined && {
          printerIds: printerIds && printerIds.length > 0 ? printerIds : null
        }),
      }
    })

    // Invalidate server-side menu cache
    invalidateMenuCache(category.locationId)

    // Dispatch socket event for real-time menu structure update
    dispatchMenuStructureChanged(category.locationId, {
      action: 'category-updated',
      entityId: category.id,
      entityType: 'category',
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch category updated event:', err)
    })

    // Notify cloud → NUC sync
    void notifyDataChanged({ locationId: category.locationId, domain: 'menu', action: 'updated', entityId: category.id })

    return NextResponse.json({
      id: category.id,
      name: category.name,
      color: category.color,
      categoryType: category.categoryType,
      categoryShow: category.categoryShow,
      isActive: category.isActive,
      printerIds: category.printerIds
    })
  } catch (error) {
    console.error('Failed to update category:', error)
    return NextResponse.json(
      { error: 'Failed to update category' },
      { status: 500 }
    )
  }
})

export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId')

    // Get category info before deletion for socket dispatch and locationId verification
    const category = await db.category.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
      select: { locationId: true }
    })

    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Check if category has items
    const itemCount = await db.menuItem.count({
      where: { categoryId: id, deletedAt: null }
    })

    if (itemCount > 0) {
      return NextResponse.json(
        { error: 'Cannot delete category with items. Move or delete items first.' },
        { status: 400 }
      )
    }

    await db.category.update({ where: { id }, data: { deletedAt: new Date() } })

    // Invalidate server-side menu cache
    invalidateMenuCache(category.locationId)

    // Dispatch socket event for real-time menu structure update
    if (category) {
      dispatchMenuStructureChanged(category.locationId, {
        action: 'category-deleted',
        entityId: id,
        entityType: 'category',
      }, { async: true }).catch(err => {
        console.error('Failed to dispatch category deleted event:', err)
      })

      // Notify cloud → NUC sync
      void notifyDataChanged({ locationId: category.locationId, domain: 'menu', action: 'deleted', entityId: id })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete category:', error)
    return NextResponse.json(
      { error: 'Failed to delete category' },
      { status: 500 }
    )
  }
})

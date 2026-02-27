import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// PUT update group metadata
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const { name, sortOrder, isRequired, showAsQuickPick } = body

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify group belongs to this item and location
    const existing = await db.pricingOptionGroup.findFirst({
      where: { id: groupId, menuItemId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Pricing option group not found' },
        { status: 404 }
      )
    }

    const updated = await db.pricingOptionGroup.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isRequired !== undefined && { isRequired }),
        ...(showAsQuickPick !== undefined && { showAsQuickPick }),
      },
      include: {
        options: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(() => {})

    return NextResponse.json({
      data: {
        group: {
          id: updated.id,
          menuItemId: updated.menuItemId,
          name: updated.name,
          sortOrder: updated.sortOrder,
          isRequired: updated.isRequired,
          showAsQuickPick: updated.showAsQuickPick,
          options: updated.options.map((opt) => ({
            id: opt.id,
            groupId: opt.groupId,
            label: opt.label,
            price: opt.price != null ? Number(opt.price) : null,
            priceCC: opt.priceCC != null ? Number(opt.priceCC) : null,
            sortOrder: opt.sortOrder,
            isDefault: opt.isDefault,
            color: opt.color,
          })),
        },
      },
    })
  } catch (error) {
    console.error('Failed to update pricing option group:', error)
    return NextResponse.json(
      { error: 'Failed to update pricing option group' },
      { status: 500 }
    )
  }
})

// DELETE soft-delete group + cascade soft-delete all options
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id: menuItemId, groupId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify group belongs to this item and location
    const existing = await db.pricingOptionGroup.findFirst({
      where: { id: groupId, menuItemId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Pricing option group not found' },
        { status: 404 }
      )
    }

    const now = new Date()

    // Soft-delete group and all its options in a transaction
    await db.$transaction([
      db.pricingOption.updateMany({
        where: { groupId, deletedAt: null },
        data: { deletedAt: now },
      }),
      db.pricingOptionGroup.update({
        where: { id: groupId },
        data: { deletedAt: now },
      }),
    ])

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pricing option group:', error)
    return NextResponse.json(
      { error: 'Failed to delete pricing option group' },
      { status: 500 }
    )
  }
})

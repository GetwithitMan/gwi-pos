import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// PUT update an option
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId } = await params
    const body = await request.json()
    const { label, price, priceCC, sortOrder, isDefault, color } = body

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify option belongs to this group, item, and location
    const existing = await db.pricingOption.findFirst({
      where: {
        id: optionId,
        groupId,
        locationId,
        deletedAt: null,
        group: { menuItemId, deletedAt: null },
      },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Pricing option not found' },
        { status: 404 }
      )
    }

    // If isDefault=true, unset any existing default in this group first
    if (isDefault) {
      await db.pricingOption.updateMany({
        where: { groupId, isDefault: true, deletedAt: null, id: { not: optionId } },
        data: { isDefault: false },
      })
    }

    const updated = await db.pricingOption.update({
      where: { id: optionId },
      data: {
        ...(label !== undefined && { label: label.trim() }),
        ...(price !== undefined && { price: price ?? null }),
        ...(priceCC !== undefined && { priceCC: priceCC ?? null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isDefault !== undefined && { isDefault }),
        ...(color !== undefined && { color: color ?? null }),
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
        option: {
          id: updated.id,
          groupId: updated.groupId,
          label: updated.label,
          price: updated.price != null ? Number(updated.price) : null,
          priceCC: updated.priceCC != null ? Number(updated.priceCC) : null,
          sortOrder: updated.sortOrder,
          isDefault: updated.isDefault,
          color: updated.color,
        },
      },
    })
  } catch (error) {
    console.error('Failed to update pricing option:', error)
    return NextResponse.json(
      { error: 'Failed to update pricing option' },
      { status: 500 }
    )
  }
})

// DELETE soft-delete an option
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify option belongs to this group, item, and location
    const existing = await db.pricingOption.findFirst({
      where: {
        id: optionId,
        groupId,
        locationId,
        deletedAt: null,
        group: { menuItemId, deletedAt: null },
      },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Pricing option not found' },
        { status: 404 }
      )
    }

    await db.pricingOption.update({
      where: { id: optionId },
      data: { deletedAt: new Date() },
    })

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete pricing option:', error)
    return NextResponse.json(
      { error: 'Failed to delete pricing option' },
      { status: 500 }
    )
  }
})

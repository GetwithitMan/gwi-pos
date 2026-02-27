import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// POST add a new option to a group
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const { label, price, priceCC, sortOrder, isDefault, color } = body

    if (!label?.trim()) {
      return NextResponse.json(
        { error: 'Label is required' },
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

    // Verify group belongs to this item and location
    const group = await db.pricingOptionGroup.findFirst({
      where: { id: groupId, menuItemId, locationId, deletedAt: null },
      select: { id: true },
    })
    if (!group) {
      return NextResponse.json(
        { error: 'Pricing option group not found' },
        { status: 404 }
      )
    }

    // Enforce max 4 options per group
    const optionCount = await db.pricingOption.count({
      where: { groupId, deletedAt: null },
    })
    if (optionCount >= 4) {
      return NextResponse.json(
        { error: 'Maximum 4 options per group' },
        { status: 400 }
      )
    }

    // If isDefault=true, unset any existing default in this group
    if (isDefault) {
      await db.pricingOption.updateMany({
        where: { groupId, isDefault: true, deletedAt: null },
        data: { isDefault: false },
      })
    }

    // Get max sort order if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined || finalSortOrder === null) {
      const maxSort = await db.pricingOption.aggregate({
        where: { groupId, deletedAt: null },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? 0) + 1
    }

    const option = await db.pricingOption.create({
      data: {
        locationId,
        groupId,
        label: label.trim(),
        price: price ?? null,
        priceCC: priceCC ?? null,
        sortOrder: finalSortOrder,
        isDefault: isDefault ?? false,
        color: color ?? null,
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
          id: option.id,
          groupId: option.groupId,
          label: option.label,
          price: option.price != null ? Number(option.price) : null,
          priceCC: option.priceCC != null ? Number(option.priceCC) : null,
          sortOrder: option.sortOrder,
          isDefault: option.isDefault,
          color: option.color,
        },
      },
    })
  } catch (error) {
    console.error('Failed to create pricing option:', error)
    return NextResponse.json(
      { error: 'Failed to create pricing option' },
      { status: 500 }
    )
  }
})

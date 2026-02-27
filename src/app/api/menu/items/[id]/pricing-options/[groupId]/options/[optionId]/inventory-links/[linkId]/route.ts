import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// PUT update an inventory link
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string; linkId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId, linkId } = await params
    const body = await request.json()
    const { usageQuantity, usageUnit } = body

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify the link belongs to this pricing option, group, item, and location
    const existing = await db.pricingOptionInventoryLink.findFirst({
      where: {
        id: linkId,
        pricingOptionId: optionId,
        locationId,
        deletedAt: null,
        pricingOption: {
          groupId,
          deletedAt: null,
          group: { menuItemId, deletedAt: null },
        },
      },
      select: {
        id: true,
        inventoryItemId: true,
        prepItemId: true,
        usageQuantity: true,
      },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Inventory link not found' },
        { status: 404 }
      )
    }

    // Build update data
    const updateData: Record<string, unknown> = {}
    if (usageQuantity !== undefined) {
      if (usageQuantity <= 0) {
        return NextResponse.json(
          { error: 'usageQuantity must be a positive number' },
          { status: 400 }
        )
      }
      updateData.usageQuantity = usageQuantity
    }
    if (usageUnit !== undefined) {
      if (!usageUnit?.trim()) {
        return NextResponse.json(
          { error: 'usageUnit cannot be empty' },
          { status: 400 }
        )
      }
      updateData.usageUnit = usageUnit.trim()
    }

    // Recalculate cost if quantity changed
    const finalQuantity = usageQuantity !== undefined ? Number(usageQuantity) : Number(existing.usageQuantity)
    let calculatedCost: number | null = null

    if (existing.inventoryItemId) {
      const invItem = await db.inventoryItem.findFirst({
        where: { id: existing.inventoryItemId, locationId, deletedAt: null },
        select: { costPerUnit: true },
      })
      if (invItem?.costPerUnit != null) {
        calculatedCost = Number(invItem.costPerUnit) * finalQuantity
      }
    } else if (existing.prepItemId) {
      const prep = await db.prepItem.findFirst({
        where: { id: existing.prepItemId, locationId, deletedAt: null },
        select: { costPerUnit: true },
      })
      if (prep?.costPerUnit != null) {
        calculatedCost = Number(prep.costPerUnit) * finalQuantity
      }
    }

    updateData.calculatedCost = calculatedCost

    const updated = await db.pricingOptionInventoryLink.update({
      where: { id: linkId },
      data: updateData,
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            storageUnit: true,
            costPerUnit: true,
          },
        },
        prepItem: {
          select: {
            id: true,
            name: true,
            outputUnit: true,
            costPerUnit: true,
          },
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
        id: updated.id,
        pricingOptionId: updated.pricingOptionId,
        inventoryItemId: updated.inventoryItemId,
        prepItemId: updated.prepItemId,
        usageQuantity: Number(updated.usageQuantity),
        usageUnit: updated.usageUnit,
        calculatedCost: updated.calculatedCost != null ? Number(updated.calculatedCost) : null,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        inventoryItem: updated.inventoryItem
          ? {
              id: updated.inventoryItem.id,
              name: updated.inventoryItem.name,
              unit: updated.inventoryItem.storageUnit,
              costPerUnit: updated.inventoryItem.costPerUnit != null ? Number(updated.inventoryItem.costPerUnit) : null,
            }
          : null,
        prepItem: updated.prepItem
          ? {
              id: updated.prepItem.id,
              name: updated.prepItem.name,
              unit: updated.prepItem.outputUnit,
              costPerUnit: updated.prepItem.costPerUnit != null ? Number(updated.prepItem.costPerUnit) : null,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('Failed to update inventory link:', error)
    return NextResponse.json(
      { error: 'Failed to update inventory link' },
      { status: 500 }
    )
  }
})

// DELETE soft-delete an inventory link
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string; linkId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId, linkId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify the link belongs to this pricing option, group, item, and location
    const existing = await db.pricingOptionInventoryLink.findFirst({
      where: {
        id: linkId,
        pricingOptionId: optionId,
        locationId,
        deletedAt: null,
        pricingOption: {
          groupId,
          deletedAt: null,
          group: { menuItemId, deletedAt: null },
        },
      },
      select: { id: true },
    })
    if (!existing) {
      return NextResponse.json(
        { error: 'Inventory link not found' },
        { status: 404 }
      )
    }

    await db.pricingOptionInventoryLink.update({
      where: { id: linkId },
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
    console.error('Failed to delete inventory link:', error)
    return NextResponse.json(
      { error: 'Failed to delete inventory link' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { dispatchMenuStructureChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>
}

// POST /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Add modifier
export const POST = withVenue(async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const {
      name,
      price = 0,
      allowNo = true,
      allowLite = false,
      allowOnSide = false,
      allowExtra = false,
      extraPrice = 0,
      liteMultiplier,
      extraMultiplier,
      isDefault = false,
      ingredientId,
      childModifierGroupId,
      isLabel = false,
      printerRouting = 'follow',
      printerIds,
      spiritTier,
      linkedBottleProductId,
      isActive = true,
      displayName,
      showOnPOS = true,
      showOnline = true,
      showAsHotButton = false,
      cost,
      commissionType,
      commissionValue,
      upsellPrice,
      priceType = 'upcharge',
      linkedMenuItemId,
      inventoryDeductionAmount,
      inventoryDeductionUnit,
      swapEnabled = false,
      swapTargets,
    } = body

    // Verify group belongs to this item
    const group = await db.modifierGroup.findFirst({
      where: { id: groupId, menuItemId },
      select: { id: true, locationId: true },
    })

    if (!group) {
      return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
    }

    // Validate inputs
    if (!name || (typeof name === 'string' && name.trim() === '')) {
      return NextResponse.json({ error: 'Modifier name is required' }, { status: 400 })
    }
    if (price !== undefined && (typeof price !== 'number' || !Number.isFinite(price))) {
      return NextResponse.json({ error: 'Price must be a valid number' }, { status: 400 })
    }
    if (extraPrice !== undefined && (typeof extraPrice !== 'number' || !Number.isFinite(extraPrice))) {
      return NextResponse.json({ error: 'Extra price must be a valid number' }, { status: 400 })
    }

    // Validate swapTargets
    if (swapEnabled && (!swapTargets || !Array.isArray(swapTargets) || swapTargets.length === 0)) {
      return NextResponse.json({ error: 'Swap enabled requires at least one swap target' }, { status: 400 })
    }
    if (swapTargets && Array.isArray(swapTargets)) {
      const seenIds = new Set()
      for (const target of swapTargets) {
        if (!target.menuItemId || !target.name || target.snapshotPrice === undefined || !target.pricingMode) {
          return NextResponse.json({ error: 'Each swap target must have menuItemId, name, snapshotPrice, and pricingMode' }, { status: 400 })
        }
        if (!['target_price', 'fixed_price', 'no_charge'].includes(target.pricingMode)) {
          return NextResponse.json({ error: 'Invalid pricingMode. Must be target_price, fixed_price, or no_charge' }, { status: 400 })
        }
        if (target.pricingMode === 'fixed_price' && (target.fixedPrice === undefined || target.fixedPrice === null)) {
          return NextResponse.json({ error: 'fixedPrice is required when pricingMode is fixed_price' }, { status: 400 })
        }
        if (target.name && target.name.length > 100) {
          return NextResponse.json({ error: 'Swap target name must be 100 characters or less' }, { status: 400 })
        }
        if (seenIds.has(target.menuItemId)) {
          return NextResponse.json({ error: 'Duplicate menuItemId in swap targets' }, { status: 400 })
        }
        seenIds.add(target.menuItemId)
      }
    }

    // Validate inventoryDeductionAmount
    if (inventoryDeductionAmount !== undefined && inventoryDeductionAmount !== null && inventoryDeductionAmount < 0) {
      return NextResponse.json({ error: 'inventoryDeductionAmount must be >= 0' }, { status: 400 })
    }
    if (!ingredientId && (inventoryDeductionAmount !== undefined || inventoryDeductionUnit !== undefined)) {
      // Clear orphaned deduction config if no ingredient linked
    }
    if (ingredientId && inventoryDeductionAmount !== undefined && inventoryDeductionAmount !== null && !inventoryDeductionUnit) {
      return NextResponse.json({ error: 'inventoryDeductionUnit is required when inventoryDeductionAmount is set' }, { status: 400 })
    }

    // Validate commission
    if (commissionType === 'percent' && commissionValue !== undefined && commissionValue > 100) {
      return NextResponse.json({ error: 'Percent commission cannot exceed 100' }, { status: 400 })
    }

    // Get max sort order
    const maxSort = await db.modifier.aggregate({
      where: { modifierGroupId: groupId },
      _max: { sortOrder: true },
    })

    const modifier = await db.modifier.create({
      data: {
        locationId: group.locationId,
        modifierGroupId: groupId,
        name: name || 'New Modifier',
        price,
        allowNo,
        allowLite,
        allowOnSide,
        allowExtra,
        extraPrice,
        liteMultiplier: liteMultiplier !== undefined ? liteMultiplier : null,
        extraMultiplier: extraMultiplier !== undefined ? extraMultiplier : null,
        isDefault,
        ingredientId: ingredientId || null,
        childModifierGroupId: childModifierGroupId || null,
        isLabel,
        printerRouting,
        printerIds: printerIds ? printerIds : Prisma.DbNull,
        spiritTier: spiritTier || null,
        linkedBottleProductId: linkedBottleProductId || null,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
        isActive,
        displayName: displayName || null,
        showOnPOS,
        showOnline,
        showAsHotButton,
        cost: cost !== undefined ? cost : null,
        commissionType: commissionType || null,
        commissionValue: commissionValue !== undefined ? commissionValue : null,
        upsellPrice: upsellPrice !== undefined ? upsellPrice : null,
        priceType,
        linkedMenuItemId: linkedMenuItemId || null,
        inventoryDeductionAmount: ingredientId ? (inventoryDeductionAmount !== undefined ? inventoryDeductionAmount : null) : null,
        inventoryDeductionUnit: ingredientId ? (inventoryDeductionUnit || null) : null,
        swapEnabled,
        swapTargets: swapTargets ? swapTargets : Prisma.DbNull,
      },
      include: {
        ingredient: {
          select: { id: true, name: true },
        },
        childModifierGroup: {
          select: { id: true, name: true },
        },
      },
    })

    // Fire-and-forget socket dispatch for real-time menu structure updates
    void dispatchMenuStructureChanged(group.locationId, {
      action: 'modifier-group-updated',
      entityId: groupId,
      entityType: 'modifier-group',
    }).catch(() => {})

    return NextResponse.json({
      data: {
        id: modifier.id,
        name: modifier.name,
        price: Number(modifier.price),
        allowNo: modifier.allowNo,
        allowLite: modifier.allowLite,
        allowOnSide: modifier.allowOnSide,
        allowExtra: modifier.allowExtra,
        extraPrice: Number(modifier.extraPrice),
        liteMultiplier: modifier.liteMultiplier !== null ? Number(modifier.liteMultiplier) : null,
        extraMultiplier: modifier.extraMultiplier !== null ? Number(modifier.extraMultiplier) : null,
        isDefault: modifier.isDefault,
        sortOrder: modifier.sortOrder,
        ingredientId: modifier.ingredientId,
        ingredientName: modifier.ingredient?.name || null,
        childModifierGroupId: modifier.childModifierGroupId,
        childModifierGroupName: modifier.childModifierGroup?.name || null,
        isLabel: modifier.isLabel,
        printerRouting: modifier.printerRouting,
        printerIds: modifier.printerIds,
        isActive: modifier.isActive,
        displayName: modifier.displayName,
        showOnPOS: modifier.showOnPOS,
        showOnline: modifier.showOnline,
        showAsHotButton: modifier.showAsHotButton,
        cost: modifier.cost !== null ? Number(modifier.cost) : null,
        commissionType: modifier.commissionType,
        commissionValue: modifier.commissionValue !== null ? Number(modifier.commissionValue) : null,
        upsellPrice: modifier.upsellPrice !== null ? Number(modifier.upsellPrice) : null,
        priceType: modifier.priceType,
        linkedMenuItemId: modifier.linkedMenuItemId,
        inventoryDeductionAmount: modifier.inventoryDeductionAmount !== null ? Number(modifier.inventoryDeductionAmount) : null,
        inventoryDeductionUnit: modifier.inventoryDeductionUnit,
        swapEnabled: modifier.swapEnabled,
        swapTargets: modifier.swapTargets,
        spiritTier: modifier.spiritTier,
        linkedBottleProductId: modifier.linkedBottleProductId,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'A modifier with this name already exists in this group' },
        { status: 409 }
      )
    }
    console.error('Error creating modifier:', error)
    return NextResponse.json({ error: 'Failed to create modifier' }, { status: 500 })
  }
})

// PUT /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Update modifier
export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const {
      modifierId,
      name,
      price,
      allowNo,
      allowLite,
      allowOnSide,
      allowExtra,
      extraPrice,
      liteMultiplier,
      extraMultiplier,
      isDefault,
      ingredientId,
      childModifierGroupId,
      isLabel,
      printerRouting,
      printerIds,
      spiritTier,
      linkedBottleProductId,
      isActive,
      displayName,
      showOnPOS,
      showOnline,
      showAsHotButton,
      cost,
      commissionType,
      commissionValue,
      upsellPrice,
      priceType,
      linkedMenuItemId,
      inventoryDeductionAmount,
      inventoryDeductionUnit,
      swapEnabled,
      swapTargets,
    } = body

    if (!modifierId) {
      return NextResponse.json({ error: 'modifierId is required' }, { status: 400 })
    }

    // Verify modifier belongs to this group
    const modifier = await db.modifier.findFirst({
      where: { id: modifierId, modifierGroupId: groupId },
    })

    if (!modifier) {
      return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
    }

    // Validate inputs
    if (price !== undefined && typeof price !== 'number') {
      const parsed = Number(price)
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: 'Price must be a valid number' }, { status: 400 })
      }
    }
    if (extraPrice !== undefined && typeof extraPrice !== 'number') {
      const parsed = Number(extraPrice)
      if (!Number.isFinite(parsed)) {
        return NextResponse.json({ error: 'Extra price must be a valid number' }, { status: 400 })
      }
    }

    // Validate swapTargets — check existing DB targets when payload doesn't include new ones
    const effectiveSwapEnabled = swapEnabled !== undefined ? swapEnabled : modifier.swapEnabled
    const effectiveSwapTargets = swapTargets !== undefined ? swapTargets : (modifier.swapTargets as any[] | null)
    if (effectiveSwapEnabled && (!effectiveSwapTargets || !Array.isArray(effectiveSwapTargets) || effectiveSwapTargets.length === 0)) {
      return NextResponse.json({ error: 'Swap enabled requires at least one swap target' }, { status: 400 })
    }
    if (swapTargets && Array.isArray(swapTargets)) {
      const seenIds = new Set()
      for (const target of swapTargets) {
        if (!target.menuItemId || !target.name || target.snapshotPrice === undefined || !target.pricingMode) {
          return NextResponse.json({ error: 'Each swap target must have menuItemId, name, snapshotPrice, and pricingMode' }, { status: 400 })
        }
        if (!['target_price', 'fixed_price', 'no_charge'].includes(target.pricingMode)) {
          return NextResponse.json({ error: 'Invalid pricingMode. Must be target_price, fixed_price, or no_charge' }, { status: 400 })
        }
        if (target.pricingMode === 'fixed_price' && (target.fixedPrice === undefined || target.fixedPrice === null)) {
          return NextResponse.json({ error: 'fixedPrice is required when pricingMode is fixed_price' }, { status: 400 })
        }
        if (target.name && target.name.length > 100) {
          return NextResponse.json({ error: 'Swap target name must be 100 characters or less' }, { status: 400 })
        }
        if (seenIds.has(target.menuItemId)) {
          return NextResponse.json({ error: 'Duplicate menuItemId in swap targets' }, { status: 400 })
        }
        seenIds.add(target.menuItemId)
      }
    }

    // Validate inventoryDeductionAmount
    if (inventoryDeductionAmount !== undefined && inventoryDeductionAmount !== null && inventoryDeductionAmount < 0) {
      return NextResponse.json({ error: 'inventoryDeductionAmount must be >= 0' }, { status: 400 })
    }
    // Clear orphaned deduction config if ingredient is being removed
    const effectiveIngredientId = ingredientId !== undefined ? ingredientId : modifier.ingredientId
    if (!effectiveIngredientId && (inventoryDeductionAmount !== undefined || inventoryDeductionUnit !== undefined)) {
      // Clear orphaned deduction config if no ingredient linked
    }
    const effectiveUnit = inventoryDeductionUnit !== undefined ? inventoryDeductionUnit : modifier.inventoryDeductionUnit
    if (effectiveIngredientId && inventoryDeductionAmount !== undefined && inventoryDeductionAmount !== null && !effectiveUnit) {
      return NextResponse.json({ error: 'inventoryDeductionUnit is required when inventoryDeductionAmount is set' }, { status: 400 })
    }

    // Validate commission — check existing commissionType when not in payload
    const effectiveCommissionType = commissionType !== undefined ? commissionType : modifier.commissionType
    if (effectiveCommissionType === 'percent' && commissionValue !== undefined && commissionValue > 100) {
      return NextResponse.json({ error: 'Percent commission cannot exceed 100' }, { status: 400 })
    }

    // Enforce maxSelections when setting isDefault: true
    // If this would exceed the group's max, clear excess defaults first
    if (isDefault === true) {
      const group = await db.modifierGroup.findUnique({
        where: { id: groupId },
        select: { maxSelections: true },
      })
      if (group && group.maxSelections > 0) {
        const currentDefaults = await db.modifier.findMany({
          where: { modifierGroupId: groupId, isDefault: true, deletedAt: null, id: { not: modifierId } },
          orderBy: { sortOrder: 'asc' },
          select: { id: true },
        })
        // If adding this one would exceed max, clear oldest defaults to make room
        if (currentDefaults.length >= group.maxSelections) {
          const excessCount = currentDefaults.length - group.maxSelections + 1
          const idsToUndefault = currentDefaults.slice(0, excessCount).map(d => d.id)
          await db.modifier.updateMany({
            where: { id: { in: idsToUndefault } },
            data: { isDefault: false },
          })
        }
      }
    }

    const updated = await db.modifier.update({
      where: { id: modifierId },
      data: {
        name: name !== undefined ? name : undefined,
        price: price !== undefined ? price : undefined,
        allowNo: allowNo !== undefined ? allowNo : undefined,
        allowLite: allowLite !== undefined ? allowLite : undefined,
        allowOnSide: allowOnSide !== undefined ? allowOnSide : undefined,
        allowExtra: allowExtra !== undefined ? allowExtra : undefined,
        extraPrice: extraPrice !== undefined ? extraPrice : undefined,
        liteMultiplier: liteMultiplier !== undefined ? (liteMultiplier !== null ? liteMultiplier : null) : undefined,
        extraMultiplier: extraMultiplier !== undefined ? (extraMultiplier !== null ? extraMultiplier : null) : undefined,
        isDefault: isDefault !== undefined ? isDefault : undefined,
        ingredientId: ingredientId !== undefined ? (ingredientId || null) : undefined,
        childModifierGroupId: childModifierGroupId !== undefined ? (childModifierGroupId || null) : undefined,
        isLabel: isLabel !== undefined ? isLabel : undefined,
        printerRouting: printerRouting !== undefined ? printerRouting : undefined,
        printerIds: printerIds !== undefined ? (printerIds ? printerIds : Prisma.DbNull) : undefined,
        spiritTier: spiritTier !== undefined ? (spiritTier || null) : undefined,
        linkedBottleProductId: linkedBottleProductId !== undefined ? (linkedBottleProductId || null) : undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        displayName: displayName !== undefined ? (displayName || null) : undefined,
        showOnPOS: showOnPOS !== undefined ? showOnPOS : undefined,
        showOnline: showOnline !== undefined ? showOnline : undefined,
        showAsHotButton: showAsHotButton !== undefined ? showAsHotButton : undefined,
        cost: cost !== undefined ? (cost !== null ? cost : null) : undefined,
        commissionType: commissionType !== undefined ? (commissionType || null) : undefined,
        commissionValue: commissionValue !== undefined ? (commissionValue !== null ? commissionValue : null) : undefined,
        upsellPrice: upsellPrice !== undefined ? (upsellPrice !== null ? upsellPrice : null) : undefined,
        priceType: priceType !== undefined ? priceType : undefined,
        linkedMenuItemId: linkedMenuItemId !== undefined ? (linkedMenuItemId || null) : undefined,
        inventoryDeductionAmount: ingredientId === null ? null : (inventoryDeductionAmount !== undefined ? (inventoryDeductionAmount !== null ? inventoryDeductionAmount : null) : undefined),
        inventoryDeductionUnit: ingredientId === null ? null : (inventoryDeductionUnit !== undefined ? (inventoryDeductionUnit || null) : undefined),
        swapEnabled: swapEnabled !== undefined ? swapEnabled : undefined,
        swapTargets: swapTargets !== undefined ? (swapTargets ? swapTargets : Prisma.DbNull) : undefined,
      },
      include: {
        ingredient: {
          select: { id: true, name: true },
        },
        childModifierGroup: {
          select: { id: true, name: true },
        },
      },
    })

    // Fire-and-forget socket dispatch for real-time menu structure updates
    void dispatchMenuStructureChanged(modifier.locationId, {
      action: 'modifier-group-updated',
      entityId: groupId,
      entityType: 'modifier-group',
    }).catch(() => {})

    return NextResponse.json({
      data: {
        id: updated.id,
        name: updated.name,
        price: Number(updated.price),
        allowNo: updated.allowNo,
        allowLite: updated.allowLite,
        allowOnSide: updated.allowOnSide,
        allowExtra: updated.allowExtra,
        extraPrice: Number(updated.extraPrice),
        liteMultiplier: updated.liteMultiplier !== null ? Number(updated.liteMultiplier) : null,
        extraMultiplier: updated.extraMultiplier !== null ? Number(updated.extraMultiplier) : null,
        isDefault: updated.isDefault,
        sortOrder: updated.sortOrder,
        ingredientId: updated.ingredientId,
        ingredientName: updated.ingredient?.name || null,
        childModifierGroupId: updated.childModifierGroupId,
        childModifierGroupName: updated.childModifierGroup?.name || null,
        isLabel: updated.isLabel,
        printerRouting: updated.printerRouting,
        printerIds: updated.printerIds,
        isActive: updated.isActive,
        displayName: updated.displayName,
        showOnPOS: updated.showOnPOS,
        showOnline: updated.showOnline,
        showAsHotButton: updated.showAsHotButton,
        cost: updated.cost !== null ? Number(updated.cost) : null,
        commissionType: updated.commissionType,
        commissionValue: updated.commissionValue !== null ? Number(updated.commissionValue) : null,
        upsellPrice: updated.upsellPrice !== null ? Number(updated.upsellPrice) : null,
        priceType: updated.priceType,
        linkedMenuItemId: updated.linkedMenuItemId,
        inventoryDeductionAmount: updated.inventoryDeductionAmount !== null ? Number(updated.inventoryDeductionAmount) : null,
        inventoryDeductionUnit: updated.inventoryDeductionUnit,
        swapEnabled: updated.swapEnabled,
        swapTargets: updated.swapTargets,
        spiritTier: updated.spiritTier,
        linkedBottleProductId: updated.linkedBottleProductId,
      },
    })
  } catch (error) {
    console.error('Error updating modifier:', error)
    return NextResponse.json({ error: 'Failed to update modifier' }, { status: 500 })
  }
})

// DELETE /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Delete modifier
export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { groupId } = await params
    const { searchParams } = new URL(request.url)
    const modifierId = searchParams.get('modifierId')

    if (!modifierId) {
      return NextResponse.json({ error: 'modifierId is required' }, { status: 400 })
    }

    // Verify modifier belongs to this group
    const modifier = await db.modifier.findFirst({
      where: { id: modifierId, modifierGroupId: groupId },
    })

    if (!modifier) {
      return NextResponse.json({ error: 'Modifier not found' }, { status: 404 })
    }

    // Soft delete
    await db.modifier.update({
      where: { id: modifierId },
      data: { deletedAt: new Date() },
    })

    // Cascade soft-delete to child modifier group and its modifiers
    if (modifier.childModifierGroupId) {
      await db.modifier.updateMany({
        where: { modifierGroupId: modifier.childModifierGroupId, deletedAt: null },
        data: { deletedAt: new Date() },
      })
      await db.modifierGroup.update({
        where: { id: modifier.childModifierGroupId },
        data: { deletedAt: new Date() },
      })
    }

    // Fire-and-forget socket dispatch for real-time menu structure updates
    void dispatchMenuStructureChanged(modifier.locationId, {
      action: 'modifier-group-updated',
      entityId: groupId,
      entityType: 'modifier-group',
    }).catch(() => {})

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Error deleting modifier:', error)
    return NextResponse.json({ error: 'Failed to delete modifier' }, { status: 500 })
  }
})

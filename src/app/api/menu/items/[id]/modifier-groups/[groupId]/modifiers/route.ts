import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>
}

// POST /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Add modifier
export async function POST(request: NextRequest, { params }: RouteParams) {
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
      isDefault = false,
      ingredientId,
      childModifierGroupId,
      isLabel = false,
      printerRouting = 'follow',
      printerIds,
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
        isDefault,
        ingredientId: ingredientId || null,
        childModifierGroupId: childModifierGroupId || null,
        isLabel,
        printerRouting,
        printerIds: printerIds ? printerIds : Prisma.DbNull,
        sortOrder: (maxSort._max.sortOrder || 0) + 1,
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
        isDefault: modifier.isDefault,
        sortOrder: modifier.sortOrder,
        ingredientId: modifier.ingredientId,
        ingredientName: modifier.ingredient?.name || null,
        childModifierGroupId: modifier.childModifierGroupId,
        childModifierGroupName: modifier.childModifierGroup?.name || null,
        isLabel: modifier.isLabel,
        printerRouting: modifier.printerRouting,
        printerIds: modifier.printerIds,
      },
    })
  } catch (error) {
    console.error('Error creating modifier:', error)
    return NextResponse.json({ error: 'Failed to create modifier' }, { status: 500 })
  }
}

// PUT /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Update modifier
export async function PUT(request: NextRequest, { params }: RouteParams) {
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
      isDefault,
      ingredientId,
      childModifierGroupId,
      isLabel,
      printerRouting,
      printerIds,
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
        isDefault: isDefault !== undefined ? isDefault : undefined,
        ingredientId: ingredientId !== undefined ? (ingredientId || null) : undefined,
        childModifierGroupId: childModifierGroupId !== undefined ? (childModifierGroupId || null) : undefined,
        isLabel: isLabel !== undefined ? isLabel : undefined,
        printerRouting: printerRouting !== undefined ? printerRouting : undefined,
        printerIds: printerIds !== undefined ? (printerIds ? printerIds : Prisma.DbNull) : undefined,
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
        isDefault: updated.isDefault,
        sortOrder: updated.sortOrder,
        ingredientId: updated.ingredientId,
        ingredientName: updated.ingredient?.name || null,
        childModifierGroupId: updated.childModifierGroupId,
        childModifierGroupName: updated.childModifierGroup?.name || null,
        isLabel: updated.isLabel,
        printerRouting: updated.printerRouting,
        printerIds: updated.printerIds,
      },
    })
  } catch (error) {
    console.error('Error updating modifier:', error)
    return NextResponse.json({ error: 'Failed to update modifier' }, { status: 500 })
  }
}

// DELETE /api/menu/items/[id]/modifier-groups/[groupId]/modifiers - Delete modifier
export async function DELETE(request: NextRequest, { params }: RouteParams) {
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

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting modifier:', error)
    return NextResponse.json({ error: 'Failed to delete modifier' }, { status: 500 })
  }
}

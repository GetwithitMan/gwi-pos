import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string; groupId: string }>
}

// PUT /api/menu/items/[id]/modifier-groups/[groupId] - Update modifier group
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId, groupId } = await params
    const body = await request.json()
    const { name, minSelections, maxSelections, isRequired, sortOrder, allowStacking, tieredPricingConfig, exclusionGroupKey } = body

    // Verify group belongs to this item
    const group = await db.modifierGroup.findFirst({
      where: { id: groupId, menuItemId },
    })

    if (!group) {
      return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
    }

    const updated = await db.modifierGroup.update({
      where: { id: groupId },
      data: {
        name: name !== undefined ? name : undefined,
        minSelections: minSelections !== undefined ? minSelections : undefined,
        maxSelections: maxSelections !== undefined ? maxSelections : undefined,
        isRequired: isRequired !== undefined ? isRequired : undefined,
        sortOrder: sortOrder !== undefined ? sortOrder : undefined,
        allowStacking: allowStacking !== undefined ? allowStacking : undefined,
        tieredPricingConfig: tieredPricingConfig !== undefined ? (tieredPricingConfig ?? Prisma.JsonNull) : undefined,
        exclusionGroupKey: exclusionGroupKey !== undefined ? (exclusionGroupKey || null) : undefined,
      },
      include: {
        modifiers: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        name: updated.name,
        minSelections: updated.minSelections,
        maxSelections: updated.maxSelections,
        isRequired: updated.isRequired,
        allowStacking: updated.allowStacking,
        sortOrder: updated.sortOrder,
        tieredPricingConfig: updated.tieredPricingConfig,
        exclusionGroupKey: updated.exclusionGroupKey,
        modifiers: updated.modifiers.map(m => ({
          id: m.id,
          name: m.name,
          price: Number(m.price),
          allowNo: m.allowNo,
          allowLite: m.allowLite,
          allowOnSide: m.allowOnSide,
          allowExtra: m.allowExtra,
          extraPrice: Number(m.extraPrice),
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
        })),
      },
    })
  } catch (error) {
    console.error('Error updating modifier group:', error)
    return NextResponse.json({ error: 'Failed to update modifier group' }, { status: 500 })
  }
}

// DELETE /api/menu/items/[id]/modifier-groups/[groupId] - Delete modifier group
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId, groupId } = await params

    // Verify group belongs to this item
    const group = await db.modifierGroup.findFirst({
      where: { id: groupId, menuItemId },
    })

    if (!group) {
      return NextResponse.json({ error: 'Modifier group not found' }, { status: 404 })
    }

    // Soft delete the group and its modifiers
    await db.$transaction([
      db.modifier.updateMany({
        where: { modifierGroupId: groupId },
        data: { deletedAt: new Date() },
      }),
      db.modifierGroup.update({
        where: { id: groupId },
        data: { deletedAt: new Date() },
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting modifier group:', error)
    return NextResponse.json({ error: 'Failed to delete modifier group' }, { status: 500 })
  }
}

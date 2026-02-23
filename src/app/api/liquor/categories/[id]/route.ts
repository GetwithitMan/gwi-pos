import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/liquor/categories/[id]
 * Get a single spirit category by ID
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const category = await db.spiritCategory.findUnique({
      where: { id },
      include: {
        bottleProducts: {
          orderBy: [
            { tier: 'asc' },
            { name: 'asc' },
          ],
          select: {
            id: true,
            name: true,
            brand: true,
            displayName: true,
            tier: true,
            bottleSizeMl: true,
            unitCost: true,
            pourCost: true,
            currentStock: true,
            isActive: true,
          },
        },
        spiritModifierGroups: {
          include: {
            modifierGroup: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            bottleProducts: true,
            spiritModifierGroups: true,
          },
        },
      },
    })

    if (!category) {
      return NextResponse.json(
        { error: 'Spirit category not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      id: category.id,
      name: category.name,
      categoryType: category.categoryType,
      displayName: category.displayName,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      bottleCount: category._count.bottleProducts,
      modifierGroupCount: category._count.spiritModifierGroups,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
      bottleProducts: category.bottleProducts.map((b) => ({
        ...b,
        unitCost: Number(b.unitCost),
        pourCost: b.pourCost ? Number(b.pourCost) : null,
      })),
      modifierGroups: category.spiritModifierGroups.map((smg) => ({
        id: smg.modifierGroup.id,
        name: smg.modifierGroup.name,
        upsellEnabled: smg.upsellEnabled,
        upsellPromptText: smg.upsellPromptText,
        defaultTier: smg.defaultTier,
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch spirit category:', error)
    return NextResponse.json(
      { error: 'Failed to fetch spirit category' },
      { status: 500 }
    )
  }
})

/**
 * PUT /api/liquor/categories/[id]
 * Update a spirit category
 */
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, displayName, description, sortOrder, isActive, categoryType } = body

    const existing = await db.spiritCategory.findUnique({
      where: { id },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Spirit category not found' },
        { status: 404 }
      )
    }

    const category = await db.spiritCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(categoryType !== undefined && { categoryType }),
        ...(displayName !== undefined && { displayName: displayName?.trim() || null }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        _count: {
          select: {
            bottleProducts: true,
            spiritModifierGroups: true,
          },
        },
      },
    })

    return NextResponse.json({ data: {
      id: category.id,
      name: category.name,
      categoryType: category.categoryType,
      displayName: category.displayName,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      bottleCount: category._count.bottleProducts,
      modifierGroupCount: category._count.spiritModifierGroups,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    } })
  } catch (error) {
    console.error('Failed to update spirit category:', error)
    return NextResponse.json(
      { error: 'Failed to update spirit category' },
      { status: 500 }
    )
  }
})

/**
 * DELETE /api/liquor/categories/[id]
 * Delete a spirit category (only if no bottles are assigned)
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if category has bottles
    const usage = await db.spiritCategory.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            bottleProducts: true,
            spiritModifierGroups: true,
          },
        },
      },
    })

    if (!usage) {
      return NextResponse.json(
        { error: 'Spirit category not found' },
        { status: 404 }
      )
    }

    if (usage._count.bottleProducts > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete category with assigned bottles',
          bottleCount: usage._count.bottleProducts,
        },
        { status: 400 }
      )
    }

    if (usage._count.spiritModifierGroups > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete category with linked modifier groups',
          modifierGroupCount: usage._count.spiritModifierGroups,
        },
        { status: 400 }
      )
    }

    await db.spiritCategory.update({ where: { id }, data: { deletedAt: new Date() } })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete spirit category:', error)
    return NextResponse.json(
      { error: 'Failed to delete spirit category' },
      { status: 500 }
    )
  }
})

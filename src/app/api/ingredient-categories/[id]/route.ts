import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/ingredient-categories/[id] - Get a single category with its ingredients
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const category = await db.ingredientCategory.findUnique({
      where: { id },
      include: {
        ingredients: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            description: true,
            sortOrder: true,
            allowNo: true,
            allowLite: true,
            allowExtra: true,
            allowOnSide: true,
            extraPrice: true,
            visibility: true,
          },
        },
      },
    })

    if (!category || category.deletedAt) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...category,
        ingredients: category.ingredients.map(ing => ({
          ...ing,
          extraPrice: Number(ing.extraPrice),
        })),
      },
    })
  } catch (error) {
    console.error('Error fetching ingredient category:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient category' }, { status: 500 })
  }
}

// PUT /api/ingredient-categories/[id] - Update a category
// NOTE: code is IMMUTABLE and cannot be changed
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()

    const {
      name,
      description,
      icon,
      color,
      sortOrder,
      isActive,
    } = body

    // Check category exists
    const existing = await db.ingredientCategory.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Check for duplicate name (if name is being changed)
    if (name && name !== existing.name) {
      const duplicate = await db.ingredientCategory.findFirst({
        where: { locationId: existing.locationId, name, deletedAt: null, NOT: { id } },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        )
      }
    }

    const category = await db.ingredientCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(color !== undefined && { color }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        // NOTE: code is intentionally NOT updated - it's immutable
      },
      include: {
        _count: {
          select: {
            ingredients: {
              where: { deletedAt: null, isActive: true },
            },
          },
        },
      },
    })

    return NextResponse.json({
      data: {
        ...category,
        ingredientCount: category._count.ingredients,
        _count: undefined,
      },
    })
  } catch (error) {
    console.error('Error updating ingredient category:', error)
    return NextResponse.json({ error: 'Failed to update ingredient category' }, { status: 500 })
  }
}

// DELETE /api/ingredient-categories/[id] - Soft delete a category
// Only allowed if no active ingredients
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    // Check if category exists
    const existing = await db.ingredientCategory.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            ingredients: {
              where: { deletedAt: null, isActive: true },
            },
          },
        },
      },
    })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Check if category has active ingredients
    if (existing._count.ingredients > 0) {
      return NextResponse.json(
        { error: `Cannot delete category with ${existing._count.ingredients} active ingredients. Deactivate or reassign them first.` },
        { status: 400 }
      )
    }

    // Soft delete
    await db.ingredientCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Category deleted' } })
  } catch (error) {
    console.error('Error deleting ingredient category:', error)
    return NextResponse.json({ error: 'Failed to delete ingredient category' }, { status: 500 })
  }
}

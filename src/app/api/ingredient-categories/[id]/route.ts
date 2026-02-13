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
      needsVerification,
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
        ...(needsVerification !== undefined && { needsVerification }),
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
// If category has items, requires confirmDelete: "DELETE" in body to cascade soft-delete them
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    // Parse optional body for confirmation
    let confirmDelete = ''
    try {
      const body = await request.json()
      confirmDelete = body.confirmDelete || ''
    } catch {
      // No body = no confirmation (fine for empty categories)
    }

    // Check if category exists and count its ingredients (including children)
    const existing = await db.ingredientCategory.findUnique({
      where: { id },
      include: {
        ingredients: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            parentIngredientId: true,
            childIngredients: {
              where: { deletedAt: null },
              select: { id: true, name: true },
            },
          },
        },
      },
    })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const ingredientCount = existing.ingredients.length
    const childCount = existing.ingredients.reduce(
      (sum, ing) => sum + (ing.childIngredients?.length || 0), 0
    )
    const totalCount = ingredientCount + childCount

    // If category has items, require typed confirmation
    if (totalCount > 0 && confirmDelete !== 'DELETE') {
      return NextResponse.json({
        error: `Category "${existing.name}" has ${ingredientCount} inventory item${ingredientCount !== 1 ? 's' : ''} and ${childCount} prep item${childCount !== 1 ? 's' : ''}. Type DELETE to confirm.`,
        ingredientCount,
        childCount,
        totalCount,
        requiresConfirmation: true,
      }, { status: 400 })
    }

    const now = new Date()

    // If items exist and confirmed, cascade soft-delete all ingredients + children
    if (totalCount > 0) {
      const allIngredientIds = existing.ingredients.map(i => i.id)
      const allChildIds = existing.ingredients.flatMap(
        i => (i.childIngredients || []).map(c => c.id)
      )

      // Soft-delete children first, then parents
      if (allChildIds.length > 0) {
        await db.ingredient.updateMany({
          where: { id: { in: allChildIds } },
          data: { deletedAt: now },
        })
      }
      if (allIngredientIds.length > 0) {
        await db.ingredient.updateMany({
          where: { id: { in: allIngredientIds } },
          data: { deletedAt: now },
        })
      }
    }

    // Soft delete the category itself
    await db.ingredientCategory.update({
      where: { id },
      data: { deletedAt: now },
    })

    return NextResponse.json({
      data: {
        message: totalCount > 0
          ? `Category "${existing.name}" deleted with ${totalCount} item${totalCount !== 1 ? 's' : ''}`
          : `Category "${existing.name}" deleted`,
        deletedIngredients: ingredientCount,
        deletedChildren: childCount,
      },
    })
  } catch (error) {
    console.error('Error deleting ingredient category:', error)
    return NextResponse.json({ error: 'Failed to delete ingredient category' }, { status: 500 })
  }
}

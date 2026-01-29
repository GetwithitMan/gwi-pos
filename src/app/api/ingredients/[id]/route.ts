import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/ingredients/[id] - Get a single ingredient
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const ingredient = await db.ingredient.findUnique({
      where: { id },
      include: {
        swapModifierGroup: {
          select: {
            id: true,
            name: true,
            modifiers: {
              where: { isActive: true },
              select: {
                id: true,
                name: true,
                price: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        menuItemIngredients: {
          include: {
            menuItem: {
              select: { id: true, name: true },
            },
          },
        },
      },
    })

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...ingredient,
        extraPrice: Number(ingredient.extraPrice),
        swapUpcharge: Number(ingredient.swapUpcharge),
        swapModifierGroup: ingredient.swapModifierGroup ? {
          ...ingredient.swapModifierGroup,
          modifiers: ingredient.swapModifierGroup.modifiers.map(m => ({
            ...m,
            price: Number(m.price),
          })),
        } : null,
      },
    })
  } catch (error) {
    console.error('Error fetching ingredient:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient' }, { status: 500 })
  }
}

// PUT /api/ingredients/[id] - Update an ingredient
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()

    const {
      name,
      category,
      allowNo,
      allowLite,
      allowOnSide,
      allowExtra,
      extraPrice,
      allowSwap,
      swapModifierGroupId,
      swapUpcharge,
      sortOrder,
      isActive,
    } = body

    // Check ingredient exists
    const existing = await db.ingredient.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Check for duplicate name (if name is being changed)
    if (name && name !== existing.name) {
      const duplicate = await db.ingredient.findFirst({
        where: { locationId: existing.locationId, name, NOT: { id } },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: 'An ingredient with this name already exists' },
          { status: 409 }
        )
      }
    }

    const ingredient = await db.ingredient.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(allowNo !== undefined && { allowNo }),
        ...(allowLite !== undefined && { allowLite }),
        ...(allowOnSide !== undefined && { allowOnSide }),
        ...(allowExtra !== undefined && { allowExtra }),
        ...(extraPrice !== undefined && { extraPrice }),
        ...(allowSwap !== undefined && { allowSwap }),
        ...(swapModifierGroupId !== undefined && { swapModifierGroupId: allowSwap ? swapModifierGroupId : null }),
        ...(swapUpcharge !== undefined && { swapUpcharge: allowSwap ? swapUpcharge : 0 }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        swapModifierGroup: {
          select: { id: true, name: true },
        },
      },
    })

    return NextResponse.json({
      data: {
        ...ingredient,
        extraPrice: Number(ingredient.extraPrice),
        swapUpcharge: Number(ingredient.swapUpcharge),
      },
    })
  } catch (error) {
    console.error('Error updating ingredient:', error)
    return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
  }
}

// DELETE /api/ingredients/[id] - Soft delete an ingredient
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    // Check if ingredient exists
    const existing = await db.ingredient.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Check if ingredient is used by any menu items
    const usageCount = await db.menuItemIngredient.count({
      where: { ingredientId: id },
    })

    if (usageCount > 0) {
      // Soft delete - mark as inactive
      await db.ingredient.update({
        where: { id },
        data: { isActive: false },
      })
      return NextResponse.json({
        data: { message: `Ingredient deactivated (used by ${usageCount} menu items)` },
      })
    }

    // Hard delete if not used
    await db.ingredient.delete({ where: { id } })
    return NextResponse.json({ data: { message: 'Ingredient deleted' } })
  } catch (error) {
    console.error('Error deleting ingredient:', error)
    return NextResponse.json({ error: 'Failed to delete ingredient' }, { status: 500 })
  }
}

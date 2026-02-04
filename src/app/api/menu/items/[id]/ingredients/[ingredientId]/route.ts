import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string; ingredientId: string }>
}

// PUT /api/menu/items/[id]/ingredients/[ingredientId] - Update ingredient settings for a menu item
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: menuItemId, ingredientId } = await params
    const body = await request.json()
    const {
      allowNo,
      allowLite,
      allowOnSide,
      allowExtra,
      extraPrice,
    } = body

    // Verify the menu item ingredient link exists
    const menuItemIngredient = await db.menuItemIngredient.findFirst({
      where: {
        menuItemId,
        ingredientId,
      },
      include: {
        ingredient: {
          select: {
            allowNo: true,
            allowLite: true,
            allowOnSide: true,
            allowExtra: true,
            extraPrice: true,
          },
        },
      },
    })

    if (!menuItemIngredient) {
      return NextResponse.json(
        { error: 'Ingredient not found on this menu item' },
        { status: 404 }
      )
    }

    // Update the override fields
    // If the value matches the ingredient default, store null (no override)
    // Otherwise, store the override value
    const updated = await db.menuItemIngredient.update({
      where: { id: menuItemIngredient.id },
      data: {
        allowNo: allowNo !== undefined
          ? (allowNo === menuItemIngredient.ingredient.allowNo ? null : allowNo)
          : undefined,
        allowLite: allowLite !== undefined
          ? (allowLite === menuItemIngredient.ingredient.allowLite ? null : allowLite)
          : undefined,
        allowOnSide: allowOnSide !== undefined
          ? (allowOnSide === menuItemIngredient.ingredient.allowOnSide ? null : allowOnSide)
          : undefined,
        allowExtra: allowExtra !== undefined
          ? (allowExtra === menuItemIngredient.ingredient.allowExtra ? null : allowExtra)
          : undefined,
        extraPrice: extraPrice !== undefined
          ? (extraPrice === Number(menuItemIngredient.ingredient.extraPrice) ? null : extraPrice)
          : undefined,
      },
      include: {
        ingredient: {
          select: {
            name: true,
            category: true,
            allowNo: true,
            allowLite: true,
            allowOnSide: true,
            allowExtra: true,
            extraPrice: true,
          },
        },
      },
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        ingredientId: updated.ingredientId,
        name: updated.ingredient.name,
        category: updated.ingredient.category,
        // Return effective values (override or default)
        allowNo: updated.allowNo ?? updated.ingredient.allowNo,
        allowLite: updated.allowLite ?? updated.ingredient.allowLite,
        allowOnSide: updated.allowOnSide ?? updated.ingredient.allowOnSide,
        allowExtra: updated.allowExtra ?? updated.ingredient.allowExtra,
        extraPrice: Number(updated.extraPrice ?? updated.ingredient.extraPrice),
        // Also return whether overrides are active
        hasOverrides: {
          allowNo: updated.allowNo !== null,
          allowLite: updated.allowLite !== null,
          allowOnSide: updated.allowOnSide !== null,
          allowExtra: updated.allowExtra !== null,
          extraPrice: updated.extraPrice !== null,
        },
      },
    })
  } catch (error) {
    console.error('Error updating ingredient settings:', error)
    return NextResponse.json(
      { error: 'Failed to update ingredient settings' },
      { status: 500 }
    )
  }
}

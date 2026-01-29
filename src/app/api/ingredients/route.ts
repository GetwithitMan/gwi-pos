import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/ingredients - List all ingredients for a location
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const category = searchParams.get('category')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const ingredients = await db.ingredient.findMany({
      where: {
        locationId,
        ...(category ? { category } : {}),
        ...(includeInactive ? {} : { isActive: true }),
      },
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
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: ingredients.map(ing => ({
        ...ing,
        extraPrice: Number(ing.extraPrice),
        swapUpcharge: Number(ing.swapUpcharge),
        swapModifierGroup: ing.swapModifierGroup ? {
          ...ing.swapModifierGroup,
          modifiers: ing.swapModifierGroup.modifiers.map(m => ({
            ...m,
            price: Number(m.price),
          })),
        } : null,
      })),
    })
  } catch (error) {
    console.error('Error fetching ingredients:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredients' }, { status: 500 })
  }
}

// POST /api/ingredients - Create a new ingredient
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      category,
      allowNo = true,
      allowLite = true,
      allowOnSide = true,
      allowExtra = true,
      extraPrice = 0,
      allowSwap = false,
      swapModifierGroupId,
      swapUpcharge = 0,
      sortOrder,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'locationId and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await db.ingredient.findFirst({
      where: { locationId, name },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'An ingredient with this name already exists' },
        { status: 409 }
      )
    }

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.ingredient.aggregate({
        where: { locationId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    const ingredient = await db.ingredient.create({
      data: {
        locationId,
        name,
        category,
        allowNo,
        allowLite,
        allowOnSide,
        allowExtra,
        extraPrice,
        allowSwap,
        swapModifierGroupId: allowSwap ? swapModifierGroupId : null,
        swapUpcharge: allowSwap ? swapUpcharge : 0,
        sortOrder: finalSortOrder,
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
    console.error('Error creating ingredient:', error)
    return NextResponse.json({ error: 'Failed to create ingredient' }, { status: 500 })
  }
}

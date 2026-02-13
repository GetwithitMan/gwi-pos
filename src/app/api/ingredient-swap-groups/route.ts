import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET /api/ingredient-swap-groups - List all swap groups with member ingredients
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const groups = await db.ingredientSwapGroup.findMany({
      where: {
        locationId,
        deletedAt: null,
        ...(includeInactive ? {} : { isActive: true }),
      },
      include: {
        ingredients: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            extraPrice: true,
            swapUpcharge: true,
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return NextResponse.json({
      data: groups.map(group => ({
        ...group,
        ingredients: group.ingredients.map(ing => ({
          ...ing,
          extraPrice: Number(ing.extraPrice),
          swapUpcharge: Number(ing.swapUpcharge),
        })),
      })),
    })
  } catch (error) {
    console.error('Error fetching ingredient swap groups:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient swap groups' }, { status: 500 })
  }
})

// POST /api/ingredient-swap-groups - Create a new swap group
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      sortOrder,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'locationId and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name
    const existing = await db.ingredientSwapGroup.findFirst({
      where: { locationId, name, deletedAt: null },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A swap group with this name already exists' },
        { status: 409 }
      )
    }

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.ingredientSwapGroup.aggregate({
        where: { locationId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    const group = await db.ingredientSwapGroup.create({
      data: {
        locationId,
        name,
        description,
        sortOrder: finalSortOrder,
      },
    })

    return NextResponse.json({
      data: {
        ...group,
        ingredients: [],
      },
    })
  } catch (error) {
    console.error('Error creating ingredient swap group:', error)
    return NextResponse.json({ error: 'Failed to create ingredient swap group' }, { status: 500 })
  }
})

// PUT /api/ingredient-swap-groups - Update a swap group
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      id,
      name,
      description,
      sortOrder,
      isActive,
    } = body

    if (!id) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      )
    }

    // Check group exists
    const existing = await db.ingredientSwapGroup.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Swap group not found' }, { status: 404 })
    }

    // Check for duplicate name (if name is being changed)
    if (name && name !== existing.name) {
      const duplicate = await db.ingredientSwapGroup.findFirst({
        where: { locationId: existing.locationId, name, deletedAt: null, NOT: { id } },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: 'A swap group with this name already exists' },
          { status: 409 }
        )
      }
    }

    const group = await db.ingredientSwapGroup.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
      },
      include: {
        ingredients: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            extraPrice: true,
            swapUpcharge: true,
          },
        },
      },
    })

    return NextResponse.json({
      data: {
        ...group,
        ingredients: group.ingredients.map(ing => ({
          ...ing,
          extraPrice: Number(ing.extraPrice),
          swapUpcharge: Number(ing.swapUpcharge),
        })),
      },
    })
  } catch (error) {
    console.error('Error updating ingredient swap group:', error)
    return NextResponse.json({ error: 'Failed to update ingredient swap group' }, { status: 500 })
  }
})

// DELETE /api/ingredient-swap-groups - Soft delete a swap group
export const DELETE = withVenue(async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    // Check if group exists
    const existing = await db.ingredientSwapGroup.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Swap group not found' }, { status: 404 })
    }

    // First, unlink all ingredients from this swap group
    await db.ingredient.updateMany({
      where: { swapGroupId: id },
      data: { swapGroupId: null, allowSwap: false },
    })

    // Soft delete
    await db.ingredientSwapGroup.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Swap group deleted' } })
  } catch (error) {
    console.error('Error deleting ingredient swap group:', error)
    return NextResponse.json({ error: 'Failed to delete ingredient swap group' }, { status: 500 })
  }
})

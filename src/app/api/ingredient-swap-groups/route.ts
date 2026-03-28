import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET /api/ingredient-swap-groups - List all swap groups with member ingredients
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const includeInactive = searchParams.get('includeInactive') === 'true'

    if (!locationId) {
      return err('locationId is required')
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

    return ok(groups.map(group => ({
        ...group,
        ingredients: group.ingredients.map(ing => ({
          ...ing,
          extraPrice: Number(ing.extraPrice),
          swapUpcharge: Number(ing.swapUpcharge),
        })),
      })))
  } catch (error) {
    console.error('Error fetching ingredient swap groups:', error)
    return err('Failed to fetch ingredient swap groups', 500)
  }
})

// POST /api/ingredient-swap-groups - Create a new swap group
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      sortOrder,
    } = body

    if (!locationId || !name) {
      return err('locationId and name are required')
    }

    // Check for duplicate name
    const existing = await db.ingredientSwapGroup.findFirst({
      where: { locationId, name, deletedAt: null },
    })
    if (existing) {
      return err('A swap group with this name already exists', 409)
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
        lastMutatedBy: 'cloud',
      },
    })

    return ok({
        ...group,
        ingredients: [],
      })
  } catch (error) {
    console.error('Error creating ingredient swap group:', error)
    return err('Failed to create ingredient swap group', 500)
  }
}))

// PUT /api/ingredient-swap-groups - Update a swap group
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest) {
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
      return err('id is required')
    }

    // Check group exists
    const existing = await db.ingredientSwapGroup.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Swap group not found')
    }

    // Check for duplicate name (if name is being changed)
    if (name && name !== existing.name) {
      const duplicate = await db.ingredientSwapGroup.findFirst({
        where: { locationId: existing.locationId, name, deletedAt: null, NOT: { id } },
      })
      if (duplicate) {
        return err('A swap group with this name already exists', 409)
      }
    }

    const group = await db.ingredientSwapGroup.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(isActive !== undefined && { isActive }),
        lastMutatedBy: 'cloud',
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

    return ok({
        ...group,
        ingredients: group.ingredients.map(ing => ({
          ...ing,
          extraPrice: Number(ing.extraPrice),
          swapUpcharge: Number(ing.swapUpcharge),
        })),
      })
  } catch (error) {
    console.error('Error updating ingredient swap group:', error)
    return err('Failed to update ingredient swap group', 500)
  }
}))

// DELETE /api/ingredient-swap-groups - Soft delete a swap group
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return err('id is required')
    }

    // Check if group exists
    const existing = await db.ingredientSwapGroup.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Swap group not found')
    }

    // First, unlink all ingredients from this swap group
    await db.ingredient.updateMany({
      where: { swapGroupId: id },
      data: { swapGroupId: null, allowSwap: false },
    })

    // Soft delete
    await db.ingredientSwapGroup.update({
      where: { id },
      data: { deletedAt: new Date(), lastMutatedBy: 'cloud' },
    })

    return ok({ message: 'Swap group deleted' })
  } catch (error) {
    console.error('Error deleting ingredient swap group:', error)
    return err('Failed to delete ingredient swap group', 500)
  }
}))

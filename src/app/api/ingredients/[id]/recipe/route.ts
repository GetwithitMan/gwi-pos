import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('ingredients.id.recipe')

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/ingredients/[id]/recipe - Get recipe components for an ingredient
export const GET = withVenue(async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const components = await db.ingredientRecipe.findMany({
      where: { outputId: id, deletedAt: null },
      include: {
        component: {
          select: {
            id: true,
            name: true,
            standardQuantity: true,
            standardUnit: true,
            categoryRelation: {
              select: { id: true, name: true, icon: true, color: true },
            },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    })

    return ok(components.map(c => ({
        id: c.id,
        componentId: c.componentId,
        component: c.component,
        quantity: Number(c.quantity),
        unit: c.unit,
        batchSize: c.batchSize ? Number(c.batchSize) : null,
        batchUnit: c.batchUnit,
        sortOrder: c.sortOrder,
      })))
  } catch (error) {
    console.error('Error fetching ingredient recipe:', error)
    return err('Failed to fetch recipe', 500)
  }
})

// POST /api/ingredients/[id]/recipe - Add a component to the recipe
export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { componentId, quantity, unit, batchSize, batchUnit } = body

    if (!componentId || !quantity || !unit) {
      return err('componentId, quantity, and unit are required')
    }

    // Get the ingredient to get its locationId
    const ingredient = await db.ingredient.findUnique({ where: { id } })
    if (!ingredient || ingredient.deletedAt) {
      return notFound('Ingredient not found')
    }

    // Verify component exists
    const component = await db.ingredient.findUnique({ where: { id: componentId } })
    if (!component || component.deletedAt) {
      return notFound('Component ingredient not found')
    }

    // Prevent circular reference
    if (componentId === id) {
      return err('Cannot use ingredient as its own component')
    }

    // Get max sortOrder
    const maxSort = await db.ingredientRecipe.aggregate({
      where: { outputId: id },
      _max: { sortOrder: true },
    })
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1

    // Check if already exists
    const existing = await db.ingredientRecipe.findFirst({
      where: { outputId: id, componentId, deletedAt: null },
    })
    if (existing) {
      return err('This component is already in the recipe', 409)
    }

    const recipe = await db.ingredientRecipe.create({
      data: {
        locationId: ingredient.locationId,
        outputId: id,
        componentId,
        quantity,
        unit,
        batchSize,
        batchUnit,
        sortOrder,
        lastMutatedBy: 'cloud',
      },
      include: {
        component: {
          select: {
            id: true,
            name: true,
            standardQuantity: true,
            standardUnit: true,
          },
        },
      },
    })

    pushUpstream()

    // Real-time cross-terminal update
    void emitToLocation(ingredient.locationId, 'inventory:changed', { ingredientId: id }).catch(err => log.warn({ err }, 'socket emit failed'))

    return ok({
        id: recipe.id,
        componentId: recipe.componentId,
        component: recipe.component,
        quantity: Number(recipe.quantity),
        unit: recipe.unit,
        batchSize: recipe.batchSize ? Number(recipe.batchSize) : null,
        batchUnit: recipe.batchUnit,
        sortOrder: recipe.sortOrder,
      })
  } catch (error) {
    console.error('Error adding recipe component:', error)
    return err('Failed to add component', 500)
  }
}))

// PUT /api/ingredients/[id]/recipe - Update a recipe component
export const PUT = withVenue(withAuth('ADMIN', async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { recipeId, quantity, unit, batchSize, batchUnit } = body

    if (!recipeId) {
      return err('recipeId is required')
    }

    const recipe = await db.ingredientRecipe.update({
      where: { id: recipeId },
      data: {
        ...(quantity !== undefined ? { quantity } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...(batchUnit !== undefined ? { batchUnit } : {}),
        lastMutatedBy: 'cloud',
      },
      include: {
        component: {
          select: {
            id: true,
            name: true,
            standardQuantity: true,
            standardUnit: true,
          },
        },
      },
    })

    pushUpstream()

    return ok({
        id: recipe.id,
        componentId: recipe.componentId,
        component: recipe.component,
        quantity: Number(recipe.quantity),
        unit: recipe.unit,
        batchSize: recipe.batchSize ? Number(recipe.batchSize) : null,
        batchUnit: recipe.batchUnit,
        sortOrder: recipe.sortOrder,
      })
  } catch (error) {
    console.error('Error updating recipe component:', error)
    return err('Failed to update component', 500)
  }
}))

// DELETE /api/ingredients/[id]/recipe - Remove a component from the recipe
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { searchParams } = new URL(request.url)
    const recipeId = searchParams.get('recipeId')

    if (!recipeId) {
      return err('recipeId is required')
    }

    await db.ingredientRecipe.update({
      where: { id: recipeId },
      data: { deletedAt: new Date(), lastMutatedBy: 'cloud' },
    })

    pushUpstream()

    return ok({ message: 'Component removed' })
  } catch (error) {
    console.error('Error removing recipe component:', error)
    return err('Failed to remove component', 500)
  }
}))

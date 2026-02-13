import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

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

    return NextResponse.json({
      data: components.map(c => ({
        id: c.id,
        componentId: c.componentId,
        component: c.component,
        quantity: Number(c.quantity),
        unit: c.unit,
        batchSize: c.batchSize ? Number(c.batchSize) : null,
        batchUnit: c.batchUnit,
        sortOrder: c.sortOrder,
      })),
    })
  } catch (error) {
    console.error('Error fetching ingredient recipe:', error)
    return NextResponse.json({ error: 'Failed to fetch recipe' }, { status: 500 })
  }
})

// POST /api/ingredients/[id]/recipe - Add a component to the recipe
export const POST = withVenue(async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { componentId, quantity, unit, batchSize, batchUnit } = body

    if (!componentId || !quantity || !unit) {
      return NextResponse.json(
        { error: 'componentId, quantity, and unit are required' },
        { status: 400 }
      )
    }

    // Get the ingredient to get its locationId
    const ingredient = await db.ingredient.findUnique({ where: { id } })
    if (!ingredient || ingredient.deletedAt) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Verify component exists
    const component = await db.ingredient.findUnique({ where: { id: componentId } })
    if (!component || component.deletedAt) {
      return NextResponse.json({ error: 'Component ingredient not found' }, { status: 404 })
    }

    // Prevent circular reference
    if (componentId === id) {
      return NextResponse.json({ error: 'Cannot use ingredient as its own component' }, { status: 400 })
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
      return NextResponse.json(
        { error: 'This component is already in the recipe' },
        { status: 409 }
      )
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

    return NextResponse.json({
      data: {
        id: recipe.id,
        componentId: recipe.componentId,
        component: recipe.component,
        quantity: Number(recipe.quantity),
        unit: recipe.unit,
        batchSize: recipe.batchSize ? Number(recipe.batchSize) : null,
        batchUnit: recipe.batchUnit,
        sortOrder: recipe.sortOrder,
      },
    })
  } catch (error) {
    console.error('Error adding recipe component:', error)
    return NextResponse.json({ error: 'Failed to add component' }, { status: 500 })
  }
})

// PUT /api/ingredients/[id]/recipe - Update a recipe component
export const PUT = withVenue(async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const { recipeId, quantity, unit, batchSize, batchUnit } = body

    if (!recipeId) {
      return NextResponse.json({ error: 'recipeId is required' }, { status: 400 })
    }

    const recipe = await db.ingredientRecipe.update({
      where: { id: recipeId },
      data: {
        ...(quantity !== undefined ? { quantity } : {}),
        ...(unit !== undefined ? { unit } : {}),
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...(batchUnit !== undefined ? { batchUnit } : {}),
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

    return NextResponse.json({
      data: {
        id: recipe.id,
        componentId: recipe.componentId,
        component: recipe.component,
        quantity: Number(recipe.quantity),
        unit: recipe.unit,
        batchSize: recipe.batchSize ? Number(recipe.batchSize) : null,
        batchUnit: recipe.batchUnit,
        sortOrder: recipe.sortOrder,
      },
    })
  } catch (error) {
    console.error('Error updating recipe component:', error)
    return NextResponse.json({ error: 'Failed to update component' }, { status: 500 })
  }
})

// DELETE /api/ingredients/[id]/recipe - Remove a component from the recipe
export const DELETE = withVenue(async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { searchParams } = new URL(request.url)
    const recipeId = searchParams.get('recipeId')

    if (!recipeId) {
      return NextResponse.json({ error: 'recipeId is required' }, { status: 400 })
    }

    await db.ingredientRecipe.update({
      where: { id: recipeId },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ data: { message: 'Component removed' } })
  } catch (error) {
    console.error('Error removing recipe component:', error)
    return NextResponse.json({ error: 'Failed to remove component' }, { status: 500 })
  }
})

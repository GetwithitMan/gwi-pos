import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get single prep item
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const prepItem = await db.prepItem.findUnique({
      where: { id },
      include: {
        ingredients: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true, costPerUnit: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
        recipeUsages: {
          include: {
            recipe: {
              include: {
                menuItem: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    })

    if (!prepItem || prepItem.deletedAt) {
      return NextResponse.json({ error: 'Prep item not found' }, { status: 404 })
    }

    return NextResponse.json({
      prepItem: {
        ...prepItem,
        batchYield: Number(prepItem.batchYield),
        costPerUnit: prepItem.costPerUnit ? Number(prepItem.costPerUnit) : null,
        currentPrepStock: Number(prepItem.currentPrepStock),
        ingredients: prepItem.ingredients.map(ing => ({
          ...ing,
          quantity: Number(ing.quantity),
          inventoryItem: ing.inventoryItem ? {
            ...ing.inventoryItem,
            costPerUnit: Number(ing.inventoryItem.costPerUnit),
          } : null,
        })),
      },
    })
  } catch (error) {
    console.error('Get prep item error:', error)
    return NextResponse.json({ error: 'Failed to fetch prep item' }, { status: 500 })
  }
})

// PUT - Update prep item
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.prepItem.findUnique({
      where: { id },
      include: { ingredients: true },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Prep item not found' }, { status: 404 })
    }

    const updateData: Record<string, unknown> = {}
    const directFields = ['name', 'description', 'outputUnit', 'batchUnit', 'storageNotes', 'isActive', 'isDailyCountItem']

    for (const field of directFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const decimalFields = ['batchYield']
    for (const field of decimalFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field] === null ? null : Number(body[field])
      }
    }

    if (body.shelfLifeHours !== undefined) {
      updateData.shelfLifeHours = body.shelfLifeHours === null ? null : Number(body.shelfLifeHours)
    }

    // Handle ingredient updates
    if (body.ingredients !== undefined) {
      // Delete existing ingredients
      await db.prepItemIngredient.deleteMany({
        where: { prepItemId: id },
      })

      // Calculate new cost and create ingredients
      let totalCost = 0
      if (body.ingredients && body.ingredients.length > 0) {
        for (const ing of body.ingredients) {
          if (ing.inventoryItemId) {
            const item = await db.inventoryItem.findUnique({
              where: { id: ing.inventoryItemId },
              select: { costPerUnit: true },
            })
            if (item) {
              totalCost += Number(item.costPerUnit) * Number(ing.quantity)
            }
          }
        }

        // Create new ingredients
        await db.prepItemIngredient.createMany({
          data: body.ingredients.map((ing: { inventoryItemId: string; quantity: number; unit: string }, index: number) => ({
            locationId: existing.locationId,
            prepItemId: id,
            inventoryItemId: ing.inventoryItemId,
            quantity: Number(ing.quantity),
            unit: ing.unit,
            sortOrder: index,
          })),
        })
      }

      const batchYield = updateData.batchYield ?? Number(existing.batchYield)
      updateData.costPerUnit = Number(batchYield) > 0 ? totalCost / Number(batchYield) : 0
    }

    const prepItem = await db.prepItem.update({
      where: { id },
      data: updateData,
      include: {
        ingredients: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    return NextResponse.json({
      prepItem: {
        ...prepItem,
        batchYield: Number(prepItem.batchYield),
        costPerUnit: prepItem.costPerUnit ? Number(prepItem.costPerUnit) : null,
        ingredients: prepItem.ingredients.map(ing => ({
          ...ing,
          quantity: Number(ing.quantity),
        })),
      },
    })
  } catch (error) {
    console.error('Update prep item error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Prep item with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to update prep item' }, { status: 500 })
  }
})

// DELETE - Soft delete prep item
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.prepItem.findUnique({
      where: { id },
      include: {
        recipeUsages: { take: 1 },
      },
    })

    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Prep item not found' }, { status: 404 })
    }

    if (existing.recipeUsages.length > 0) {
      return NextResponse.json({
        error: 'Cannot delete prep item that is used in menu item recipes',
      }, { status: 400 })
    }

    await db.prepItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete prep item error:', error)
    return NextResponse.json({ error: 'Failed to delete prep item' }, { status: 500 })
  }
})

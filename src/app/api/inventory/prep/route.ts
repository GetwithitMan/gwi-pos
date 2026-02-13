import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List prep items
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const activeOnly = searchParams.get('activeOnly') !== 'false'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const where: Record<string, unknown> = {
      locationId,
      deletedAt: null,
    }

    if (activeOnly) where.isActive = true

    const prepItems = await db.prepItem.findMany({
      where,
      include: {
        ingredients: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true, costPerUnit: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({
      prepItems: prepItems.map(item => ({
        ...item,
        batchYield: Number(item.batchYield),
        costPerUnit: item.costPerUnit ? Number(item.costPerUnit) : null,
        ingredients: item.ingredients.map(ing => ({
          ...ing,
          quantity: Number(ing.quantity),
          inventoryItem: ing.inventoryItem ? {
            ...ing.inventoryItem,
            costPerUnit: Number(ing.inventoryItem.costPerUnit),
          } : null,
        })),
      })),
    })
  } catch (error) {
    console.error('Prep items list error:', error)
    return NextResponse.json({ error: 'Failed to fetch prep items' }, { status: 500 })
  }
})

// POST - Create prep item
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      batchYield,
      batchUnit,
      outputUnit,
      storageNotes,
      shelfLifeHours,
      ingredients,
    } = body

    if (!locationId || !name || !batchYield || !outputUnit) {
      return NextResponse.json({
        error: 'Location ID, name, batch yield, and output unit required',
      }, { status: 400 })
    }

    // Calculate total cost from ingredients
    let totalCost = 0
    if (ingredients && ingredients.length > 0) {
      for (const ing of ingredients) {
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
    }

    const costPerUnit = Number(batchYield) > 0 ? totalCost / Number(batchYield) : 0

    const prepItem = await db.prepItem.create({
      data: {
        locationId,
        name,
        description,
        batchYield: Number(batchYield),
        batchUnit: batchUnit || outputUnit,
        outputUnit,
        costPerUnit,
        storageNotes,
        shelfLifeHours: shelfLifeHours ? Number(shelfLifeHours) : null,
        ingredients: ingredients ? {
          create: ingredients.map((ing: { inventoryItemId: string; quantity: number; unit: string }, index: number) => ({
            locationId,
            inventoryItemId: ing.inventoryItemId,
            quantity: Number(ing.quantity),
            unit: ing.unit,
            sortOrder: index,
          })),
        } : undefined,
      },
      include: {
        ingredients: {
          include: {
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true },
            },
          },
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
    console.error('Create prep item error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Prep item with this name already exists' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create prep item' }, { status: 500 })
  }
})

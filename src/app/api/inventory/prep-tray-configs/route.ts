import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - List tray configs for a prep item or all daily count items
// This works with Ingredients that have preparationType (prep-style ingredients)
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const prepItemId = searchParams.get('prepItemId')
    const dailyCountItemsOnly = searchParams.get('dailyCountItemsOnly') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    // If prepItemId specified, get configs for that specific ingredient
    if (prepItemId) {
      const configs = await db.prepTrayConfig.findMany({
        where: {
          locationId,
          prepItemId,
          deletedAt: null,
        },
        orderBy: { sortOrder: 'asc' },
      })

      return NextResponse.json({
        data: configs.map(c => ({
          ...c,
          capacity: Number(c.capacity),
        })),
      })
    }

    // Get all ingredients with preparationType (these are prep-style items)
    // like "Personal Pizza Crust (8")" with preparationType="Baked"
    const prepIngredients = await db.ingredient.findMany({
      where: {
        locationId,
        deletedAt: null,
        preparationType: { not: null },
        // If dailyCountItemsOnly, filter by isDailyCountItem flag
        ...(dailyCountItemsOnly ? { isDailyCountItem: true } : {}),
      },
      include: {
        parentIngredient: {
          select: {
            id: true,
            name: true,
            inventoryItemId: true,
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true, costPerUnit: true },
            },
          },
        },
        inventoryItem: {
          select: { id: true, name: true, storageUnit: true, costPerUnit: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Get tray configs for these ingredients
    const ingredientIds = prepIngredients.map(i => i.id)
    const trayConfigs = await db.prepTrayConfig.findMany({
      where: {
        locationId,
        prepItemId: { in: ingredientIds },
        deletedAt: null,
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Group tray configs by prepItemId (ingredient id)
    const trayConfigsByIngredient: Record<string, typeof trayConfigs> = {}
    for (const config of trayConfigs) {
      if (!trayConfigsByIngredient[config.prepItemId]) {
        trayConfigsByIngredient[config.prepItemId] = []
      }
      trayConfigsByIngredient[config.prepItemId].push(config)
    }

    return NextResponse.json({
      data: prepIngredients.map(item => ({
        id: item.id,
        name: item.name,
        outputUnit: item.standardUnit || 'each',
        preparationType: item.preparationType,
        yieldPercent: item.yieldPercent ? Number(item.yieldPercent) : null,
        batchYield: item.batchYield ? Number(item.batchYield) : 1,
        costPerUnit: null, // Would need to calculate from parent
        currentPrepStock: item.currentPrepStock ? Number(item.currentPrepStock) : 0,
        isDailyCountItem: item.isDailyCountItem || false,
        countPrecision: (item as { countPrecision?: string }).countPrecision || 'whole',
        parentIngredient: item.parentIngredient ? {
          id: item.parentIngredient.id,
          name: item.parentIngredient.name,
          inventoryItem: item.parentIngredient.inventoryItem ? {
            ...item.parentIngredient.inventoryItem,
            costPerUnit: Number(item.parentIngredient.inventoryItem.costPerUnit),
          } : null,
        } : null,
        trayConfigs: (trayConfigsByIngredient[item.id] || []).map(c => ({
          ...c,
          capacity: Number(c.capacity),
        })),
      })),
    })
  } catch (error) {
    console.error('Tray configs list error:', error)
    return NextResponse.json({ error: 'Failed to fetch tray configs' }, { status: 500 })
  }
})

// POST - Create a new tray config
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      prepItemId, // This is actually the ingredient ID
      name,
      capacity,
      description,
      sortOrder,
    } = body

    if (!locationId || !prepItemId || !name || capacity === undefined) {
      return NextResponse.json({
        error: 'Location ID, prep item ID, name, and capacity required',
      }, { status: 400 })
    }

    // Verify ingredient exists and belongs to this location (ingredients with preparationType are "prep items")
    const ingredient = await db.ingredient.findFirst({
      where: { id: prepItemId, locationId, deletedAt: null },
    })

    if (!ingredient) {
      return NextResponse.json({ error: 'Prep item not found' }, { status: 404 })
    }

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.prepTrayConfig.aggregate({
        where: { prepItemId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    const config = await db.prepTrayConfig.create({
      data: {
        locationId,
        prepItemId, // Store ingredient ID in prepItemId field
        name,
        capacity: Number(capacity),
        description,
        sortOrder: finalSortOrder,
      },
    })

    return NextResponse.json({
      data: {
        ...config,
        capacity: Number(config.capacity),
      },
    })
  } catch (error) {
    console.error('Create tray config error:', error)
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A tray config with this name already exists for this prep item' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Failed to create tray config' }, { status: 500 })
  }
})

// PUT - Toggle isDailyCountItem on an ingredient
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientId, isDailyCountItem } = body

    if (!ingredientId || isDailyCountItem === undefined) {
      return NextResponse.json({ error: 'Ingredient ID and isDailyCountItem required' }, { status: 400 })
    }

    const ingredient = await db.ingredient.update({
      where: { id: ingredientId },
      data: { isDailyCountItem },
    })

    return NextResponse.json({
      data: {
        id: ingredient.id,
        name: ingredient.name,
        isDailyCountItem: ingredient.isDailyCountItem,
      },
    })
  } catch (error) {
    console.error('Toggle daily count error:', error)
    return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
  }
})

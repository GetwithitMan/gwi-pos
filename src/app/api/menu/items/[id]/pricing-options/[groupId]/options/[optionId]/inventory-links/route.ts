import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { getLocationId } from '@/lib/location-cache'

// GET list all inventory links for a pricing option
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId } = await params

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify the pricing option belongs to this group, item, and location
    const option = await db.pricingOption.findFirst({
      where: {
        id: optionId,
        groupId,
        locationId,
        deletedAt: null,
        group: { menuItemId, deletedAt: null },
      },
      select: { id: true },
    })
    if (!option) {
      return NextResponse.json(
        { error: 'Pricing option not found' },
        { status: 404 }
      )
    }

    const links = await db.pricingOptionInventoryLink.findMany({
      where: {
        pricingOptionId: optionId,
        locationId,
        deletedAt: null,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            storageUnit: true,
            costPerUnit: true,
          },
        },
        prepItem: {
          select: {
            id: true,
            name: true,
            outputUnit: true,
            costPerUnit: true,
          },
        },
        ingredient: {
          select: {
            id: true,
            name: true,
            standardUnit: true,
            outputUnit: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({
      data: links.map((link) => ({
        id: link.id,
        pricingOptionId: link.pricingOptionId,
        inventoryItemId: link.inventoryItemId,
        prepItemId: link.prepItemId,
        ingredientId: link.ingredientId,
        usageQuantity: Number(link.usageQuantity),
        usageUnit: link.usageUnit,
        calculatedCost: link.calculatedCost != null ? Number(link.calculatedCost) : null,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
        inventoryItem: link.inventoryItem
          ? {
              id: link.inventoryItem.id,
              name: link.inventoryItem.name,
              unit: link.inventoryItem.storageUnit,
              costPerUnit: link.inventoryItem.costPerUnit != null ? Number(link.inventoryItem.costPerUnit) : null,
            }
          : null,
        prepItem: link.prepItem
          ? {
              id: link.prepItem.id,
              name: link.prepItem.name,
              unit: link.prepItem.outputUnit,
              costPerUnit: link.prepItem.costPerUnit != null ? Number(link.prepItem.costPerUnit) : null,
            }
          : null,
        ingredient: link.ingredient
          ? {
              id: link.ingredient.id,
              name: link.ingredient.name,
              unit: link.ingredient.outputUnit ?? link.ingredient.standardUnit,
            }
          : null,
      })),
    })
  } catch (error) {
    console.error('Failed to list inventory links:', error)
    return NextResponse.json(
      { error: 'Failed to list inventory links' },
      { status: 500 }
    )
  }
})

// POST create a new inventory link
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string; optionId: string }> }
) {
  try {
    const { id: menuItemId, groupId, optionId } = await params
    const body = await request.json()
    let { prepItemId, inventoryItemId, usageQuantity, usageUnit } = body
    const { ingredientId } = body

    // ingredientId can be stored directly (from IngredientHierarchyPicker)
    // Also try to resolve to prepItemId/inventoryItemId for cost calculation
    if (ingredientId && !prepItemId && !inventoryItemId) {
      const loc = await getLocationId()
      // Walk up parent chain to find an ancestor with prepItem/inventoryItem FK
      let currentId: string = ingredientId
      for (let depth = 0; depth < 5; depth++) {
        const ing = await db.ingredient.findFirst({
          where: { id: currentId, locationId: loc!, deletedAt: null },
          select: { prepItemId: true, inventoryItemId: true, parentIngredientId: true },
        })
        if (!ing) break
        if (ing.prepItemId) { prepItemId = ing.prepItemId; break }
        if (ing.inventoryItemId) { inventoryItemId = ing.inventoryItemId; break }
        if (!ing.parentIngredientId) break
        currentId = ing.parentIngredientId
      }
      // Even if no prepItem/inventoryItem found, ingredientId alone is valid
    }

    if (!prepItemId && !inventoryItemId && !ingredientId) {
      return NextResponse.json(
        { error: 'Either prepItemId, inventoryItemId, or ingredientId is required' },
        { status: 400 }
      )
    }

    if (usageQuantity == null || usageQuantity <= 0) {
      return NextResponse.json(
        { error: 'usageQuantity must be a positive number' },
        { status: 400 }
      )
    }

    if (!usageUnit?.trim()) {
      return NextResponse.json(
        { error: 'usageUnit is required' },
        { status: 400 }
      )
    }

    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Verify the pricing option belongs to this group, item, and location
    const option = await db.pricingOption.findFirst({
      where: {
        id: optionId,
        groupId,
        locationId,
        deletedAt: null,
        group: { menuItemId, deletedAt: null },
      },
      select: { id: true },
    })
    if (!option) {
      return NextResponse.json(
        { error: 'Pricing option not found' },
        { status: 404 }
      )
    }

    // Look up the linked item's costPerUnit to calculate cost
    let calculatedCost: number | null = null

    if (inventoryItemId) {
      const invItem = await db.inventoryItem.findFirst({
        where: { id: inventoryItemId, locationId, deletedAt: null },
        select: { costPerUnit: true },
      })
      if (!invItem) {
        return NextResponse.json(
          { error: 'Inventory item not found' },
          { status: 404 }
        )
      }
      if (invItem.costPerUnit != null) {
        calculatedCost = Number(invItem.costPerUnit) * Number(usageQuantity)
      }
    } else if (prepItemId) {
      const prep = await db.prepItem.findFirst({
        where: { id: prepItemId, locationId, deletedAt: null },
        select: { costPerUnit: true },
      })
      if (!prep) {
        return NextResponse.json(
          { error: 'Prep item not found' },
          { status: 404 }
        )
      }
      if (prep.costPerUnit != null) {
        calculatedCost = Number(prep.costPerUnit) * Number(usageQuantity)
      }
    }

    const link = await db.pricingOptionInventoryLink.create({
      data: {
        locationId,
        pricingOptionId: optionId,
        inventoryItemId: inventoryItemId ?? null,
        prepItemId: prepItemId ?? null,
        ingredientId: ingredientId ?? null,
        usageQuantity,
        usageUnit: usageUnit.trim(),
        calculatedCost,
      },
      include: {
        inventoryItem: {
          select: {
            id: true,
            name: true,
            storageUnit: true,
            costPerUnit: true,
          },
        },
        prepItem: {
          select: {
            id: true,
            name: true,
            outputUnit: true,
            costPerUnit: true,
          },
        },
        ingredient: {
          select: {
            id: true,
            name: true,
            standardUnit: true,
            outputUnit: true,
          },
        },
      },
    })

    // Invalidate menu cache
    invalidateMenuCache(locationId)

    // Fire-and-forget socket dispatch
    void dispatchMenuUpdate(locationId, {
      action: 'updated',
      menuItemId,
    }).catch(() => {})

    return NextResponse.json({
      data: {
        id: link.id,
        pricingOptionId: link.pricingOptionId,
        inventoryItemId: link.inventoryItemId,
        prepItemId: link.prepItemId,
        ingredientId: link.ingredientId,
        usageQuantity: Number(link.usageQuantity),
        usageUnit: link.usageUnit,
        calculatedCost: link.calculatedCost != null ? Number(link.calculatedCost) : null,
        createdAt: link.createdAt.toISOString(),
        updatedAt: link.updatedAt.toISOString(),
        inventoryItem: link.inventoryItem
          ? {
              id: link.inventoryItem.id,
              name: link.inventoryItem.name,
              unit: link.inventoryItem.storageUnit,
              costPerUnit: link.inventoryItem.costPerUnit != null ? Number(link.inventoryItem.costPerUnit) : null,
            }
          : null,
        prepItem: link.prepItem
          ? {
              id: link.prepItem.id,
              name: link.prepItem.name,
              unit: link.prepItem.outputUnit,
              costPerUnit: link.prepItem.costPerUnit != null ? Number(link.prepItem.costPerUnit) : null,
            }
          : null,
        ingredient: link.ingredient
          ? {
              id: link.ingredient.id,
              name: link.ingredient.name,
              unit: link.ingredient.outputUnit ?? link.ingredient.standardUnit,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('Failed to create inventory link:', error)
    return NextResponse.json(
      { error: 'Failed to create inventory link' },
      { status: 500 }
    )
  }
})

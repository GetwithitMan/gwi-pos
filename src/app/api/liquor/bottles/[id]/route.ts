import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

const ML_PER_OZ = 29.5735
const DEFAULT_POUR_SIZE_OZ = 1.5

/**
 * Calculate bottle metrics (pours per bottle and pour cost)
 */
function calculateBottleMetrics(
  bottleSizeMl: number,
  unitCost: number,
  pourSizeOz?: number | null
) {
  const effectivePourSizeOz = pourSizeOz || DEFAULT_POUR_SIZE_OZ
  const pourSizeMl = effectivePourSizeOz * ML_PER_OZ
  const poursPerBottle = Math.floor(bottleSizeMl / pourSizeMl)
  const pourCost = poursPerBottle > 0 ? unitCost / poursPerBottle : 0
  const bottleSizeOz = bottleSizeMl / ML_PER_OZ

  return {
    bottleSizeOz: Math.round(bottleSizeOz * 100) / 100,
    poursPerBottle,
    pourCost: Math.round(pourCost * 10000) / 10000, // 4 decimal places
  }
}

/**
 * GET /api/liquor/bottles/[id]
 * Get a single bottle product by ID
 */
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const bottle = await db.bottleProduct.findUnique({
      where: { id },
      include: {
        spiritCategory: {
          select: {
            id: true,
            name: true,
            categoryType: true,
            displayName: true,
          },
        },
        inventoryItem: {
          select: {
            id: true,
            currentStock: true,
          },
        },
        _count: {
          select: {
            spiritModifiers: true,
            recipeIngredients: true,
          },
        },
      },
    })

    if (!bottle) {
      return NextResponse.json(
        { error: 'Bottle not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: {
      id: bottle.id,
      name: bottle.name,
      brand: bottle.brand,
      displayName: bottle.displayName,
      spiritCategoryId: bottle.spiritCategoryId,
      spiritCategory: bottle.spiritCategory,
      tier: bottle.tier,
      bottleSizeMl: bottle.bottleSizeMl,
      bottleSizeOz: bottle.bottleSizeOz ? Number(bottle.bottleSizeOz) : null,
      unitCost: Number(bottle.unitCost),
      pourSizeOz: bottle.pourSizeOz ? Number(bottle.pourSizeOz) : null,
      poursPerBottle: bottle.poursPerBottle,
      pourCost: bottle.pourCost ? Number(bottle.pourCost) : null,
      containerType: bottle.containerType,
      alcoholSubtype: bottle.alcoholSubtype,
      vintage: bottle.vintage,
      currentStock: bottle.currentStock,
      lowStockAlert: bottle.lowStockAlert,
      isActive: bottle.isActive,
      inventoryItemId: bottle.inventoryItemId,
      inventoryStock: bottle.inventoryItem?.currentStock ? Number(bottle.inventoryItem.currentStock) : null,
      createdAt: bottle.createdAt,
      updatedAt: bottle.updatedAt,
      usageCount: {
        modifiers: bottle._count.spiritModifiers,
        recipes: bottle._count.recipeIngredients,
      },
    } })
  } catch (error) {
    console.error('Failed to fetch bottle:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bottle' },
      { status: 500 }
    )
  }
})

/**
 * PUT /api/liquor/bottles/[id]
 * Update a bottle product (recalculates metrics if relevant fields change)
 * Also syncs changes to the linked InventoryItem
 */
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      name,
      brand,
      displayName,
      spiritCategoryId,
      tier,
      bottleSizeMl,
      unitCost,
      pourSizeOz,
      currentStock,
      lowStockAlert,
      isActive,
      containerType,
      alcoholSubtype,
      vintage,
      needsVerification,
      verifiedAt,
      verifiedBy,
      sortOrder,
    } = body

    // Get existing bottle to check if metrics need recalculation
    const existing = await db.bottleProduct.findUnique({
      where: { id },
      include: {
        spiritCategory: { select: { name: true } },
      },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Bottle not found' },
        { status: 404 }
      )
    }

    // Validate tier if provided
    if (tier !== undefined && !['well', 'call', 'premium', 'top_shelf'].includes(tier)) {
      return NextResponse.json(
        { error: 'Invalid tier (well, call, premium, top_shelf)' },
        { status: 400 }
      )
    }

    // Validate spiritCategoryId if provided and get category name
    let newCategoryName = existing.spiritCategory?.name
    if (spiritCategoryId !== undefined) {
      const category = await db.spiritCategory.findUnique({
        where: { id: spiritCategoryId },
        select: { name: true },
      })
      if (!category) {
        return NextResponse.json(
          { error: 'Spirit category not found' },
          { status: 400 }
        )
      }
      newCategoryName = category.name
    }

    // Determine if we need to recalculate metrics
    const newBottleSizeMl = bottleSizeMl ?? existing.bottleSizeMl
    const newUnitCost = unitCost ?? Number(existing.unitCost)
    const newPourSizeOz = pourSizeOz !== undefined
      ? pourSizeOz
      : (existing.pourSizeOz ? Number(existing.pourSizeOz) : null)

    const needsRecalc =
      bottleSizeMl !== undefined ||
      unitCost !== undefined ||
      pourSizeOz !== undefined

    let metricsUpdate: { bottleSizeOz?: number; poursPerBottle?: number; pourCost?: number } = {}
    if (needsRecalc) {
      const metrics = calculateBottleMetrics(newBottleSizeMl, newUnitCost, newPourSizeOz)
      metricsUpdate = {
        bottleSizeOz: metrics.bottleSizeOz,
        poursPerBottle: metrics.poursPerBottle,
        pourCost: metrics.pourCost,
      }
    }

    // Use transaction to update both BottleProduct and InventoryItem
    const bottle = await db.$transaction(async (tx) => {
      // Update the BottleProduct
      const updatedBottle = await tx.bottleProduct.update({
        where: { id },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(brand !== undefined && { brand: brand?.trim() || null }),
          ...(displayName !== undefined && { displayName: displayName?.trim() || null }),
          ...(spiritCategoryId !== undefined && { spiritCategoryId }),
          ...(tier !== undefined && { tier }),
          ...(bottleSizeMl !== undefined && { bottleSizeMl }),
          ...(unitCost !== undefined && { unitCost }),
          ...(pourSizeOz !== undefined && { pourSizeOz: pourSizeOz || null }),
          ...(currentStock !== undefined && { currentStock }),
          ...(lowStockAlert !== undefined && { lowStockAlert: lowStockAlert || null }),
          ...(isActive !== undefined && { isActive }),
          ...(containerType !== undefined && { containerType }),
          ...(alcoholSubtype !== undefined && { alcoholSubtype: alcoholSubtype || null }),
          ...(vintage !== undefined && { vintage: vintage || null }),
          ...(sortOrder !== undefined && { sortOrder }),
          ...(needsVerification !== undefined && { needsVerification }),
          ...(verifiedAt !== undefined && { verifiedAt: verifiedAt ? new Date(verifiedAt) : null }),
          ...(verifiedBy !== undefined && { verifiedBy: verifiedBy || null }),
          ...metricsUpdate,
        },
        include: {
          spiritCategory: {
            select: {
              id: true,
              name: true,
              displayName: true,
            },
          },
        },
      })

      // Sync relevant changes to linked InventoryItem
      if (existing.inventoryItemId) {
        const bottleSizeOzFinal = metricsUpdate.bottleSizeOz ?? (existing.bottleSizeOz ? Number(existing.bottleSizeOz) : 25.36)
        const pourCostFinal = metricsUpdate.pourCost ?? (existing.pourCost ? Number(existing.pourCost) : 0)

        const inventoryUpdate: Record<string, unknown> = {}

        if (name !== undefined) inventoryUpdate.name = name.trim()
        if (brand !== undefined) inventoryUpdate.brand = brand?.trim() || null
        if (displayName !== undefined) {
          inventoryUpdate.description = displayName?.trim() || `${brand || ''} ${name}`.trim()
        }
        if (spiritCategoryId !== undefined) {
          inventoryUpdate.spiritCategoryId = spiritCategoryId
          inventoryUpdate.category = newCategoryName?.toLowerCase()
        }
        if (tier !== undefined) inventoryUpdate.subcategory = tier
        if (unitCost !== undefined) inventoryUpdate.purchaseCost = unitCost
        if (needsRecalc) {
          inventoryUpdate.unitsPerPurchase = bottleSizeOzFinal
          inventoryUpdate.costPerUnit = pourCostFinal
        }
        if (pourSizeOz !== undefined) inventoryUpdate.pourSizeOz = pourSizeOz || DEFAULT_POUR_SIZE_OZ
        if (currentStock !== undefined) {
          // Convert bottles to oz for inventory stock
          inventoryUpdate.currentStock = currentStock * bottleSizeOzFinal
        }
        if (lowStockAlert !== undefined) {
          inventoryUpdate.parLevel = lowStockAlert ? lowStockAlert * bottleSizeOzFinal : null
        }
        if (isActive !== undefined) inventoryUpdate.isActive = isActive

        if (Object.keys(inventoryUpdate).length > 0) {
          await tx.inventoryItem.update({
            where: { id: existing.inventoryItemId },
            data: inventoryUpdate,
          })
        }
      }

      return updatedBottle
    })

    // Real-time cross-terminal update
    void dispatchMenuUpdate(existing.locationId, {
      action: 'updated',
      bottleId: id,
      name: bottle.name,
    }).catch(() => {})

    return NextResponse.json({ data: {
      id: bottle.id,
      name: bottle.name,
      brand: bottle.brand,
      displayName: bottle.displayName,
      spiritCategoryId: bottle.spiritCategoryId,
      spiritCategory: bottle.spiritCategory,
      tier: bottle.tier,
      bottleSizeMl: bottle.bottleSizeMl,
      bottleSizeOz: bottle.bottleSizeOz ? Number(bottle.bottleSizeOz) : null,
      unitCost: Number(bottle.unitCost),
      pourSizeOz: bottle.pourSizeOz ? Number(bottle.pourSizeOz) : null,
      poursPerBottle: bottle.poursPerBottle,
      pourCost: bottle.pourCost ? Number(bottle.pourCost) : null,
      containerType: bottle.containerType,
      alcoholSubtype: bottle.alcoholSubtype,
      vintage: bottle.vintage,
      currentStock: bottle.currentStock,
      lowStockAlert: bottle.lowStockAlert,
      isActive: bottle.isActive,
      sortOrder: bottle.sortOrder,
      needsVerification: bottle.needsVerification,
      verifiedAt: bottle.verifiedAt,
      verifiedBy: bottle.verifiedBy,
      inventoryItemId: existing.inventoryItemId,
      createdAt: bottle.createdAt,
      updatedAt: bottle.updatedAt,
    } })
  } catch (error) {
    console.error('Failed to update bottle:', error)
    return NextResponse.json(
      { error: 'Failed to update bottle' },
      { status: 500 }
    )
  }
})

/**
 * DELETE /api/liquor/bottles/[id]
 * Soft-delete a bottle product (only if not used in modifiers or recipes)
 * Also soft-deletes the linked InventoryItem
 */
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if bottle is used in any modifiers or recipes
    const bottle = await db.bottleProduct.findUnique({
      where: { id },
      select: {
        inventoryItemId: true,
        _count: {
          select: {
            spiritModifiers: true,
            recipeIngredients: true,
          },
        },
      },
    })

    if (!bottle) {
      return NextResponse.json(
        { error: 'Bottle not found' },
        { status: 404 }
      )
    }

    if (bottle._count.spiritModifiers > 0 || bottle._count.recipeIngredients > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete bottle that is used in modifiers or recipes',
          usage: {
            modifiers: bottle._count.spiritModifiers,
            recipes: bottle._count.recipeIngredients,
          },
        },
        { status: 400 }
      )
    }

    // Soft-delete both BottleProduct and linked InventoryItem
    await db.$transaction(async (tx) => {
      // Soft-delete the bottle
      await tx.bottleProduct.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      // Soft-delete linked inventory item
      if (bottle.inventoryItemId) {
        await tx.inventoryItem.update({
          where: { id: bottle.inventoryItemId },
          data: { deletedAt: new Date() },
        })
      }
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete bottle:', error)
    return NextResponse.json(
      { error: 'Failed to delete bottle' },
      { status: 500 }
    )
  }
})

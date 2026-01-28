import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
export async function GET(
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
            displayName: true,
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

    return NextResponse.json({
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
      currentStock: bottle.currentStock,
      lowStockAlert: bottle.lowStockAlert,
      isActive: bottle.isActive,
      createdAt: bottle.createdAt,
      updatedAt: bottle.updatedAt,
      usageCount: {
        modifiers: bottle._count.spiritModifiers,
        recipes: bottle._count.recipeIngredients,
      },
    })
  } catch (error) {
    console.error('Failed to fetch bottle:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bottle' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/liquor/bottles/[id]
 * Update a bottle product (recalculates metrics if relevant fields change)
 */
export async function PUT(
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
    } = body

    // Get existing bottle to check if metrics need recalculation
    const existing = await db.bottleProduct.findUnique({
      where: { id },
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

    // Validate spiritCategoryId if provided
    if (spiritCategoryId !== undefined) {
      const categoryExists = await db.spiritCategory.findUnique({
        where: { id: spiritCategoryId },
      })
      if (!categoryExists) {
        return NextResponse.json(
          { error: 'Spirit category not found' },
          { status: 400 }
        )
      }
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

    let metricsUpdate = {}
    if (needsRecalc) {
      const metrics = calculateBottleMetrics(newBottleSizeMl, newUnitCost, newPourSizeOz)
      metricsUpdate = {
        bottleSizeOz: metrics.bottleSizeOz,
        poursPerBottle: metrics.poursPerBottle,
        pourCost: metrics.pourCost,
      }
    }

    const bottle = await db.bottleProduct.update({
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

    return NextResponse.json({
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
      currentStock: bottle.currentStock,
      lowStockAlert: bottle.lowStockAlert,
      isActive: bottle.isActive,
      createdAt: bottle.createdAt,
      updatedAt: bottle.updatedAt,
    })
  } catch (error) {
    console.error('Failed to update bottle:', error)
    return NextResponse.json(
      { error: 'Failed to update bottle' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/liquor/bottles/[id]
 * Delete a bottle product (only if not used in modifiers or recipes)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if bottle is used in any modifiers or recipes
    const usage = await db.bottleProduct.findUnique({
      where: { id },
      select: {
        _count: {
          select: {
            spiritModifiers: true,
            recipeIngredients: true,
          },
        },
      },
    })

    if (!usage) {
      return NextResponse.json(
        { error: 'Bottle not found' },
        { status: 404 }
      )
    }

    if (usage._count.spiritModifiers > 0 || usage._count.recipeIngredients > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete bottle that is used in modifiers or recipes',
          usage: {
            modifiers: usage._count.spiritModifiers,
            recipes: usage._count.recipeIngredients,
          },
        },
        { status: 400 }
      )
    }

    await db.bottleProduct.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete bottle:', error)
    return NextResponse.json(
      { error: 'Failed to delete bottle' },
      { status: 500 }
    )
  }
}

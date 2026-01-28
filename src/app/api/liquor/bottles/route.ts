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
 * GET /api/liquor/bottles
 * List all bottle products for the location
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tier = searchParams.get('tier')
    const spiritCategoryId = searchParams.get('spiritCategoryId')
    const isActive = searchParams.get('isActive')

    // Get the location (for now using first location)
    const location = await db.location.findFirst()
    if (!location) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const bottles = await db.bottleProduct.findMany({
      where: {
        locationId: location.id,
        ...(tier && { tier }),
        ...(spiritCategoryId && { spiritCategoryId }),
        ...(isActive !== null && { isActive: isActive === 'true' }),
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
      orderBy: [
        { spiritCategory: { sortOrder: 'asc' } },
        { tier: 'asc' },
        { name: 'asc' },
      ],
    })

    return NextResponse.json(
      bottles.map((bottle) => ({
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
      }))
    )
  } catch (error) {
    console.error('Failed to fetch bottles:', error)
    return NextResponse.json(
      { error: 'Failed to fetch bottles' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/liquor/bottles
 * Create a new bottle product with auto-calculated metrics
 */
export async function POST(request: NextRequest) {
  try {
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
    } = body

    // Validation
    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (!spiritCategoryId) {
      return NextResponse.json(
        { error: 'Spirit category is required' },
        { status: 400 }
      )
    }

    if (!tier || !['well', 'call', 'premium', 'top_shelf'].includes(tier)) {
      return NextResponse.json(
        { error: 'Valid tier is required (well, call, premium, top_shelf)' },
        { status: 400 }
      )
    }

    if (!bottleSizeMl || bottleSizeMl <= 0) {
      return NextResponse.json(
        { error: 'Valid bottle size (mL) is required' },
        { status: 400 }
      )
    }

    if (unitCost === undefined || unitCost < 0) {
      return NextResponse.json(
        { error: 'Valid unit cost is required' },
        { status: 400 }
      )
    }

    // Verify spirit category exists and get location
    const spiritCategory = await db.spiritCategory.findUnique({
      where: { id: spiritCategoryId },
      select: { id: true, locationId: true },
    })

    if (!spiritCategory) {
      return NextResponse.json(
        { error: 'Spirit category not found' },
        { status: 400 }
      )
    }

    // Calculate bottle metrics
    const metrics = calculateBottleMetrics(bottleSizeMl, unitCost, pourSizeOz)

    const bottle = await db.bottleProduct.create({
      data: {
        locationId: spiritCategory.locationId,
        name: name.trim(),
        brand: brand?.trim() || null,
        displayName: displayName?.trim() || null,
        spiritCategoryId,
        tier,
        bottleSizeMl,
        bottleSizeOz: metrics.bottleSizeOz,
        unitCost,
        pourSizeOz: pourSizeOz || null,
        poursPerBottle: metrics.poursPerBottle,
        pourCost: metrics.pourCost,
        currentStock: currentStock || 0,
        lowStockAlert: lowStockAlert || null,
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
    console.error('Failed to create bottle:', error)
    return NextResponse.json(
      { error: 'Failed to create bottle' },
      { status: 500 }
    )
  }
}

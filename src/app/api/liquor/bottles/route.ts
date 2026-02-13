import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
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
 * GET /api/liquor/bottles
 * List all bottle products for the location
 */
export const GET = withVenue(async function GET(request: NextRequest) {
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
        deletedAt: null,
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
        inventoryItem: {
          select: {
            id: true,
            currentStock: true,
          },
        },
        linkedMenuItems: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
            sortOrder: true,
            category: {
              select: {
                id: true,
                name: true,
              },
            },
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
        inventoryItemId: bottle.inventoryItemId,
        inventoryStock: bottle.inventoryItem?.currentStock ? Number(bottle.inventoryItem.currentStock) : null,
        linkedMenuItems: bottle.linkedMenuItems.map((item) => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          isActive: item.isActive,
          sortOrder: item.sortOrder,
          category: item.category,
        })),
        hasMenuItem: bottle.linkedMenuItems.length > 0,
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
})

/**
 * POST /api/liquor/bottles
 * Create a new bottle product with auto-calculated metrics
 * Also creates a linked InventoryItem for unified stock tracking
 */
export const POST = withVenue(async function POST(request: NextRequest) {
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

    // Verify spirit category exists and get location + category name
    const spiritCategory = await db.spiritCategory.findUnique({
      where: { id: spiritCategoryId },
      select: { id: true, locationId: true, name: true },
    })

    if (!spiritCategory) {
      return NextResponse.json(
        { error: 'Spirit category not found' },
        { status: 400 }
      )
    }

    // Calculate bottle metrics
    const metrics = calculateBottleMetrics(bottleSizeMl, unitCost, pourSizeOz)

    // Use transaction to create both InventoryItem and BottleProduct atomically
    const result = await db.$transaction(async (tx) => {
      // Create InventoryItem for unified stock tracking
      const inventoryItem = await tx.inventoryItem.create({
        data: {
          locationId: spiritCategory.locationId,
          name: name.trim(),
          description: displayName?.trim() || `${brand || ''} ${name}`.trim(),

          // Classification for COGS reporting
          department: 'Beverage',
          itemType: 'liquor',
          revenueCenter: 'bar',
          category: spiritCategory.name.toLowerCase(), // whiskey, vodka, etc.
          subcategory: tier, // well, call, premium, top_shelf
          brand: brand?.trim() || null,

          // Purchase info (bottle-based)
          purchaseUnit: 'bottle',
          purchaseSize: 1,
          purchaseCost: unitCost,

          // Storage/usage in ounces for pour tracking
          storageUnit: 'oz',
          unitsPerPurchase: metrics.bottleSizeOz,
          costPerUnit: metrics.pourCost, // Cost per oz

          // For liquor items
          spiritCategoryId,
          pourSizeOz: pourSizeOz || DEFAULT_POUR_SIZE_OZ,

          // Inventory levels (in bottles for par, but tracked in oz)
          currentStock: (currentStock || 0) * metrics.bottleSizeOz, // Convert bottles to oz
          parLevel: lowStockAlert ? lowStockAlert * metrics.bottleSizeOz : null,

          isActive: true,
          trackInventory: true,
        },
      })

      // Create BottleProduct linked to the InventoryItem
      const bottle = await tx.bottleProduct.create({
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
          inventoryItemId: inventoryItem.id,
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

      return { bottle, inventoryItemId: inventoryItem.id }
    })

    return NextResponse.json({
      id: result.bottle.id,
      name: result.bottle.name,
      brand: result.bottle.brand,
      displayName: result.bottle.displayName,
      spiritCategoryId: result.bottle.spiritCategoryId,
      spiritCategory: result.bottle.spiritCategory,
      tier: result.bottle.tier,
      bottleSizeMl: result.bottle.bottleSizeMl,
      bottleSizeOz: result.bottle.bottleSizeOz ? Number(result.bottle.bottleSizeOz) : null,
      unitCost: Number(result.bottle.unitCost),
      pourSizeOz: result.bottle.pourSizeOz ? Number(result.bottle.pourSizeOz) : null,
      poursPerBottle: result.bottle.poursPerBottle,
      pourCost: result.bottle.pourCost ? Number(result.bottle.pourCost) : null,
      currentStock: result.bottle.currentStock,
      lowStockAlert: result.bottle.lowStockAlert,
      isActive: result.bottle.isActive,
      inventoryItemId: result.inventoryItemId,
      createdAt: result.bottle.createdAt,
      updatedAt: result.bottle.updatedAt,
    })
  } catch (error) {
    console.error('Failed to create bottle:', error)
    return NextResponse.json(
      { error: 'Failed to create bottle' },
      { status: 500 }
    )
  }
})

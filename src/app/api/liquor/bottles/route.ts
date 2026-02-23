import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

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

    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    const bottles = await db.bottleProduct.findMany({
      where: {
        locationId,
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
            categoryType: true,
            displayName: true,
          },
        },
        inventoryItem: {
          select: {
            id: true,
            name: true,
            currentStock: true,
            storageUnit: true,
            costPerUnit: true,
            parLevel: true,
            // Prep items that use this inventory item
            prepItemInputs: {
              include: {
                prepItem: {
                  select: {
                    id: true,
                    name: true,
                    outputUnit: true,
                    batchYield: true,
                    costPerUnit: true,
                    currentPrepStock: true,
                    isDailyCountItem: true,
                    isActive: true,
                  },
                },
              },
            },
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
        { sortOrder: 'asc' },
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
        inventoryItemId: bottle.inventoryItemId,
        inventoryStock: bottle.inventoryItem?.currentStock ? Number(bottle.inventoryItem.currentStock) : null,
        inventoryItem: bottle.inventoryItem ? {
          id: bottle.inventoryItem.id,
          name: bottle.inventoryItem.name,
          currentStock: Number(bottle.inventoryItem.currentStock),
          storageUnit: bottle.inventoryItem.storageUnit,
          costPerUnit: Number(bottle.inventoryItem.costPerUnit),
          parLevel: bottle.inventoryItem.parLevel ? Number(bottle.inventoryItem.parLevel) : null,
          prepItems: bottle.inventoryItem.prepItemInputs.map((pi: any) => ({
            id: pi.prepItem.id,
            name: pi.prepItem.name,
            outputUnit: pi.prepItem.outputUnit,
            batchYield: Number(pi.prepItem.batchYield),
            costPerUnit: pi.prepItem.costPerUnit ? Number(pi.prepItem.costPerUnit) : null,
            currentPrepStock: Number(pi.prepItem.currentPrepStock),
            isDailyCountItem: pi.prepItem.isDailyCountItem,
            isActive: pi.prepItem.isActive,
          })),
        } : null,
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
      containerType,
      alcoholSubtype,
      vintage,
      needsVerification,
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

    // Check if a related bottle already has an InventoryItem (same brand + category = same product)
    // This enables multiple bottle sizes (750mL + 1.75L) to share one unified inventory
    let existingInventoryItemId: string | null = null
    if (brand?.trim()) {
      const relatedBottle = await db.bottleProduct.findFirst({
        where: {
          locationId: spiritCategory.locationId,
          brand: brand.trim(),
          spiritCategoryId,
          inventoryItemId: { not: null },
          deletedAt: null,
        },
        select: { inventoryItemId: true },
      })
      existingInventoryItemId = relatedBottle?.inventoryItemId || null
    }

    // Use transaction to create both InventoryItem and BottleProduct atomically
    const result = await db.$transaction(async (tx) => {
      // Reuse existing InventoryItem for variant bottles, or create a new one
      const inventoryItemId = existingInventoryItemId || (await tx.inventoryItem.create({
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
      })).id

      // Auto-assign sortOrder
      const maxSort = await tx.bottleProduct.aggregate({
        _max: { sortOrder: true },
        where: { locationId: spiritCategory.locationId, spiritCategoryId, deletedAt: null },
      })
      const nextSort = (maxSort._max.sortOrder ?? -1) + 1

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
          containerType: containerType || 'bottle',
          alcoholSubtype: alcoholSubtype || null,
          vintage: vintage || null,
          inventoryItemId,
          sortOrder: nextSort,
          needsVerification: needsVerification ?? false,
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

      return { bottle, inventoryItemId }
    })

    // Real-time cross-terminal update
    void dispatchMenuUpdate(spiritCategory.locationId, {
      action: 'created',
      bottleId: result.bottle.id,
      name: result.bottle.name,
    }).catch(() => {})

    return NextResponse.json({ data: {
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
      containerType: result.bottle.containerType,
      alcoholSubtype: result.bottle.alcoholSubtype,
      vintage: result.bottle.vintage,
      currentStock: result.bottle.currentStock,
      lowStockAlert: result.bottle.lowStockAlert,
      isActive: result.bottle.isActive,
      sortOrder: result.bottle.sortOrder,
      needsVerification: result.bottle.needsVerification,
      verifiedAt: result.bottle.verifiedAt,
      verifiedBy: result.bottle.verifiedBy,
      inventoryItemId: result.inventoryItemId,
      createdAt: result.bottle.createdAt,
      updatedAt: result.bottle.updatedAt,
    } })
  } catch (error) {
    console.error('Failed to create bottle:', error)
    return NextResponse.json(
      { error: 'Failed to create bottle' },
      { status: 500 }
    )
  }
})

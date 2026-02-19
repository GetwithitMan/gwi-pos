import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
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
 * POST /api/liquor/bottles/sync-inventory
 *
 * Finds all BottleProduct records without a linked InventoryItem
 * and creates corresponding InventoryItem records, then updates
 * the BottleProduct to link to the new InventoryItem.
 *
 * This is useful for syncing old bottles created before the
 * inventory integration was added.
 */
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Find all bottles without an inventoryItemId
    const bottlesWithoutInventory = await db.bottleProduct.findMany({
      where: {
        locationId,
        deletedAt: null,
        inventoryItemId: null,
      },
      include: {
        spiritCategory: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    if (bottlesWithoutInventory.length === 0) {
      return NextResponse.json({ data: {
        message: 'All bottles already have linked inventory items',
        synced: 0,
        bottles: [],
      } })
    }

    // Process each bottle and create inventory items
    const results: Array<{
      bottleId: string
      bottleName: string
      inventoryItemId: string
      status: 'created' | 'error'
      error?: string
    }> = []

    for (const bottle of bottlesWithoutInventory) {
      try {
        // Calculate metrics
        const metrics = calculateBottleMetrics(
          bottle.bottleSizeMl,
          Number(bottle.unitCost),
          bottle.pourSizeOz ? Number(bottle.pourSizeOz) : null
        )

        // Use transaction to create InventoryItem and update BottleProduct
        const result = await db.$transaction(async (tx) => {
          // Create InventoryItem for unified stock tracking
          const inventoryItem = await tx.inventoryItem.create({
            data: {
              locationId: bottle.locationId,
              name: bottle.name,
              description: bottle.displayName || `${bottle.brand || ''} ${bottle.name}`.trim(),

              // Classification for COGS reporting
              department: 'Beverage',
              itemType: 'liquor',
              revenueCenter: 'bar',
              category: bottle.spiritCategory.name.toLowerCase(), // whiskey, vodka, etc.
              subcategory: bottle.tier, // well, call, premium, top_shelf
              brand: bottle.brand || null,

              // Purchase info (bottle-based)
              purchaseUnit: 'bottle',
              purchaseSize: 1,
              purchaseCost: Number(bottle.unitCost),

              // Storage/usage in ounces for pour tracking
              storageUnit: 'oz',
              unitsPerPurchase: metrics.bottleSizeOz,
              costPerUnit: metrics.pourCost, // Cost per oz (approximation)

              // For liquor items
              spiritCategoryId: bottle.spiritCategoryId,
              pourSizeOz: bottle.pourSizeOz ? Number(bottle.pourSizeOz) : DEFAULT_POUR_SIZE_OZ,

              // Inventory levels (in oz)
              currentStock: bottle.currentStock * metrics.bottleSizeOz, // Convert bottles to oz
              parLevel: bottle.lowStockAlert ? bottle.lowStockAlert * metrics.bottleSizeOz : null,

              isActive: bottle.isActive,
              trackInventory: true,
            },
          })

          // Update BottleProduct to link to the InventoryItem
          await tx.bottleProduct.update({
            where: { id: bottle.id },
            data: {
              inventoryItemId: inventoryItem.id,
              // Also update calculated fields if not set
              bottleSizeOz: metrics.bottleSizeOz,
              poursPerBottle: metrics.poursPerBottle,
              pourCost: metrics.pourCost,
            },
          })

          return inventoryItem
        })

        results.push({
          bottleId: bottle.id,
          bottleName: bottle.name,
          inventoryItemId: result.id,
          status: 'created',
        })
      } catch (error) {
        console.error(`Failed to sync bottle ${bottle.name}:`, error)
        results.push({
          bottleId: bottle.id,
          bottleName: bottle.name,
          inventoryItemId: '',
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    const synced = results.filter(r => r.status === 'created').length
    const errors = results.filter(r => r.status === 'error').length

    // Real-time cross-terminal update
    if (synced > 0 && locationId) {
      void emitToLocation(locationId, 'inventory:changed', { action: 'liquor-sync' }).catch(() => {})
    }

    return NextResponse.json({ data: {
      message: `Synced ${synced} bottles to inventory${errors > 0 ? `, ${errors} errors` : ''}`,
      synced,
      errors,
      bottles: results,
    } })
  } catch (error) {
    console.error('Failed to sync inventory:', error)
    return NextResponse.json(
      { error: 'Failed to sync inventory' },
      { status: 500 }
    )
  }
})

/**
 * GET /api/liquor/bottles/sync-inventory
 *
 * Returns count of bottles that need syncing (no inventory link)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    // Get the location
    const locationId = await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Count bottles without inventory link
    const count = await db.bottleProduct.count({
      where: {
        locationId,
        deletedAt: null,
        inventoryItemId: null,
      },
    })

    // Get total bottles count
    const total = await db.bottleProduct.count({
      where: {
        locationId,
        deletedAt: null,
      },
    })

    return NextResponse.json({ data: {
      needsSync: count,
      total,
      synced: total - count,
      message: count > 0
        ? `${count} bottles need to be synced to inventory`
        : 'All bottles are synced to inventory',
    } })
  } catch (error) {
    console.error('Failed to check sync status:', error)
    return NextResponse.json(
      { error: 'Failed to check sync status' },
      { status: 500 }
    )
  }
})

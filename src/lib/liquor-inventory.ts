import { db } from '@/lib/db'
import { getLocationId } from '@/lib/location-cache'

interface InventoryDeduction {
  bottleProductId: string
  bottleProductName: string
  pourCount: number
  pourCost: number
  wasSubstituted: boolean
  originalBottleId?: string
  spiritTier?: string
}

interface ProcessedItem {
  orderItemId: string
  menuItemName: string
  deductions: InventoryDeduction[]
  totalCost: number
}

/**
 * Process liquor inventory deductions when an order is paid
 * - Gets recipe ingredients for each liquor item
 * - Checks for spirit substitutions from modifiers
 * - Deducts pours from bottle stock
 * - Creates inventory transactions
 */
export async function processLiquorInventory(
  orderId: string,
  employeeId?: string | null
): Promise<{ processed: ProcessedItem[]; totalCost: number }> {
  const results: ProcessedItem[] = []
  let totalCost = 0

  try {
    // Get all order items with their modifiers
    const orderItems = await db.orderItem.findMany({
      where: {
        orderId,
        status: 'active', // Only process active items (not voided/comped)
      },
      include: {
        menuItem: {
          include: {
            recipeIngredients: {
              include: {
                bottleProduct: true,
              },
            },
            category: {
              select: { categoryType: true },
            },
          },
        },
        modifiers: {
          where: {
            linkedBottleProductId: { not: null },
          },
        },
      },
    })

    // Batch: collect all linked bottle IDs across all order items' modifiers
    const allLinkedBottleIds = orderItems
      .flatMap(oi => oi.modifiers)
      .map(m => m.linkedBottleProductId)
      .filter((id): id is string => id !== null)

    // Batch: collect all recipe bottle IDs
    const allRecipeBottleIds = orderItems
      .flatMap(oi => oi.menuItem.recipeIngredients || [])
      .filter(ri => ri.bottleProduct)
      .map(ri => ri.bottleProduct!.id)

    const allBottleIds = [...new Set([...allLinkedBottleIds, ...allRecipeBottleIds])]

    // Single batch fetch for ALL bottles we might need (substitutions + recipes)
    const allBottles = allBottleIds.length > 0
      ? await db.bottleProduct.findMany({
          where: { id: { in: allBottleIds } },
        })
      : []
    const allBottleMap = new Map(allBottles.map(b => [b.id, b]))

    for (const orderItem of orderItems) {
      // Skip non-liquor items or items without recipes
      if (
        orderItem.menuItem.category?.categoryType !== 'liquor' ||
        !orderItem.menuItem.recipeIngredients ||
        orderItem.menuItem.recipeIngredients.length === 0
      ) {
        continue
      }

      const itemDeductions: InventoryDeduction[] = []
      let itemCost = 0

      // Create a map of spirit substitutions from modifiers
      // Key: spiritCategoryId, Value: linkedBottleProductId
      const spiritSubstitutions = new Map<string, string>()
      for (const mod of orderItem.modifiers) {
        if (mod.linkedBottleProductId) {
          // Use batch-loaded map instead of individual query
          const bottle = allBottleMap.get(mod.linkedBottleProductId)
          if (bottle) {
            spiritSubstitutions.set(bottle.spiritCategoryId, mod.linkedBottleProductId)
          }
        }
      }

      // Process each recipe ingredient (spirit ingredients only for liquor deduction)
      for (const ingredient of orderItem.menuItem.recipeIngredients) {
        const defaultBottle = ingredient.bottleProduct
        if (!defaultBottle) continue // Skip food ingredients

        let actualBottleId = defaultBottle.id
        let wasSubstituted = false

        // Check if this ingredient was substituted
        if (ingredient.isSubstitutable) {
          const substitutedBottleId = spiritSubstitutions.get(defaultBottle.spiritCategoryId)
          if (substitutedBottleId && substitutedBottleId !== defaultBottle.id) {
            actualBottleId = substitutedBottleId
            wasSubstituted = true
          }
        }

        // Use batch-loaded map instead of individual query
        const actualBottle = wasSubstituted
          ? allBottleMap.get(actualBottleId) || null
          : defaultBottle

        if (!actualBottle) continue

        const pourMultiplier = orderItem.pourMultiplier ? Number(orderItem.pourMultiplier) : 1.0
        const pourCount = Number(ingredient.pourCount) * orderItem.quantity * pourMultiplier
        const pourCost = actualBottle.pourCost ? Number(actualBottle.pourCost) * pourCount : 0

        itemDeductions.push({
          bottleProductId: actualBottle.id,
          bottleProductName: actualBottle.name,
          pourCount,
          pourCost,
          wasSubstituted,
          originalBottleId: wasSubstituted ? defaultBottle.id : undefined,
          spiritTier: actualBottle.tier,
        })

        itemCost += pourCost
      }

      if (itemDeductions.length > 0) {
        results.push({
          orderItemId: orderItem.id,
          menuItemName: orderItem.name,
          deductions: itemDeductions,
          totalCost: itemCost,
        })
        totalCost += itemCost
      }
    }

    return { processed: results, totalCost }
  } catch (error) {
    console.error('Failed to process liquor inventory:', error)
    // Don't fail the payment if inventory tracking fails
    // Just log the error and return empty results
    return { processed: [], totalCost: 0 }
  }
}

/**
 * Record spirit upsell events for an order
 */
export async function recordSpiritUpsells(
  orderId: string,
  employeeId: string | null,
  upsellEvents: {
    orderItemId: string
    baseModifierId: string
    baseTier: string
    baseBottleName: string
    upsellModifierId: string
    upsellTier: string
    upsellBottleName: string
    priceDifference: number
    wasShown: boolean
    wasAccepted: boolean
  }[]
): Promise<void> {
  if (upsellEvents.length === 0) return

  try {
    const locationId = await getLocationId()
    if (!locationId) return

    await db.spiritUpsellEvent.createMany({
      data: upsellEvents.map(event => ({
        locationId,
        orderId,
        orderItemId: event.orderItemId,
        employeeId: employeeId || '',
        baseModifierId: event.baseModifierId,
        baseTier: event.baseTier,
        baseBottleName: event.baseBottleName,
        upsellModifierId: event.upsellModifierId,
        upsellTier: event.upsellTier,
        upsellBottleName: event.upsellBottleName,
        priceDifference: event.priceDifference,
        wasShown: event.wasShown,
        wasAccepted: event.wasAccepted,
      })),
    })
  } catch (error) {
    console.error('Failed to record spirit upsells:', error)
    // Don't fail the payment if upsell tracking fails
  }
}

/**
 * Get liquor usage summary for an order
 */
export async function getLiquorUsageSummary(orderId: string) {
  const transactions = await db.inventoryTransaction.findMany({
    where: {
      orderId,
      type: 'sale',
    },
    select: {
      menuItemId: true,
      quantityChange: true,
      unitCost: true,
      totalCost: true,
      reason: true,
    },
  })

  return {
    transactions: transactions.map(t => ({
      bottleProductId: t.menuItemId,
      pours: Math.abs(t.quantityChange),
      pourCost: t.unitCost ? Number(t.unitCost) : 0,
      totalCost: t.totalCost ? Number(t.totalCost) : 0,
      notes: t.reason,
    })),
    totalPourCost: transactions.reduce(
      (sum, t) => sum + (t.totalCost ? Number(t.totalCost) : 0),
      0
    ),
  }
}

// Cost Cascade Utility
// When an inventory item's cost changes (via invoice, manual edit, or MarginEdge),
// cascade the update through all recipes that use it, recalculating food cost %.

import { db, adminDb } from './db'

export interface CostUpdateResult {
  inventoryItemId: string
  inventoryItemName: string
  oldCostPerUnit: number
  newCostPerUnit: number
  changePercent: number
  recipesRecalculated: number
  menuItemsUpdated: string[]
}

/**
 * Cascade a cost change from an inventory item through recipes to menu items.
 *
 * @param inventoryItemId - The inventory item whose cost changed
 * @param newPurchaseCost - New cost per purchase unit (e.g., $65 per case)
 * @param source - Where the cost came from: 'manual' | 'invoice' | 'marginedge'
 * @param locationId - Location for multi-tenant filtering
 * @param invoiceId - Optional invoice that triggered this update
 * @param vendorName - Optional vendor name for history
 * @param recordedById - Optional employee who recorded the change
 */
export async function cascadeCostUpdate(
  inventoryItemId: string,
  newPurchaseCost: number,
  source: string,
  locationId: string,
  invoiceId?: string,
  vendorName?: string,
  recordedById?: string,
  effectiveDate?: Date,
): Promise<CostUpdateResult> {
  // 1. Load the inventory item
  const item = await db.inventoryItem.findFirst({
    where: { id: inventoryItemId, locationId, deletedAt: null },
  })
  if (!item) throw new Error('InventoryItem not found')

  // 2. Calculate new costPerUnit (cost per storage unit)
  //    purchaseCost / unitsPerPurchase = costPerUnit
  const unitsPerPurchase = Number(item.unitsPerPurchase)
  const newCostPerUnit = unitsPerPurchase > 0
    ? newPurchaseCost / unitsPerPurchase
    : newPurchaseCost
  const oldCostPerUnit = Number(item.costPerUnit ?? 0)
  const changePercent = oldCostPerUnit > 0
    ? ((newCostPerUnit - oldCostPerUnit) / oldCostPerUnit) * 100
    : 100

  // 3. Update InventoryItem and record cost history atomically
  const effectiveDateToUse = effectiveDate ?? new Date()

  await db.$transaction(async (tx) => {
    await tx.inventoryItem.update({
      where: { id: inventoryItemId },
      data: {
        costPerUnit: newCostPerUnit,
        purchaseCost: newPurchaseCost,
        lastInvoiceCost: newPurchaseCost,
        lastInvoiceDate: new Date(),
        priceSource: source,
        lastPriceUpdate: new Date(),
        yieldCostPerUnit: item.yieldPercent
          ? newCostPerUnit / (Number(item.yieldPercent) / 100)
          : newCostPerUnit,
      },
    })

    // Skip stale history entries
    const latestHistory = await tx.ingredientCostHistory.findFirst({
      where: { inventoryItemId, locationId },
      orderBy: { effectiveDate: 'desc' },
      select: { effectiveDate: true },
    })

    if (!latestHistory || latestHistory.effectiveDate <= effectiveDateToUse) {
      await tx.ingredientCostHistory.create({
        data: {
          locationId,
          inventoryItemId,
          oldCostPerUnit,
          newCostPerUnit,
          changePercent,
          source,
          invoiceId: invoiceId ?? null,
          vendorName: vendorName ?? null,
          recordedById: recordedById ?? null,
          effectiveDate: effectiveDateToUse,
        },
      })
    }
  })

  // 5. Find affected recipe IDs via this inventory item
  const recipeIngredients = await db.menuItemRecipeIngredient.findMany({
    where: { inventoryItemId, deletedAt: null },
    select: { recipeId: true },
  })
  const recipeIds = [...new Set(recipeIngredients.map(ri => ri.recipeId))]
  const menuItemsUpdated: string[] = []

  if (recipeIds.length === 0) {
    return {
      inventoryItemId,
      inventoryItemName: item.name,
      oldCostPerUnit,
      newCostPerUnit,
      changePercent,
      recipesRecalculated: 0,
      menuItemsUpdated: [],
    }
  }

  // 6. SQL aggregation for recipe costs (avoids float rounding in JS)
  const recipeCostRows = await db.$queryRaw<{ id: string; totalCost: number }[]>`
    SELECT r.id,
           COALESCE(SUM(ri.quantity * COALESCE(i."costPerUnit", pp."costPerUnit", 0)), 0) AS "totalCost"
    FROM "MenuItemRecipe" r
    JOIN "MenuItemRecipeIngredient" ri ON ri."recipeId" = r.id AND ri."deletedAt" IS NULL
    LEFT JOIN "InventoryItem" i ON i.id = ri."inventoryItemId"
    LEFT JOIN "PrepItem" pp ON pp.id = ri."prepItemId"
    WHERE r.id = ANY(${recipeIds}::text[])
    GROUP BY r.id
  `
  const costByRecipeId = new Map(recipeCostRows.map(r => [r.id, Number(r.totalCost)]))

  // 7. Fetch recipes with menu items for price/name lookups
  const recipes = await db.menuItemRecipe.findMany({
    where: { id: { in: recipeIds } },
    include: { menuItem: true },
  })

  // 8. Build update payloads
  const recipeUpdates: Array<{ id: string; totalCost: number; foodCostPct: number | null }> = []
  const menuItemUpdates: Array<{ id: string; cost: number }> = []

  for (const recipe of recipes) {
    const totalCost = costByRecipeId.get(recipe.id) ?? 0
    const sellPrice = Number(recipe.menuItem.price)
    const foodCostPct = sellPrice > 0 ? (totalCost / sellPrice) * 100 : null

    recipeUpdates.push({ id: recipe.id, totalCost, foodCostPct })
    menuItemUpdates.push({ id: recipe.menuItemId, cost: totalCost })
    menuItemsUpdated.push(recipe.menuItem.name)
  }

  // STEP 4: Run updates in parallel chunks to avoid connection pool saturation.
  // Each chunk runs concurrently; chunks run sequentially.
  const CHUNK_SIZE = 20
  const allUpdates = [
    ...recipeUpdates.map(r => () =>
      db.menuItemRecipe.update({
        where: { id: r.id },
        data: { totalCost: r.totalCost, foodCostPct: r.foodCostPct },
      })
    ),
    ...menuItemUpdates.map(m => () =>
      adminDb.menuItem.update({
        where: { id: m.id },
        data: { cost: m.cost },
      })
    ),
  ]
  for (let i = 0; i < allUpdates.length; i += CHUNK_SIZE) {
    await Promise.all(allUpdates.slice(i, i + CHUNK_SIZE).map(fn => fn()))
  }

  return {
    inventoryItemId,
    inventoryItemName: item.name,
    oldCostPerUnit,
    newCostPerUnit,
    changePercent,
    recipesRecalculated: recipeIds.length,
    menuItemsUpdated,
  }
}

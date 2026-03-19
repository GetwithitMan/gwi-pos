/**
 * Advisory ingredient stock check for cake orders.
 *
 * Runs during status transition to in_production. Returns warnings for any
 * inventory items that have insufficient stock for the required ingredients.
 *
 * Does NOT block the transition — warnings are returned in the PATCH response
 * for display to the baker/admin.
 *
 * Ingredient requirements come from Modifier.metadata.requiredIngredients
 * (JSONB array). Falls back to ModifierInventoryLink if metadata is absent.
 */

import { parseCakeConfig } from '@/lib/cake-orders/schemas'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IngredientWarning {
  inventoryItemId: string
  itemName: string
  requiredQuantity: number
  currentStock: number
  unit: string
}

/**
 * Shape of a single entry in Modifier.metadata.requiredIngredients
 */
interface RequiredIngredient {
  inventoryItemId: string
  quantity: number
  unit: string
}

/**
 * Shape of a ModifierInventoryLink row (fallback when metadata is absent)
 */
interface ModifierInventoryLinkRow {
  inventoryItemId: string
  usageQuantity: string | number
  usageUnit: string
}

// ─── Main Function ──────────────────────────────────────────────────────────

/**
 * Check ingredient stock for a cake order being moved to in_production.
 *
 * Logic:
 * 1. Parse cakeConfig from the CakeOrder
 * 2. Collect all modifier IDs across all tiers
 * 3. For each modifier, look up requiredIngredients from metadata (or ModifierInventoryLink fallback)
 * 4. Aggregate total required quantity per inventoryItemId
 * 5. Check each aggregated item against InventoryItem.currentStock
 * 6. Return warnings for items where stock < required
 */
export async function checkIngredientStock(
  db: any,
  cakeOrderId: string,
): Promise<IngredientWarning[]> {
  // 1. Fetch the cake order's cakeConfig
  const orderRows = (await db.$queryRawUnsafe(
    `SELECT "cakeConfig", "locationId" FROM "CakeOrder" WHERE "id" = $1 LIMIT 1`,
    cakeOrderId,
  )) as Array<{ cakeConfig: unknown; locationId: string }>

  if (!orderRows || orderRows.length === 0) {
    return []
  }

  const { cakeConfig: rawConfig, locationId } = orderRows[0]
  const cakeConfig = parseCakeConfig(rawConfig)

  if (cakeConfig.tiers.length === 0) {
    return []
  }

  // 2. Collect all unique modifier IDs across all tiers
  const allModifierIds: string[] = []
  for (const tier of cakeConfig.tiers) {
    for (const mod of tier.modifiers) {
      if (mod.modifierId && !allModifierIds.includes(mod.modifierId)) {
        allModifierIds.push(mod.modifierId)
      }
    }
  }

  if (allModifierIds.length === 0) {
    return []
  }

  // 3. Fetch modifier metadata for all modifier IDs
  const placeholders = allModifierIds.map((_, i) => `$${i + 1}`).join(', ')
  const modifierRows = (await db.$queryRawUnsafe(
    `SELECT "id", "metadata" FROM "Modifier"
     WHERE "id" IN (${placeholders}) AND "deletedAt" IS NULL`,
    ...allModifierIds,
  )) as Array<{ id: string; metadata: unknown }>

  // Build map: modifierId -> requiredIngredients from metadata
  const modifierIngredients = new Map<string, RequiredIngredient[]>()
  const modifiersMissingMetadata: string[] = []

  for (const row of modifierRows) {
    const meta = row.metadata as Record<string, unknown> | null
    if (meta && Array.isArray(meta.requiredIngredients) && meta.requiredIngredients.length > 0) {
      // Validate each entry has the required fields
      const valid = (meta.requiredIngredients as unknown[]).filter(
        (ri): ri is RequiredIngredient =>
          typeof ri === 'object' &&
          ri !== null &&
          typeof (ri as any).inventoryItemId === 'string' &&
          typeof (ri as any).quantity === 'number' &&
          typeof (ri as any).unit === 'string',
      )
      if (valid.length > 0) {
        modifierIngredients.set(row.id, valid)
      } else {
        modifiersMissingMetadata.push(row.id)
      }
    } else {
      modifiersMissingMetadata.push(row.id)
    }
  }

  // 4. Fallback: fetch ModifierInventoryLink for modifiers without metadata
  if (modifiersMissingMetadata.length > 0) {
    const fallbackPlaceholders = modifiersMissingMetadata.map((_, i) => `$${i + 1}`).join(', ')
    const linkRows = (await db.$queryRawUnsafe(
      `SELECT "modifierId", "inventoryItemId", "usageQuantity", "usageUnit"
       FROM "ModifierInventoryLink"
       WHERE "modifierId" IN (${fallbackPlaceholders})
         AND "inventoryItemId" IS NOT NULL
         AND "deletedAt" IS NULL`,
      ...modifiersMissingMetadata,
    )) as Array<{ modifierId: string } & ModifierInventoryLinkRow>

    for (const link of linkRows) {
      if (link.inventoryItemId) {
        modifierIngredients.set(link.modifierId, [
          {
            inventoryItemId: link.inventoryItemId,
            quantity: Number(link.usageQuantity) || 0,
            unit: link.usageUnit,
          },
        ])
      }
    }
  }

  // 5. Aggregate total required quantity per inventoryItemId across all tiers
  const aggregated = new Map<string, { quantity: number; unit: string }>()

  for (const tier of cakeConfig.tiers) {
    for (const mod of tier.modifiers) {
      const ingredients = modifierIngredients.get(mod.modifierId)
      if (!ingredients) continue

      for (const ing of ingredients) {
        const existing = aggregated.get(ing.inventoryItemId)
        if (existing) {
          existing.quantity += ing.quantity
        } else {
          aggregated.set(ing.inventoryItemId, {
            quantity: ing.quantity,
            unit: ing.unit,
          })
        }
      }
    }
  }

  if (aggregated.size === 0) {
    return []
  }

  // 6. Check current stock for all aggregated inventory items
  const inventoryIds = Array.from(aggregated.keys())
  const invPlaceholders = inventoryIds.map((_, i) => `$${i + 1}`).join(', ')
  const inventoryRows = (await db.$queryRawUnsafe(
    `SELECT "id", "name", "currentStock", "storageUnit"
     FROM "InventoryItem"
     WHERE "id" IN (${invPlaceholders})
       AND "locationId" = $${inventoryIds.length + 1}
       AND "deletedAt" IS NULL`,
    ...inventoryIds,
    locationId,
  )) as Array<{ id: string; name: string; currentStock: string | number; storageUnit: string }>

  // Build stock map
  const stockMap = new Map<string, { name: string; currentStock: number; unit: string }>()
  for (const row of inventoryRows) {
    stockMap.set(row.id, {
      name: row.name,
      currentStock: Number(row.currentStock) || 0,
      unit: row.storageUnit,
    })
  }

  // 7. Compare and build warnings
  const warnings: IngredientWarning[] = []

  for (const [inventoryItemId, required] of aggregated) {
    const stock = stockMap.get(inventoryItemId)
    if (!stock) {
      // Item not found in inventory — warn with 0 stock
      warnings.push({
        inventoryItemId,
        itemName: '(Unknown Item)',
        requiredQuantity: required.quantity,
        currentStock: 0,
        unit: required.unit,
      })
      continue
    }

    if (stock.currentStock < required.quantity) {
      warnings.push({
        inventoryItemId,
        itemName: stock.name,
        requiredQuantity: required.quantity,
        currentStock: stock.currentStock,
        unit: stock.unit || required.unit,
      })
    }
  }

  return warnings
}

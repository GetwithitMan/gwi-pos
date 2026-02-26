/**
 * Copy Dev Menu Data to a Venue Database
 *
 * Copies all menu/food/liquor/modifier/ingredient data from the dev database
 * (gwi_pos) to a venue database (e.g., gwi_pos_fruita_grill), while preserving
 * the venue's employees, orders, and location settings.
 *
 * Usage:
 *   npx dotenv -e .env.local -- npx tsx scripts/copy-menu-to-venue.ts
 */

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

// ── Configuration ───────────────────────────────────────────────────────────────

const SOURCE_LOCATION_ID = 'loc-1'
const TARGET_LOCATION_ID = 'cmlqz9rwi0002i5043d2jbf64'
const TARGET_VENUE_SLUG = 'fruita-grill'

// ── Build URLs ──────────────────────────────────────────────────────────────────

function replaceDbNameInUrl(url: string, dbName: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
}

const sourceUrl = process.env.DATABASE_URL!
const targetDbName = `gwi_pos_${TARGET_VENUE_SLUG.replace(/-/g, '_')}`
const targetUrl = replaceDbNameInUrl(sourceUrl, targetDbName)

console.log(`Source DB: gwi_pos`)
console.log(`Target DB: ${targetDbName}`)
console.log()

// ── Prisma Clients ──────────────────────────────────────────────────────────────

const source = new PrismaClient({ datasources: { db: { url: sourceUrl } } })
const target = new PrismaClient({ datasources: { db: { url: targetUrl } } })

// ── ID Mapping ──────────────────────────────────────────────────────────────────

const idMap = new Map<string, string>()

function mapId(oldId: string | null | undefined, required = true): string | null {
  if (!oldId) return null
  const newId = idMap.get(oldId)
  if (!newId) {
    if (required) throw new Error(`Missing ID mapping for: ${oldId}`)
    return null
  }
  return newId
}

function generateMapping(oldId: string): string {
  const newId = randomUUID()
  idMap.set(oldId, newId)
  return newId
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  // ── Count before ────────────────────────────────────────────────────────────
  console.log('=== BEFORE (Target DB) ===')
  const beforeCounts = {
    ingredientCategories: await target.ingredientCategory.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredientSwapGroups: await target.ingredientSwapGroup.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    inventoryItems: await target.inventoryItem.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredients: await target.ingredient.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredientRecipes: await target.ingredientRecipe.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    categories: await target.category.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    menuItems: await target.menuItem.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    modifierGroups: await target.modifierGroup.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    modifiers: await target.modifier.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    menuItemIngredients: await target.menuItemIngredient.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
  }
  for (const [key, count] of Object.entries(beforeCounts)) {
    console.log(`  ${key}: ${count}`)
  }

  // ── Read source data ────────────────────────────────────────────────────────
  console.log('\n=== Reading source data ===')

  const ingredientCategories = await source.ingredientCategory.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  IngredientCategory: ${ingredientCategories.length}`)

  const ingredientSwapGroups = await source.ingredientSwapGroup.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  IngredientSwapGroup: ${ingredientSwapGroups.length}`)

  const inventoryItems = await source.inventoryItem.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  InventoryItem: ${inventoryItems.length}`)

  const ingredients = await source.ingredient.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  Ingredient: ${ingredients.length}`)

  const ingredientRecipes = await source.ingredientRecipe.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  IngredientRecipe: ${ingredientRecipes.length}`)

  const categories = await source.category.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  Category: ${categories.length}`)

  const menuItems = await source.menuItem.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  MenuItem: ${menuItems.length}`)

  const modifierGroups = await source.modifierGroup.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  ModifierGroup: ${modifierGroups.length}`)

  const modifiers = await source.modifier.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  Modifier: ${modifiers.length}`)

  const menuItemIngredients = await source.menuItemIngredient.findMany({
    where: { locationId: SOURCE_LOCATION_ID, deletedAt: null },
  })
  console.log(`  MenuItemIngredient: ${menuItemIngredients.length}`)

  // ── Pre-generate all ID mappings ──────────────────────────────────────────
  console.log('\n=== Generating ID mappings ===')
  for (const r of ingredientCategories) generateMapping(r.id)
  for (const r of ingredientSwapGroups) generateMapping(r.id)
  for (const r of inventoryItems) generateMapping(r.id)
  for (const r of ingredients) generateMapping(r.id)
  for (const r of ingredientRecipes) generateMapping(r.id)
  for (const r of categories) generateMapping(r.id)
  for (const r of menuItems) generateMapping(r.id)
  for (const r of modifierGroups) generateMapping(r.id)
  for (const r of modifiers) generateMapping(r.id)
  for (const r of menuItemIngredients) generateMapping(r.id)
  console.log(`  Total mappings: ${idMap.size}`)

  // ── Write to target inside a transaction ──────────────────────────────────
  console.log('\n=== Writing to target DB (transaction) ===')

  await target.$transaction(async (tx) => {
    const loc = TARGET_LOCATION_ID
    const now = new Date().toISOString()
    const suffix = `__old_${Date.now()}`

    // ── Step 0: Soft-delete existing + free unique constraints ──────────────
    console.log('  Step 0: Soft-deleting existing menu data...')
    const menuTables = [
      'MenuItemIngredient', 'Modifier', 'ModifierGroup', 'MenuItem',
      'Category', 'IngredientRecipe', 'Ingredient', 'InventoryItem',
      'IngredientSwapGroup', 'IngredientCategory',
    ]
    for (const table of menuTables) {
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "deletedAt" = $1::timestamp WHERE "locationId" = $2 AND "deletedAt" IS NULL`,
        now, loc
      )
    }
    // Free unique constraint slots
    await tx.$executeRawUnsafe(
      `UPDATE "IngredientCategory" SET "name" = "name" || $1, "code" = "code" + 100000 WHERE "locationId" = $2 AND "deletedAt" IS NOT NULL`,
      suffix, loc
    )
    await tx.$executeRawUnsafe(
      `UPDATE "IngredientSwapGroup" SET "name" = "name" || $1 WHERE "locationId" = $2 AND "deletedAt" IS NOT NULL`,
      suffix, loc
    )
    await tx.$executeRawUnsafe(
      `UPDATE "InventoryItem" SET "name" = "name" || $1 WHERE "locationId" = $2 AND "deletedAt" IS NOT NULL`,
      suffix, loc
    )
    await tx.$executeRawUnsafe(
      `UPDATE "MenuItem" SET "sku" = "sku" || $1 WHERE "locationId" = $2 AND "deletedAt" IS NOT NULL AND "sku" IS NOT NULL`,
      suffix, loc
    )
    console.log('  Done.')

    // ── Phase 1: IngredientCategory (createMany) ────────────────────────────
    console.log('  Phase 1: IngredientCategory...')
    if (ingredientCategories.length > 0) {
      await tx.ingredientCategory.createMany({
        data: ingredientCategories.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          code: r.code,
          name: r.name,
          description: r.description,
          icon: r.icon,
          color: r.color,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          needsVerification: r.needsVerification,
        })),
      })
    }

    // ── Phase 1b: IngredientSwapGroup ───────────────────────────────────────
    console.log('  Phase 1b: IngredientSwapGroup...')
    if (ingredientSwapGroups.length > 0) {
      await tx.ingredientSwapGroup.createMany({
        data: ingredientSwapGroups.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          name: r.name,
          description: r.description,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
        })),
      })
    }

    // ── Phase 2: InventoryItem ──────────────────────────────────────────────
    console.log('  Phase 2: InventoryItem...')
    if (inventoryItems.length > 0) {
      await tx.inventoryItem.createMany({
        data: inventoryItems.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          name: r.name,
          sku: r.sku,
          description: r.description,
          department: r.department,
          itemType: r.itemType,
          revenueCenter: r.revenueCenter,
          category: r.category,
          subcategory: r.subcategory,
          brand: r.brand,
          purchaseUnit: r.purchaseUnit,
          purchaseSize: r.purchaseSize,
          purchaseCost: r.purchaseCost,
          storageUnit: r.storageUnit,
          unitsPerPurchase: r.unitsPerPurchase,
          costPerUnit: r.costPerUnit,
          costingMethod: r.costingMethod,
          lastPriceUpdate: r.lastPriceUpdate,
          priceSource: r.priceSource,
          yieldPercent: r.yieldPercent,
          yieldCostPerUnit: r.yieldCostPerUnit,
          pourSizeOz: r.pourSizeOz,
          proofPercent: r.proofPercent,
          currentStock: r.currentStock,
          parLevel: r.parLevel,
          reorderPoint: r.reorderPoint,
          reorderQty: r.reorderQty,
          isActive: r.isActive,
          trackInventory: r.trackInventory,
          // Omit: defaultVendorId, spiritCategoryId (not in scope)
        })),
      })
    }

    // ── Phase 3: Ingredient ─────────────────────────────────────────────────
    // Base ingredients first (no parent), then children
    const baseIngredients = ingredients.filter((i) => !i.parentIngredientId)
    const childIngredients = ingredients.filter((i) => i.parentIngredientId)

    const mapIngredient = (r: typeof ingredients[0]) => ({
      id: mapId(r.id)!,
      locationId: loc,
      name: r.name,
      description: r.description,
      category: r.category,
      categoryId: r.categoryId ? mapId(r.categoryId) : null,
      inventoryItemId: r.inventoryItemId ? mapId(r.inventoryItemId) : null,
      standardQuantity: r.standardQuantity,
      standardUnit: r.standardUnit,
      sourceType: r.sourceType,
      purchaseUnit: r.purchaseUnit,
      purchaseCost: r.purchaseCost,
      unitsPerPurchase: r.unitsPerPurchase,
      allowNo: r.allowNo,
      allowLite: r.allowLite,
      allowExtra: r.allowExtra,
      allowOnSide: r.allowOnSide,
      extraPrice: r.extraPrice,
      liteMultiplier: r.liteMultiplier,
      extraMultiplier: r.extraMultiplier,
      allowSwap: r.allowSwap,
      swapGroupId: r.swapGroupId ? mapId(r.swapGroupId) : null,
      swapUpcharge: r.swapUpcharge,
      visibility: r.visibility,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      parentIngredientId: r.parentIngredientId ? mapId(r.parentIngredientId) : null,
      preparationType: r.preparationType,
      yieldPercent: r.yieldPercent,
      batchYield: r.batchYield,
      inputQuantity: r.inputQuantity,
      inputUnit: r.inputUnit,
      outputQuantity: r.outputQuantity,
      outputUnit: r.outputUnit,
      recipeYieldQuantity: r.recipeYieldQuantity,
      recipeYieldUnit: r.recipeYieldUnit,
      portionSize: r.portionSize,
      portionUnit: r.portionUnit,
      isDailyCountItem: r.isDailyCountItem,
      currentPrepStock: r.currentPrepStock,
      countPrecision: r.countPrecision,
      lowStockThreshold: r.lowStockThreshold,
      criticalStockThreshold: r.criticalStockThreshold,
      onlineStockThreshold: r.onlineStockThreshold,
      resetDailyToZero: r.resetDailyToZero,
      varianceHandling: r.varianceHandling,
      varianceThreshold: r.varianceThreshold,
      isBaseIngredient: r.isBaseIngredient,
      is86d: r.is86d,
      showOnQuick86: r.showOnQuick86,
      needsVerification: r.needsVerification,
      // Omit: prepItemId, lastCountedAt, last86dAt, last86dBy, verifiedAt, verifiedBy
    })

    console.log('  Phase 3: Ingredient (base)...')
    if (baseIngredients.length > 0) {
      await tx.ingredient.createMany({ data: baseIngredients.map(mapIngredient) })
    }

    console.log('  Phase 3b: Ingredient (children)...')
    if (childIngredients.length > 0) {
      await tx.ingredient.createMany({ data: childIngredients.map(mapIngredient) })
    }

    // ── Phase 4: IngredientRecipe ───────────────────────────────────────────
    console.log('  Phase 4: IngredientRecipe...')
    if (ingredientRecipes.length > 0) {
      await tx.ingredientRecipe.createMany({
        data: ingredientRecipes.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          outputId: mapId(r.outputId)!,
          componentId: mapId(r.componentId)!,
          quantity: r.quantity,
          unit: r.unit,
          batchSize: r.batchSize,
          batchUnit: r.batchUnit,
          sortOrder: r.sortOrder,
        })),
      })
    }

    // ── Phase 5: Category ───────────────────────────────────────────────────
    console.log('  Phase 5: Category...')
    if (categories.length > 0) {
      await tx.category.createMany({
        data: categories.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          name: r.name,
          displayName: r.displayName,
          description: r.description,
          color: r.color,
          imageUrl: r.imageUrl,
          categoryType: r.categoryType,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          showOnPOS: r.showOnPOS,
          showOnline: r.showOnline,
          categoryShow: r.categoryShow,
          courseNumber: r.courseNumber,
          printerIds: r.printerIds ?? undefined,
          routeTags: r.routeTags ?? undefined,
          // Omit: prepStationId (venue-specific)
        })),
      })
    }

    // ── Phase 6: MenuItem ───────────────────────────────────────────────────
    console.log('  Phase 6: MenuItem...')
    if (menuItems.length > 0) {
      await tx.menuItem.createMany({
        data: menuItems.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          categoryId: mapId(r.categoryId)!,
          name: r.name,
          displayName: r.displayName,
          description: r.description,
          sku: r.sku,
          imageUrl: r.imageUrl,
          price: r.price,
          priceCC: r.priceCC,
          cost: r.cost,
          onlinePrice: r.onlinePrice,
          taxRate: r.taxRate,
          isTaxExempt: r.isTaxExempt,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
          showOnPOS: r.showOnPOS,
          showOnline: r.showOnline,
          prepTime: r.prepTime,
          courseNumber: r.courseNumber,
          printerIds: r.printerIds,
          backupPrinterIds: r.backupPrinterIds,
          routeTags: r.routeTags,
          trackInventory: r.trackInventory,
          currentStock: r.currentStock,
          lowStockAlert: r.lowStockAlert,
          isAvailable: r.isAvailable,
          itemType: r.itemType,
          comboPrintMode: r.comboPrintMode,
          timedPricing: r.timedPricing,
          ratePerMinute: r.ratePerMinute,
          minimumCharge: r.minimumCharge,
          incrementMinutes: r.incrementMinutes,
          minimumMinutes: r.minimumMinutes,
          graceMinutes: r.graceMinutes,
          prepaidPackages: r.prepaidPackages,
          happyHourEnabled: r.happyHourEnabled,
          happyHourDiscount: r.happyHourDiscount,
          happyHourStart: r.happyHourStart,
          happyHourEnd: r.happyHourEnd,
          happyHourDays: r.happyHourDays,
          availableFrom: r.availableFrom,
          availableTo: r.availableTo,
          availableDays: r.availableDays,
          commissionType: r.commissionType,
          commissionValue: r.commissionValue,
          pourSizes: r.pourSizes,
          defaultPourSize: r.defaultPourSize,
          applyPourToModifiers: r.applyPourToModifiers,
          soldByWeight: r.soldByWeight,
          weightUnit: r.weightUnit,
          pricePerWeightUnit: r.pricePerWeightUnit,
          linkedPourSizeOz: r.linkedPourSizeOz,
          // Reset entertainment state
          entertainmentStatus: null,
          currentUseCount: 0,
          currentOrderId: null,
          currentOrderItemId: null,
          blockTimeMinutes: r.blockTimeMinutes,
          maxConcurrentUses: r.maxConcurrentUses,
          // Omit: prepStationId, linkedBottleProductId (venue-specific)
        })),
      })
    }

    // ── Phase 7: ModifierGroup ──────────────────────────────────────────────
    console.log('  Phase 7: ModifierGroup...')
    if (modifierGroups.length > 0) {
      await tx.modifierGroup.createMany({
        data: modifierGroups.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          menuItemId: r.menuItemId ? mapId(r.menuItemId, false) : null,
          name: r.name,
          displayName: r.displayName,
          modifierTypes: r.modifierTypes,
          minSelections: r.minSelections,
          maxSelections: r.maxSelections,
          isRequired: r.isRequired,
          allowStacking: r.allowStacking,
          tieredPricingConfig: r.tieredPricingConfig,
          exclusionGroupKey: r.exclusionGroupKey,
          hasOnlineOverride: r.hasOnlineOverride,
          sortOrder: r.sortOrder,
          showOnline: r.showOnline,
          isSpiritGroup: r.isSpiritGroup,
        })),
      })
    }

    // ── Phase 8: Modifier ───────────────────────────────────────────────────
    // All modifiers first without childModifierGroupId, then update the ones that have it
    console.log('  Phase 8: Modifier...')
    if (modifiers.length > 0) {
      await tx.modifier.createMany({
        data: modifiers.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          modifierGroupId: mapId(r.modifierGroupId)!,
          name: r.name,
          displayName: r.displayName,
          price: r.price,
          priceType: r.priceType,
          upsellPrice: r.upsellPrice,
          cost: r.cost,
          allowNo: r.allowNo,
          allowLite: r.allowLite,
          allowOnSide: r.allowOnSide,
          allowExtra: r.allowExtra,
          extraPrice: r.extraPrice,
          liteMultiplier: r.liteMultiplier,
          extraMultiplier: r.extraMultiplier,
          allowedPreModifiers: r.allowedPreModifiers,
          extraUpsellPrice: r.extraUpsellPrice,
          ingredientId: r.ingredientId ? mapId(r.ingredientId, false) : null,
          // Set childModifierGroupId to null initially — will update after
          childModifierGroupId: null,
          commissionType: r.commissionType,
          commissionValue: r.commissionValue,
          linkedMenuItemId: r.linkedMenuItemId ? mapId(r.linkedMenuItemId, false) : null,
          spiritTier: r.spiritTier,
          pourSizeOz: r.pourSizeOz,
          sortOrder: r.sortOrder,
          isDefault: r.isDefault,
          isActive: r.isActive,
          showOnPOS: r.showOnPOS,
          showOnline: r.showOnline,
          isLabel: r.isLabel,
          printerRouting: r.printerRouting,
          printerIds: r.printerIds,
          // Omit: linkedBottleProductId (not in scope)
        })),
      })
    }

    // Update childModifierGroupId for modifiers that have it
    const modifiersWithChild = modifiers.filter((m) => m.childModifierGroupId)
    if (modifiersWithChild.length > 0) {
      console.log(`  Phase 8b: Updating ${modifiersWithChild.length} modifiers with child groups...`)
      for (const r of modifiersWithChild) {
        const newChildId = mapId(r.childModifierGroupId, false)
        if (newChildId) {
          await tx.modifier.update({
            where: { id: mapId(r.id)! },
            data: { childModifierGroupId: newChildId },
          })
        }
      }
    }

    // ── Phase 9: MenuItemIngredient ─────────────────────────────────────────
    console.log('  Phase 9: MenuItemIngredient...')
    if (menuItemIngredients.length > 0) {
      await tx.menuItemIngredient.createMany({
        data: menuItemIngredients.map((r) => ({
          id: mapId(r.id)!,
          locationId: loc,
          menuItemId: mapId(r.menuItemId)!,
          ingredientId: mapId(r.ingredientId)!,
          isIncluded: r.isIncluded,
          quantity: r.quantity,
          unit: r.unit,
          allowNo: r.allowNo,
          allowLite: r.allowLite,
          allowExtra: r.allowExtra,
          allowOnSide: r.allowOnSide,
          extraPrice: r.extraPrice,
          isBase: r.isBase,
          sortOrder: r.sortOrder,
        })),
      })
    }

    console.log('  Transaction complete!')
  }, { timeout: 300000 }) // 5 minute timeout

  // ── Count after ─────────────────────────────────────────────────────────────
  console.log('\n=== AFTER (Target DB) ===')
  const afterCounts = {
    ingredientCategories: await target.ingredientCategory.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredientSwapGroups: await target.ingredientSwapGroup.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    inventoryItems: await target.inventoryItem.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredients: await target.ingredient.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    ingredientRecipes: await target.ingredientRecipe.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    categories: await target.category.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    menuItems: await target.menuItem.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    modifierGroups: await target.modifierGroup.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    modifiers: await target.modifier.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
    menuItemIngredients: await target.menuItemIngredient.count({ where: { locationId: TARGET_LOCATION_ID, deletedAt: null } }),
  }
  for (const [key, count] of Object.entries(afterCounts)) {
    const before = beforeCounts[key as keyof typeof beforeCounts]
    console.log(`  ${key}: ${before} → ${count}`)
  }

  // ── Source counts for comparison ──────────────────────────────────────────
  console.log('\n=== Source DB counts (for comparison) ===')
  const sourceCounts = {
    ingredientCategories: ingredientCategories.length,
    ingredientSwapGroups: ingredientSwapGroups.length,
    inventoryItems: inventoryItems.length,
    ingredients: ingredients.length,
    ingredientRecipes: ingredientRecipes.length,
    categories: categories.length,
    menuItems: menuItems.length,
    modifierGroups: modifierGroups.length,
    modifiers: modifiers.length,
    menuItemIngredients: menuItemIngredients.length,
  }
  for (const [key, count] of Object.entries(sourceCounts)) {
    const after = afterCounts[key as keyof typeof afterCounts]
    const match = count === after ? '✓' : '✗ MISMATCH'
    console.log(`  ${key}: ${count} ${match}`)
  }

  console.log('\nDone!')
}

main()
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await source.$disconnect()
    await target.$disconnect()
  })

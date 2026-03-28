/**
 * POST /api/inventory/copy-to-location
 *
 * Enterprise feature: copies ingredients (and optionally recipes) from one
 * location to another within the same organization.
 *
 * Body:
 *   sourceLocationId  - location to copy FROM
 *   targetLocationId  - location to copy TO
 *   items             - optional array of ingredient IDs; empty = copy all
 *   includeRecipes    - copy IngredientRecipe + MenuItemIngredient links
 *   skipExisting      - when true, skip ingredients whose name already exists at target
 *   requestingEmployeeId - for permission check (cookie fallback supported)
 *
 * Returns: { copied, skipped, recipesLinked, failed }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { err, forbidden, notFound, ok } from '@/lib/api-response'

export const POST = withVenue(withAuth('ADMIN', async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      sourceLocationId,
      targetLocationId,
      items,
      includeRecipes = false,
      skipExisting = true,
      requestingEmployeeId,
    } = body

    // ── Validation ─────────────────────────────────────────────────────
    if (!sourceLocationId || !targetLocationId) {
      return err('sourceLocationId and targetLocationId are required')
    }

    if (sourceLocationId === targetLocationId) {
      return err('Source and target locations must be different')
    }

    // ── Permission ─────────────────────────────────────────────────────
    // Require admin permission at the SOURCE location (reading data)
    const authSource = await requirePermission(
      requestingEmployeeId,
      sourceLocationId,
      PERMISSIONS.ADMIN,
    )
    if (!authSource.authorized) {
      return err(authSource.error, authSource.status)
    }

    // ── Verify both locations belong to the same organization ──────────
    const [sourceLoc, targetLoc] = await Promise.all([
      db.location.findUnique({
        where: { id: sourceLocationId },
        select: { id: true, organizationId: true, name: true },
      }),
      db.location.findUnique({
        where: { id: targetLocationId },
        select: { id: true, organizationId: true, name: true },
      }),
    ])

    if (!sourceLoc || !targetLoc) {
      return notFound('One or both locations not found')
    }

    if (sourceLoc.organizationId !== targetLoc.organizationId) {
      return forbidden('Locations must belong to the same organization')
    }

    // ── Fetch source ingredients ───────────────────────────────────────
    const sourceWhere: Record<string, unknown> = {
      locationId: sourceLocationId,
      deletedAt: null,
    }
    if (Array.isArray(items) && items.length > 0) {
      sourceWhere.id = { in: items }
    }

    const sourceIngredients = await db.ingredient.findMany({
      where: sourceWhere,
      include: {
        categoryRelation: { select: { id: true, name: true, code: true, icon: true, color: true } },
      },
    })

    if (sourceIngredients.length === 0) {
      return notFound('No ingredients found at source location')
    }

    // ── Fetch existing ingredients at target (for skipExisting) ────────
    const targetExisting = await db.ingredient.findMany({
      where: { locationId: targetLocationId, deletedAt: null },
      select: { id: true, name: true },
    })
    const targetNameSet = new Set(targetExisting.map((i) => i.name.toLowerCase()))

    // ── Fetch target categories (for re-linking) ───────────────────────
    const targetCategories = await db.ingredientCategory.findMany({
      where: { locationId: targetLocationId, deletedAt: null },
      select: { id: true, name: true },
    })
    const targetCatByName = new Map(targetCategories.map((c) => [c.name.toLowerCase(), c.id]))

    // ── Copy in a transaction ──────────────────────────────────────────
    const result = await db.$transaction(async (tx) => {
      let copied = 0
      let skipped = 0
      const failed: Array<{ name: string; reason: string }> = []

      // Maps source ingredient ID -> new target ingredient ID (for recipe linking)
      const idMap = new Map<string, string>()

      // Sort so parents come before children
      const sorted = [...sourceIngredients].sort((a, b) => {
        if (a.parentIngredientId === null && b.parentIngredientId !== null) return -1
        if (a.parentIngredientId !== null && b.parentIngredientId === null) return 1
        return 0
      })

      for (const src of sorted) {
        // Skip if already exists at target
        if (skipExisting && targetNameSet.has(src.name.toLowerCase())) {
          // Still record the mapping for recipe linking if possible
          const existingTarget = targetExisting.find(
            (t) => t.name.toLowerCase() === src.name.toLowerCase(),
          )
          if (existingTarget) {
            idMap.set(src.id, existingTarget.id)
          }
          skipped++
          continue
        }

        try {
          // Resolve category at target (match by name, or create)
          let targetCategoryId: string | null = null
          if (src.categoryRelation) {
            const existing = targetCatByName.get(src.categoryRelation.name.toLowerCase())
            if (existing) {
              targetCategoryId = existing
            } else {
              // Create the category at target
              const maxCode = await tx.ingredientCategory.aggregate({
                where: { locationId: targetLocationId },
                _max: { code: true },
              })
              const newCat = await tx.ingredientCategory.create({
                data: {
                  locationId: targetLocationId,
                  code: (maxCode._max.code ?? 0) + 1,
                  name: src.categoryRelation.name,
                  icon: src.categoryRelation.icon,
                  color: src.categoryRelation.color,
                },
              })
              targetCategoryId = newCat.id
              targetCatByName.set(src.categoryRelation.name.toLowerCase(), newCat.id)
            }
          }

          // Resolve parent ingredient at target (for child ingredients)
          let targetParentId: string | null = null
          if (src.parentIngredientId) {
            targetParentId = idMap.get(src.parentIngredientId) ?? null
          }

          const newIngredient = await tx.ingredient.create({
            data: {
              locationId: targetLocationId,
              name: src.name,
              description: src.description,
              category: src.category,
              categoryId: targetCategoryId,
              // No inventory/prep item link (these are location-specific)
              standardQuantity: src.standardQuantity,
              standardUnit: src.standardUnit,
              sourceType: src.sourceType,
              purchaseUnit: src.purchaseUnit,
              purchaseCost: src.purchaseCost,
              unitsPerPurchase: src.unitsPerPurchase,
              allowNo: src.allowNo,
              allowLite: src.allowLite,
              allowExtra: src.allowExtra,
              allowOnSide: src.allowOnSide,
              extraPrice: src.extraPrice,
              liteMultiplier: src.liteMultiplier,
              extraMultiplier: src.extraMultiplier,
              allowSwap: src.allowSwap,
              swapUpcharge: src.swapUpcharge,
              visibility: src.visibility,
              sortOrder: src.sortOrder,
              isActive: src.isActive,
              // Hierarchy
              parentIngredientId: targetParentId,
              preparationType: src.preparationType,
              yieldPercent: src.yieldPercent,
              batchYield: src.batchYield,
              isBaseIngredient: src.isBaseIngredient,
              // Input/Output
              inputQuantity: src.inputQuantity,
              inputUnit: src.inputUnit,
              outputQuantity: src.outputQuantity,
              outputUnit: src.outputUnit,
              // Recipe yield
              recipeYieldQuantity: src.recipeYieldQuantity,
              recipeYieldUnit: src.recipeYieldUnit,
              // Daily count
              isDailyCountItem: src.isDailyCountItem,
              countPrecision: src.countPrecision,
              lowStockThreshold: src.lowStockThreshold,
              criticalStockThreshold: src.criticalStockThreshold,
              onlineStockThreshold: src.onlineStockThreshold,
              resetDailyToZero: src.resetDailyToZero,
              varianceHandling: src.varianceHandling,
              varianceThreshold: src.varianceThreshold,
              showOnQuick86: src.showOnQuick86,
            },
          })

          idMap.set(src.id, newIngredient.id)
          targetNameSet.add(src.name.toLowerCase())
          copied++
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          failed.push({ name: src.name, reason: msg })
        }
      }

      // ── Copy IngredientRecipe links ────────────────────────────────
      let recipesLinked = 0
      if (includeRecipes) {
        // Fetch all IngredientRecipe links at source for the copied ingredients
        const sourceRecipes = await tx.ingredientRecipe.findMany({
          where: {
            locationId: sourceLocationId,
            deletedAt: null,
            outputId: { in: [...idMap.keys()] },
            componentId: { in: [...idMap.keys()] },
          },
        })

        for (const recipe of sourceRecipes) {
          const newOutputId = idMap.get(recipe.outputId)
          const newComponentId = idMap.get(recipe.componentId)
          if (!newOutputId || !newComponentId) continue

          // Check for duplicate
          const existing = await tx.ingredientRecipe.findFirst({
            where: {
              locationId: targetLocationId,
              outputId: newOutputId,
              componentId: newComponentId,
              deletedAt: null,
            },
          })
          if (existing) continue

          try {
            await tx.ingredientRecipe.create({
              data: {
                locationId: targetLocationId,
                outputId: newOutputId,
                componentId: newComponentId,
                quantity: recipe.quantity,
                unit: recipe.unit,
                batchSize: recipe.batchSize,
                batchUnit: recipe.batchUnit,
                sortOrder: recipe.sortOrder,
              },
            })
            recipesLinked++
          } catch {
            // Skip duplicate or constraint errors silently
          }
        }

        // ── Copy MenuItemIngredient links (match menu items by name) ──
        const sourceMenuItemIngredients = await tx.menuItemIngredient.findMany({
          where: {
            locationId: sourceLocationId,
            deletedAt: null,
            ingredientId: { in: [...idMap.keys()] },
          },
          include: {
            menuItem: { select: { id: true, name: true } },
          },
        })

        if (sourceMenuItemIngredients.length > 0) {
          // Fetch all menu items at target location for name matching
          const targetMenuItems = await tx.menuItem.findMany({
            where: { locationId: targetLocationId, deletedAt: null },
            select: { id: true, name: true },
          })
          const targetMenuByName = new Map(
            targetMenuItems.map((m) => [m.name.toLowerCase(), m.id]),
          )

          for (const link of sourceMenuItemIngredients) {
            const newIngredientId = idMap.get(link.ingredientId)
            if (!newIngredientId) continue

            const targetMenuItemId = targetMenuByName.get(
              link.menuItem.name.toLowerCase(),
            )
            if (!targetMenuItemId) continue

            // Check for duplicate
            const existing = await tx.menuItemIngredient.findFirst({
              where: {
                locationId: targetLocationId,
                menuItemId: targetMenuItemId,
                ingredientId: newIngredientId,
                pricingOptionId: link.pricingOptionId,
                deletedAt: null,
              },
            })
            if (existing) continue

            try {
              await tx.menuItemIngredient.create({
                data: {
                  locationId: targetLocationId,
                  menuItemId: targetMenuItemId,
                  ingredientId: newIngredientId,
                  isIncluded: link.isIncluded,
                  quantity: link.quantity,
                  unit: link.unit,
                  allowNo: link.allowNo,
                  allowLite: link.allowLite,
                  allowExtra: link.allowExtra,
                  allowOnSide: link.allowOnSide,
                  extraPrice: link.extraPrice,
                  isBase: link.isBase,
                  sortOrder: link.sortOrder,
                },
              })
              recipesLinked++
            } catch {
              // Skip duplicate or constraint errors silently
            }
          }
        }
      }

      return { copied, skipped, recipesLinked, failed }
    })

    void notifyDataChanged({ locationId: targetLocationId, domain: 'inventory', action: 'created', entityId: targetLocationId })
    pushUpstream()

    return ok({
        copied: result.copied,
        skipped: result.skipped,
        recipesLinked: result.recipesLinked,
        failed: result.failed,
        sourceLocation: sourceLoc.name,
        targetLocation: targetLoc.name,
      })
  } catch (error) {
    console.error('Error copying ingredients to location:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Failed to copy ingredients', detail: message },
      { status: 500 },
    )
  }
}))

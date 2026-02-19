/**
 * Theoretical Usage Calculation
 *
 * Calculate theoretical inventory usage based on sales.
 * This is the core calculation shared by multiple reports.
 */

import { db } from '@/lib/db'
import type {
  CalculateTheoreticalUsageParams,
  InventoryItemData,
  MultiplierSettings,
  PrepItemWithIngredients,
  TheoreticalUsageItem,
  TheoreticalUsageResult,
} from './types'
import { getEffectiveCost, toNumber, getModifierMultiplier, isRemovalInstruction, explodePrepItem } from './helpers'
import { convertUnits } from './unit-conversion'

export async function calculateTheoreticalUsage(
  params: CalculateTheoreticalUsageParams
): Promise<TheoreticalUsageResult> {
  const { locationId, startDate, endDate, department, multiplierSettings } = params

  // Get all completed orders in the date range
  // Note: PrepItemIngredient only links to InventoryItem (no nested prep items in schema)
  const orders = await db.order.findMany({
    where: {
      locationId,
      status: { in: ['completed', 'paid'] },
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      items: {
        where: { deletedAt: null },
        include: {
          menuItem: {
            include: {
              recipe: {
                include: {
                  ingredients: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                      prepItem: {
                        include: {
                          ingredients: {
                            include: {
                              inventoryItem: {
                                select: {
                                  id: true,
                                  name: true,
                                  category: true,
                                  department: true,
                                  storageUnit: true,
                                  costPerUnit: true,
                                  yieldCostPerUnit: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
              // Liquor recipes from Liquor Builder (RecipeIngredient -> BottleProduct -> InventoryItem)
              recipeIngredients: {
                where: { deletedAt: null },
                include: {
                  bottleProduct: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          modifiers: {
            include: {
              modifier: {
                include: {
                  inventoryLink: {
                    include: {
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                  // Fallback: Modifier.ingredientId → Ingredient → InventoryItem
                  ingredient: {
                    select: {
                      id: true,
                      inventoryItemId: true,
                      standardQuantity: true,
                      standardUnit: true,
                      inventoryItem: {
                        select: {
                          id: true,
                          name: true,
                          category: true,
                          department: true,
                          storageUnit: true,
                          costPerUnit: true,
                          yieldCostPerUnit: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  // Aggregate theoretical usage
  const usageMap = new Map<string, TheoreticalUsageItem>()

  function addUsage(item: InventoryItemData, quantity: number): void {
    // Filter by department if specified (case-insensitive)
    if (department && item.department.toLowerCase() !== department.toLowerCase()) {
      return
    }

    const existing = usageMap.get(item.id)
    const cost = getEffectiveCost(item)

    if (existing) {
      existing.theoreticalUsage += quantity
      existing.totalCost += quantity * cost
    } else {
      usageMap.set(item.id, {
        inventoryItemId: item.id,
        name: item.name,
        category: item.category,
        department: item.department,
        theoreticalUsage: quantity,
        unit: item.storageUnit,
        costPerUnit: cost,
        totalCost: quantity * cost,
      })
    }
  }

  // Process each order item
  for (const order of orders) {
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      // Build a set of inventory item IDs that have "NO" modifiers on this order item
      // This allows us to skip base recipe ingredients that were explicitly removed
      const removedIngredientIds = new Set<string>()
      for (const mod of orderItem.modifiers) {
        if (isRemovalInstruction(mod.preModifier)) {
          // Check inventoryLink path (primary)
          if (mod.modifier?.inventoryLink?.inventoryItemId) {
            removedIngredientIds.add(mod.modifier.inventoryLink.inventoryItemId)
          }
          // Check ingredient path (fallback)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else if ((mod.modifier as any)?.ingredient?.inventoryItem?.id) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            removedIngredientIds.add((mod.modifier as any).ingredient.inventoryItem.id)
          }
        }
      }

      // Process recipe ingredients (MenuItemRecipe system)
      if (orderItem.menuItem?.recipe) {
        for (const ing of orderItem.menuItem.recipe.ingredients) {
          // Skip ingredients that were explicitly removed with "NO" modifier
          if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
            continue
          }

          const ingQty = toNumber(ing.quantity) * itemQty

          if (ing.inventoryItem) {
            // Direct inventory item
            addUsage(ing.inventoryItem as InventoryItemData, ingQty)
          } else if (ing.prepItem) {
            // Recursively explode prep item to raw ingredients
            const exploded = explodePrepItem(
              ing.prepItem as PrepItemWithIngredients,
              ingQty,
              ing.unit
            )
            for (const exp of exploded) {
              // Also skip exploded ingredients that were explicitly removed
              if (!removedIngredientIds.has(exp.inventoryItem.id)) {
                addUsage(exp.inventoryItem, exp.quantity)
              }
            }
          }
        }
      }

      // Process liquor recipe ingredients (RecipeIngredient -> BottleProduct -> InventoryItem)
      // This handles cocktails created via the Liquor Builder
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
      if (recipeIngredients && Array.isArray(recipeIngredients)) {
        for (const ing of recipeIngredients) {
          // Get the linked inventory item from the bottle product
          const inventoryItem = ing.bottleProduct?.inventoryItem
          if (!inventoryItem) continue

          // Skip if this inventory item was explicitly removed with "NO" modifier
          if (removedIngredientIds.has(inventoryItem.id)) {
            continue
          }

          // Calculate pour quantity in oz
          // pourCount * itemQty * (pourSizeOz or location default 1.5oz)
          const pourCount = toNumber(ing.pourCount) || 1
          const pourSizeOz = toNumber(ing.pourSizeOz) || toNumber(ing.bottleProduct?.pourSizeOz) || 1.5
          const totalOz = pourCount * pourSizeOz * itemQty

          // Add usage - inventory is tracked in oz for liquor items
          addUsage(inventoryItem as InventoryItemData, totalOz)
        }
      }

      // Process modifier ingredients with instruction multipliers
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty

        // Get the multiplier based on the instruction (preModifier: "lite", "extra", etc.)
        const preModifier = mod.preModifier
        const multiplier = getModifierMultiplier(preModifier, multiplierSettings || undefined)

        // If multiplier is 0 (e.g., "NO"), skip this modifier entirely
        if (multiplier === 0) continue

        // Path A: ModifierInventoryLink (takes precedence)
        if (mod.modifier?.inventoryLink?.inventoryItem) {
          const link = mod.modifier.inventoryLink
          const linkItem = link.inventoryItem as InventoryItemData

          let linkQty = toNumber(link.usageQuantity) * modQty * multiplier

          if (link.usageUnit && linkItem.storageUnit) {
            const converted = convertUnits(linkQty, link.usageUnit, linkItem.storageUnit)
            if (converted !== null) {
              linkQty = converted
            }
          }

          addUsage(linkItem, linkQty)
          continue  // inventoryLink found — skip fallback
        }

        // Path B: Modifier.ingredientId → Ingredient → InventoryItem (fallback)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ingredient = (mod.modifier as any)?.ingredient
        if (ingredient?.inventoryItem) {
          const stdQty = toNumber(ingredient.standardQuantity) || 1
          let ingQty = stdQty * modQty * multiplier

          if (ingredient.standardUnit && ingredient.inventoryItem.storageUnit) {
            const converted = convertUnits(ingQty, ingredient.standardUnit, ingredient.inventoryItem.storageUnit)
            if (converted !== null) {
              ingQty = converted
            }
          }

          addUsage(ingredient.inventoryItem as InventoryItemData, ingQty)
        }
      }
    }
  }

  // Sort by category and name
  const usage = Array.from(usageMap.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.name.localeCompare(b.name)
  })

  // Calculate totals
  const totalCost = usage.reduce((sum, item) => sum + item.totalCost, 0)

  return {
    locationId,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    department: department || 'All',
    orderCount: orders.length,
    usage,
    totalCost,
  }
}

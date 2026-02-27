/**
 * Auto-Deduction on Order Paid
 *
 * Deducts inventory when an order is paid/closed.
 */

import { Decimal } from '@prisma/client/runtime/library'
import { db } from '@/lib/db'
import type { InventoryDeductionResult, InventoryItemData, MultiplierSettings, PrepItemWithIngredients } from './types'
import { getEffectiveCost, toNumber, getModifierMultiplier, isRemovalInstruction, explodePrepItem } from './helpers'
import { convertUnits } from './unit-conversion'

/**
 * The include tree for fetching order data (shared between report and deduction)
 */
export const ORDER_INVENTORY_INCLUDE = {
  items: {
    where: { deletedAt: null, status: 'active' },
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
                      currentStock: true,
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
                              currentStock: true,
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
          // Direct bottle link on MenuItem (for simple spirit items like "Fireball Shot")
          linkedBottleProduct: {
            select: {
              id: true,
              pourSizeOz: true,
              inventoryItem: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  department: true,
                  storageUnit: true,
                  costPerUnit: true,
                  yieldCostPerUnit: true,
                  currentStock: true,
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
                      currentStock: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      // Pricing option inventory links (additive deduction for size/variant)
      pricingOption: {
        include: {
          inventoryLinks: {
            where: { deletedAt: null },
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
                  currentStock: true,
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
                          currentStock: true,
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
      modifiers: {
        include: {
          // Spirit substitution: which bottle was actually used for upgrades
          linkedBottleProduct: {
            select: {
              id: true,
              spiritCategoryId: true,
              pourSizeOz: true,
              inventoryItem: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  department: true,
                  storageUnit: true,
                  costPerUnit: true,
                  yieldCostPerUnit: true,
                  currentStock: true,
                },
              },
            },
          },
          modifier: {
            select: {
              liteMultiplier: true,
              extraMultiplier: true,
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
                      currentStock: true,
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
                      currentStock: true,
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
                              currentStock: true,
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
      },
    },
  },
} as const

/**
 * Deduct inventory for a paid order
 *
 * Called when an order is paid/closed. This function:
 * 1. Fetches the order with full recipe/modifier data
 * 2. Calculates theoretical usage using the same logic as reports
 * 3. Decrements inventory stock and creates transaction records
 *
 * This is designed to be called asynchronously (fire-and-forget) to not
 * block the payment flow.
 *
 * @param orderId - The order ID to process
 * @param employeeId - Optional employee ID for audit trail
 * @param multiplierSettings - Optional location multiplier settings
 */
export async function deductInventoryForOrder(
  orderId: string,
  employeeId?: string | null,
  multiplierSettings?: MultiplierSettings | null
): Promise<InventoryDeductionResult> {
  try {
    // Fetch the order with full recipe tree
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: ORDER_INVENTORY_INCLUDE,
    })

    if (!order) {
      return { success: false, itemsDeducted: 0, totalCost: 0, errors: ['Order not found'] }
    }

    // Build usage map (same logic as calculateTheoreticalUsage but for one order)
    const usageMap = new Map<string, {
      inventoryItemId: string
      name: string
      quantity: number
      costPerUnit: number
      storageUnit: string
      currentStock: number
    }>()

    // Type for inventory items from Prisma (with Decimal currentStock)
    type InventoryItemWithStock = {
      id: string
      name: string
      category: string
      department: string
      storageUnit: string
      costPerUnit: Decimal | number
      yieldCostPerUnit?: Decimal | number | null
      currentStock: Decimal | number
    }

    function addUsage(item: InventoryItemWithStock, quantity: number): void {
      const existing = usageMap.get(item.id)
      const cost = getEffectiveCost(item)
      const currentStock = toNumber(item.currentStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        usageMap.set(item.id, {
          inventoryItemId: item.id,
          name: item.name,
          quantity,
          costPerUnit: cost,
          storageUnit: item.storageUnit,
          currentStock,
        })
      }
    }

    // Expand combo items to their component menu items for inventory deduction
    // Combo wrappers typically have no recipe; their components do.
    const comboOrderItems = order.items.filter(
      (oi) => (oi.menuItem as any)?.itemType === 'combo'
    )
    if (comboOrderItems.length > 0) {
      const comboMenuItemIds = comboOrderItems.map(oi => oi.menuItemId)
      const comboTemplates = await db.comboTemplate.findMany({
        where: { menuItemId: { in: comboMenuItemIds }, deletedAt: null },
        include: {
          components: {
            where: { deletedAt: null, menuItemId: { not: null } },
            select: { menuItemId: true },
          },
        },
      })
      const componentMenuItemIds = comboTemplates.flatMap(t =>
        t.components.map(c => c.menuItemId!)
      )

      if (componentMenuItemIds.length > 0) {
        const componentMenuItems = await db.menuItem.findMany({
          where: { id: { in: componentMenuItemIds }, deletedAt: null },
          include: {
            recipe: {
              include: {
                ingredients: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true, name: true, category: true, department: true,
                        storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                      },
                    },
                    prepItem: {
                      include: {
                        ingredients: {
                          include: {
                            inventoryItem: {
                              select: {
                                id: true, name: true, category: true, department: true,
                                storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
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
            linkedBottleProduct: {
              select: {
                id: true, pourSizeOz: true,
                inventoryItem: {
                  select: {
                    id: true, name: true, category: true, department: true,
                    storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                  },
                },
              },
            },
            recipeIngredients: {
              where: { deletedAt: null },
              include: {
                bottleProduct: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true, name: true, category: true, department: true,
                        storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
        const componentMap = new Map(componentMenuItems.map(mi => [mi.id, mi]))

        // Build a map of combo menuItemId -> component menuItemIds
        const comboComponentMap = new Map<string, string[]>()
        for (const t of comboTemplates) {
          comboComponentMap.set(t.menuItemId, t.components.map(c => c.menuItemId!))
        }

        // Process each combo order item's components
        for (const comboItem of comboOrderItems) {
          const componentIds = comboComponentMap.get(comboItem.menuItemId) || []
          for (const compId of componentIds) {
            const compMenuItem = componentMap.get(compId)
            if (!compMenuItem) continue
            const compQty = comboItem.quantity

            // Process recipe ingredients for this component
            if (compMenuItem.recipe) {
              for (const ing of compMenuItem.recipe.ingredients) {
                const ingQty = toNumber(ing.quantity) * compQty
                if (ing.inventoryItem) {
                  addUsage(ing.inventoryItem, ingQty)
                } else if (ing.prepItem) {
                  const exploded = explodePrepItem(ing.prepItem as PrepItemWithIngredients, ingQty, ing.unit)
                  for (const exp of exploded) {
                    addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
                  }
                }
              }
            }

            // Process liquor recipe ingredients for this component
            const compRecipeIngs = (compMenuItem as any)?.recipeIngredients
            if (compRecipeIngs && Array.isArray(compRecipeIngs)) {
              for (const ing of compRecipeIngs) {
                const inventoryItem = ing.bottleProduct?.inventoryItem
                if (!inventoryItem) continue
                const pourCount = toNumber(ing.pourCount) || 1
                const pourSizeOz = toNumber(ing.pourSizeOz) || toNumber(ing.bottleProduct?.pourSizeOz) || 1.5
                const totalOz = pourCount * pourSizeOz * compQty
                addUsage(inventoryItem, totalOz)
              }
            }

            // Process direct bottle link
            const linkedBottle = (compMenuItem as any)?.linkedBottleProduct
            if (linkedBottle?.inventoryItem && (!compRecipeIngs || compRecipeIngs.length === 0)) {
              const pourSizeOz = toNumber(linkedBottle.pourSizeOz) || 1.5
              const totalOz = pourSizeOz * compQty
              addUsage(linkedBottle.inventoryItem as InventoryItemWithStock, totalOz)
            }
          }
        }
      }
    }

    // Process each order item
    for (const orderItem of order.items) {
      // Skip combo wrapper items — their components were already processed above
      if ((orderItem.menuItem as any)?.itemType === 'combo') continue
      // For weight-based items, the deduction multiplier uses net weight from scale
      // (e.g., 2 bags of 0.5 lb each → 0.5 × 2 = 1.0 lb total deduction)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const soldByWeight = (orderItem.menuItem as any)?.soldByWeight === true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemWeight = soldByWeight ? toNumber((orderItem as any).weight) : 0
      const itemQty = (soldByWeight && itemWeight > 0)
        ? itemWeight * orderItem.quantity
        : orderItem.quantity

      // Build a set of inventory item IDs that have "NO" modifiers on this order item
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
        // T-006: apply pour size multiplier once per order item
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
        for (const ing of orderItem.menuItem.recipe.ingredients) {
          // Skip ingredients that were explicitly removed with "NO" modifier
          if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
            continue
          }

          const ingQty = toNumber(ing.quantity) * itemQty * pourMult

          if (ing.inventoryItem) {
            // Direct inventory item
            addUsage(ing.inventoryItem, ingQty)
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
                addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
              }
            }
          }
        }
      }

      // Process liquor recipe ingredients (RecipeIngredient -> BottleProduct -> InventoryItem)
      // This handles cocktails created via the Liquor Builder.
      // Spirit upgrades (e.g. Call/Premium/Top shelf) are reflected by OrderItemModifier.linkedBottleProductId —
      // when set, that bottle's InventoryItem is deducted instead of the recipe's default bottle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
      if (recipeIngredients && Array.isArray(recipeIngredients)) {
        // Build spirit substitution map: spiritCategoryId → linked bottle's inventory info
        const spiritSubstitutions = new Map<string, { inventoryItem: InventoryItemWithStock; pourSizeOz: number | null }>()
        for (const mod of orderItem.modifiers) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lb = (mod as any).linkedBottleProduct
          if (lb?.spiritCategoryId && lb.inventoryItem) {
            spiritSubstitutions.set(lb.spiritCategoryId, {
              inventoryItem: lb.inventoryItem as InventoryItemWithStock,
              pourSizeOz: lb.pourSizeOz ? toNumber(lb.pourSizeOz) : null,
            })
          }
        }

        for (const ing of recipeIngredients) {
          // Check for spirit substitution — if the customer upgraded their spirit tier,
          // deduct from the substituted bottle's InventoryItem instead of the default.
          const substitution = ing.bottleProduct?.spiritCategoryId
            ? spiritSubstitutions.get(ing.bottleProduct.spiritCategoryId)
            : undefined
          const inventoryItem = substitution?.inventoryItem ?? ing.bottleProduct?.inventoryItem
          if (!inventoryItem) continue

          // Skip if this inventory item was explicitly removed with "NO" modifier
          if (removedIngredientIds.has(inventoryItem.id)) {
            continue
          }

          // Calculate pour quantity in oz
          // pourCount * itemQty * pourSizeOz * pourMultiplier (T-006)
          const pourCount = toNumber(ing.pourCount) || 1
          // Use the substituted bottle's pour size if available (different spirit may have different pour size)
          const pourSizeOz =
            substitution?.pourSizeOz ??
            toNumber(ing.pourSizeOz) ??
            toNumber(ing.bottleProduct?.pourSizeOz) ??
            1.5
          // T-006: apply pour size multiplier once per order item
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
          const totalOz = pourCount * pourSizeOz * itemQty * pourMult

          // Add usage - inventory is tracked in oz for liquor items
          addUsage(inventoryItem, totalOz)
        }
      }

      // Process direct bottle link on MenuItem (simple spirit items like "Fireball Shot")
      // Only deduct if there are NO recipeIngredients — prevents double-counting for drinks
      // that have both a linked bottle AND recipe ingredients.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const linkedBottle = (orderItem.menuItem as any)?.linkedBottleProduct
      if (linkedBottle?.inventoryItem && (!recipeIngredients || recipeIngredients.length === 0)) {
        const pourSizeOz =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          toNumber((orderItem.menuItem as any)?.linkedPourSizeOz) ??
          toNumber(linkedBottle.pourSizeOz) ??
          1.5
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
        const totalOz = pourSizeOz * itemQty * pourMult

        if (!removedIngredientIds.has(linkedBottle.inventoryItem.id)) {
          addUsage(linkedBottle.inventoryItem as InventoryItemWithStock, totalOz)
        }
      }

      // Process modifier ingredients with instruction multipliers
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty

        // Get the multiplier based on the instruction.
        // If the modifier has per-modifier liteMultiplier/extraMultiplier set, build an
        // effective settings object that overrides the location-level values for this modifier.
        const preModifier = mod.preModifier
        const normalized = preModifier?.toUpperCase().trim()
        const perModSettings: typeof multiplierSettings = { ...multiplierSettings }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const modRecord = (mod.modifier as any)
        if (modRecord?.liteMultiplier !== null && modRecord?.liteMultiplier !== undefined) {
          perModSettings.multiplierLite = Number(modRecord.liteMultiplier)
        }
        if (modRecord?.extraMultiplier !== null && modRecord?.extraMultiplier !== undefined) {
          // 'extra' and 'double' both map to multiplierExtra in getModifierMultiplier
          perModSettings.multiplierExtra = Number(modRecord.extraMultiplier)
        }
        const multiplier = getModifierMultiplier(preModifier, perModSettings || undefined)

        // If multiplier is 0 (e.g., "NO"), skip this modifier entirely
        if (multiplier === 0) continue

        // Path A: ModifierInventoryLink (takes precedence)
        const link = mod.modifier?.inventoryLink
        const linkItem = link?.inventoryItem
        if (link && linkItem) {
          let linkQty = toNumber(link.usageQuantity) * modQty * multiplier

          // Apply unit conversion if needed
          if (link.usageUnit && linkItem.storageUnit) {
            const converted = convertUnits(linkQty, link.usageUnit, linkItem.storageUnit)
            if (converted !== null) {
              linkQty = converted
            } else {
              console.warn('[inventory] Unit mismatch on modifier link:', {
                modifierName: modRecord?.name,
                itemName: linkItem.name,
                fromUnit: link.usageUnit,
                toUnit: linkItem.storageUnit,
                orderId,
              })
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

          // Apply unit conversion if needed
          if (ingredient.standardUnit && ingredient.inventoryItem.storageUnit) {
            const converted = convertUnits(ingQty, ingredient.standardUnit, ingredient.inventoryItem.storageUnit)
            if (converted !== null) {
              ingQty = converted
            } else {
              console.warn('[inventory] Unit mismatch on modifier link:', {
                modifierName: modRecord?.name,
                itemName: ingredient.inventoryItem.name,
                fromUnit: ingredient.standardUnit,
                toUnit: ingredient.inventoryItem.storageUnit,
                orderId,
              })
            }
          }

          addUsage(ingredient.inventoryItem, ingQty)
        } else if (ingredient?.prepItem) {
          const stdQty = toNumber(ingredient.standardQuantity) || 1
          const exploded = explodePrepItem(
            ingredient.prepItem as PrepItemWithIngredients,
            stdQty * modQty * multiplier,
            ingredient.standardUnit || 'each'
          )
          for (const exp of exploded) {
            if (!removedIngredientIds.has(exp.inventoryItem.id)) {
              addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
            }
          }
        }
      }

      // Pricing option inventory links (additive deduction on top of base recipe)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pricingOption = (orderItem as any).pricingOption
      if (orderItem.pricingOptionId && pricingOption?.inventoryLinks) {
        for (const link of pricingOption.inventoryLinks) {
          if (link.inventoryItem) {
            let linkQty = toNumber(link.usageQuantity) * itemQty
            // Unit conversion if needed
            if (link.usageUnit && link.inventoryItem.storageUnit) {
              const converted = convertUnits(linkQty, link.usageUnit, link.inventoryItem.storageUnit)
              if (converted !== null) linkQty = converted
            }
            addUsage(link.inventoryItem as InventoryItemWithStock, linkQty)
          } else if (link.prepItem) {
            // Explode prep item to raw ingredients
            const exploded = explodePrepItem(
              link.prepItem as PrepItemWithIngredients,
              toNumber(link.usageQuantity) * itemQty,
              link.usageUnit || 'each'
            )
            for (const exp of exploded) {
              addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
            }
          }
        }
      }
    }

    // Now perform the actual deductions in a transaction
    const usageItems = Array.from(usageMap.values())

    if (usageItems.length === 0) {
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Execute all deductions atomically in an interactive transaction.
    // Read currentStock INSIDE the transaction (after decrement) for accurate snapshots.
    await db.$transaction(async (tx) => {
      for (const item of usageItems) {
        const totalCost = item.quantity * item.costPerUnit

        // Decrement stock first
        const updated = await tx.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: { decrement: item.quantity },
          },
          select: { currentStock: true },
        })

        // Post-decrement stock is the authoritative "after" value
        const quantityAfter = toNumber(updated.currentStock)
        const quantityBefore = quantityAfter + item.quantity

        // Create transaction record with accurate snapshot
        await tx.inventoryItemTransaction.create({
          data: {
            locationId: order.locationId,
            inventoryItemId: item.inventoryItemId,
            type: 'sale',
            quantityBefore,
            quantityChange: -item.quantity,
            quantityAfter,
            unitCost: item.costPerUnit,
            totalCost,
            reason: `Order #${order.orderNumber}`,
            referenceType: 'order',
            referenceId: orderId,
          },
        })
      }
    })

    const totalCost = usageItems.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0)

    return {
      success: true,
      itemsDeducted: usageItems.length,
      totalCost,
    }
  } catch (error) {
    console.error('Failed to deduct inventory for order:', error)
    return {
      success: false,
      itemsDeducted: 0,
      totalCost: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

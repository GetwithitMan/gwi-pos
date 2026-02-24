/**
 * Waste Path: Voided Items That Were Made
 *
 * Deducts inventory for voided order items when the food was actually prepared.
 * Also includes restore logic for reversing deductions when items are un-voided.
 */

import { Decimal } from '@prisma/client/runtime/library'
import { db } from '@/lib/db'
import type { InventoryDeductionResult, MultiplierSettings, PrepItemWithIngredients } from './types'
import { getEffectiveCost, toNumber, getModifierMultiplier, isRemovalInstruction, explodePrepItem } from './helpers'
import { convertUnits } from './unit-conversion'

/**
 * Reverse inventory deductions when a voided/comped item is restored to active.
 * Finds all waste transactions for this item and creates positive adjustment transactions
 * to undo them. Prevents double inventory credit on re-void.
 */
export async function restoreInventoryForRestoredItem(
  orderItemId: string,
  locationId: string,
): Promise<{ success: boolean; itemsRestored: number }> {
  try {
    // Find all waste transactions that were created for this voided item
    const wasteTransactions = await db.inventoryItemTransaction.findMany({
      where: {
        referenceType: 'void',
        referenceId: orderItemId,
        type: 'waste',
      },
      include: {
        inventoryItem: {
          select: { id: true, currentStock: true },
        },
      },
    })

    if (wasteTransactions.length === 0) {
      return { success: true, itemsRestored: 0 }
    }

    // Create reversal transactions and restore stock
    const operations = wasteTransactions.flatMap(tx => {
      const restoreQty = Math.abs(toNumber(tx.quantityChange))
      const currentStock = toNumber(tx.inventoryItem.currentStock)

      return [
        // Increment stock back
        db.inventoryItem.update({
          where: { id: tx.inventoryItemId },
          data: { currentStock: { increment: restoreQty } },
        }),
        // Create adjustment transaction record
        db.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: tx.inventoryItemId,
            type: 'adjustment',
            quantityBefore: currentStock,
            quantityChange: restoreQty,
            quantityAfter: currentStock + restoreQty,
            unitCost: toNumber(tx.unitCost),
            totalCost: -(toNumber(tx.totalCost)),
            reason: `Restored: item un-voided (reversal of waste txn ${tx.id})`,
            referenceType: 'void_reversal',
            referenceId: orderItemId,
          },
        }),
      ]
    })

    await db.$transaction(operations)

    return { success: true, itemsRestored: wasteTransactions.length }
  } catch (error) {
    console.error('[Inventory] Failed to restore inventory for restored item:', error)
    return { success: false, itemsRestored: 0 }
  }
}

/**
 * Void reasons that indicate food/drink was made and should still deduct inventory
 */
export const WASTE_VOID_REASONS = [
  'kitchen_error',
  'customer_disliked',
  'wrong_order',
  'remade',
  'quality_issue',
]

/**
 * Deduct inventory for a voided order item when the food was actually made
 *
 * Called when an order item is voided with a reason indicating the item was prepared
 * (e.g., "Kitchen Error", "Customer Disliked"). This still deducts inventory
 * and also creates a waste log entry.
 *
 * @param orderItemId - The order item ID being voided
 * @param voidReason - The reason for voiding
 * @param employeeId - Optional employee ID for audit trail
 * @param multiplierSettings - Optional location multiplier settings
 */
export async function deductInventoryForVoidedItem(
  orderItemId: string,
  voidReason: string,
  employeeId?: string | null,
  multiplierSettings?: MultiplierSettings | null
): Promise<InventoryDeductionResult> {
  try {
    // Normalize the void reason
    const normalizedReason = voidReason.toLowerCase().replace(/\s+/g, '_')

    // Check if this is a waste-type void (food was made)
    if (!WASTE_VOID_REASONS.includes(normalizedReason)) {
      // Not a waste void - no inventory deduction needed
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Fetch the order item with full recipe tree
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: { select: { locationId: true, orderNumber: true } },
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
        modifiers: {
          include: {
            // BUG #382: Include linkedBottleProduct for spirit substitutions on void
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
    })

    if (!orderItem || !orderItem.order) {
      return { success: false, itemsDeducted: 0, totalCost: 0, errors: ['Order item not found'] }
    }

    const { locationId, orderNumber } = orderItem.order
    const itemQty = orderItem.quantity

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

    // Build usage map
    const usageMap = new Map<string, {
      inventoryItemId: string
      name: string
      quantity: number
      costPerUnit: number
      storageUnit: string
      currentStock: number
    }>()

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

    // Build removed ingredient set from "NO" modifiers
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

    // Combo expansion: if this voided item is a combo, expand to its component menu items
    // and process each component's recipe for waste deduction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isCombo = (orderItem.menuItem as any)?.itemType === 'combo'
    if (isCombo) {
      const comboTemplate = await db.comboTemplate.findFirst({
        where: { menuItemId: orderItem.menuItemId, deletedAt: null },
        include: {
          components: {
            where: { deletedAt: null, menuItemId: { not: null } },
            select: { menuItemId: true },
          },
        },
      })
      const componentMenuItemIds = comboTemplate?.components.map(c => c.menuItemId!) || []
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
          },
        })

        for (const compMenuItem of componentMenuItems) {
          // Process food recipes
          if (compMenuItem.recipe) {
            for (const ing of compMenuItem.recipe.ingredients) {
              const ingQty = toNumber(ing.quantity) * itemQty
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

          // Process liquor recipe ingredients
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const compRecipeIngs = (compMenuItem as any)?.recipeIngredients
          if (compRecipeIngs && Array.isArray(compRecipeIngs)) {
            for (const ing of compRecipeIngs) {
              const inventoryItem = ing.bottleProduct?.inventoryItem
              if (!inventoryItem) continue
              const pourCount = toNumber(ing.pourCount) || 1
              const pourSizeOz = toNumber(ing.pourSizeOz) || toNumber(ing.bottleProduct?.pourSizeOz) || 1.5
              const totalOz = pourCount * pourSizeOz * itemQty
              addUsage(inventoryItem, totalOz)
            }
          }

          // Process direct bottle link
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const linkedBottle = (compMenuItem as any)?.linkedBottleProduct
          if (linkedBottle?.inventoryItem && (!compRecipeIngs || compRecipeIngs.length === 0)) {
            const pourSizeOz = toNumber(linkedBottle.pourSizeOz) || 1.5
            const totalOz = pourSizeOz * itemQty
            addUsage(linkedBottle.inventoryItem as InventoryItemWithStock, totalOz)
          }
        }
      }
    }

    // Process recipe ingredients (skip for combos — handled above)
    if (!isCombo && orderItem.menuItem?.recipe) {
      // BUG #381: apply pour multiplier (matches paid path)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
      for (const ing of orderItem.menuItem.recipe.ingredients) {
        if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
          continue
        }

        const ingQty = toNumber(ing.quantity) * itemQty * pourMult

        if (ing.inventoryItem) {
          addUsage(ing.inventoryItem, ingQty)
        } else if (ing.prepItem) {
          const exploded = explodePrepItem(
            ing.prepItem as PrepItemWithIngredients,
            ingQty,
            ing.unit
          )
          for (const exp of exploded) {
            if (!removedIngredientIds.has(exp.inventoryItem.id)) {
              addUsage(exp.inventoryItem as InventoryItemWithStock, exp.quantity)
            }
          }
        }
      }
    }

    // Process liquor recipe ingredients (RecipeIngredient -> BottleProduct -> InventoryItem)
    // This handles cocktails created via the Liquor Builder (skip for combos — handled above)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
    if (!isCombo && recipeIngredients && Array.isArray(recipeIngredients)) {
      // BUG #382: Build spirit substitution map (matches paid path)
      // When a customer upgrades their spirit tier, the modifier's linkedBottleProduct
      // tells us which bottle was actually used instead of the recipe's default.
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
        const pourCount = toNumber(ing.pourCount) || 1
        // Use the substituted bottle's pour size if available
        const pourSizeOz =
          substitution?.pourSizeOz ??
          toNumber(ing.pourSizeOz) ??
          toNumber(ing.bottleProduct?.pourSizeOz) ??
          1.5
        // BUG #381: apply pour multiplier (matches paid path)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
        const totalOz = pourCount * pourSizeOz * itemQty * pourMult

        // Add usage - inventory is tracked in oz for liquor items
        addUsage(inventoryItem, totalOz)
      }
    }

    // Process direct bottle link on MenuItem (simple spirit items like "Fireball Shot")
    // Only deduct if there are NO recipeIngredients — prevents double-counting
    // (skip for combos — handled above)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linkedBottle = (orderItem.menuItem as any)?.linkedBottleProduct
    if (!isCombo && linkedBottle?.inventoryItem && (!recipeIngredients || recipeIngredients.length === 0)) {
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

    // Process modifier ingredients
    for (const mod of orderItem.modifiers) {
      const modQty = (mod.quantity || 1) * itemQty

      // BUG #381: per-modifier liteMultiplier/extraMultiplier overrides (matches paid path)
      const preModifier = mod.preModifier
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const perModSettings: typeof multiplierSettings = { ...multiplierSettings } as any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const modRecord = (mod.modifier as any)
      if (modRecord?.liteMultiplier !== null && modRecord?.liteMultiplier !== undefined) {
        (perModSettings as any).multiplierLite = Number(modRecord.liteMultiplier)
      }
      if (modRecord?.extraMultiplier !== null && modRecord?.extraMultiplier !== undefined) {
        (perModSettings as any).multiplierExtra = Number(modRecord.extraMultiplier)
      }
      const multiplier = getModifierMultiplier(preModifier, perModSettings || undefined)

      if (multiplier === 0) continue

      // Path A: ModifierInventoryLink (takes precedence)
      const link = mod.modifier?.inventoryLink
      const linkItem = link?.inventoryItem
      if (link && linkItem) {
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

        addUsage(ingredient.inventoryItem, ingQty)
      }
    }

    // Perform deductions
    const usageItems = Array.from(usageMap.values())

    if (usageItems.length === 0) {
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Build transaction array - includes both stock decrement and waste log entries
    const operations = usageItems.flatMap(item => {
      const totalCost = item.quantity * item.costPerUnit
      const newStock = item.currentStock - item.quantity

      return [
        // Decrement stock
        db.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: { decrement: item.quantity },
          },
        }),
        // Create transaction record (type: waste)
        db.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: item.inventoryItemId,
            type: 'waste',
            quantityBefore: item.currentStock,
            quantityChange: -item.quantity,
            quantityAfter: newStock,
            unitCost: item.costPerUnit,
            totalCost,
            reason: `Void: ${voidReason} (Order #${orderNumber})`,
            referenceType: 'void',
            referenceId: orderItemId,
          },
        }),
        // Create waste log entry
        db.wasteLogEntry.create({
          data: {
            locationId,
            inventoryItemId: item.inventoryItemId,
            quantity: item.quantity,
            unit: item.storageUnit,
            reason: voidReason,
            costImpact: totalCost,
            employeeId: employeeId || null,
            notes: `Auto-logged from voided order item (Order #${orderNumber})`,
          },
        }),
      ]
    })

    // Execute atomically
    await db.$transaction(operations)

    const totalCost = usageItems.reduce((sum, item) => sum + item.quantity * item.costPerUnit, 0)

    return {
      success: true,
      itemsDeducted: usageItems.length,
      totalCost,
    }
  } catch (error) {
    console.error('Failed to deduct inventory for voided item:', error)
    return {
      success: false,
      itemsDeducted: 0,
      totalCost: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

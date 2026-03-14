/**
 * Waste Path: Voided Items That Were Made
 *
 * Deducts inventory for voided order items when the food was actually prepared.
 * Also includes restore logic for reversing deductions when items are un-voided,
 * and full-order inventory restoration when all payments are voided/refunded.
 */

import { Decimal } from '@prisma/client/runtime/library'
import { db } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import type { InventoryDeductionResult, MultiplierSettings, PrepItemWithIngredients } from './types'
import { getEffectiveCost, toNumber, getModifierMultiplier, isRemovalInstruction, explodePrepItem } from './helpers'
import { convertUnits } from './unit-conversion'
import { autoClear86ForRestockedItems } from './order-deduction'

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

    // Interactive transaction: update stock FIRST, then read post-update value
    // for accurate before/after audit trail (prevents TOCTOU race).
    await db.$transaction(async (txClient) => {
      for (const wasteTx of wasteTransactions) {
        const restoreQty = Math.abs(toNumber(wasteTx.quantityChange))

        // Increment stock first
        const updated = await txClient.inventoryItem.update({
          where: { id: wasteTx.inventoryItemId },
          data: { currentStock: { increment: restoreQty } },
          select: { currentStock: true },
        })

        // Post-increment stock is the authoritative "after" value
        const quantityAfter = toNumber(updated.currentStock)
        const quantityBefore = quantityAfter - restoreQty

        // Create adjustment transaction record with accurate snapshot
        await txClient.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: wasteTx.inventoryItemId,
            type: 'adjustment',
            quantityBefore,
            quantityChange: restoreQty,
            quantityAfter,
            unitCost: toNumber(wasteTx.unitCost),
            totalCost: -(toNumber(wasteTx.totalCost)),
            reason: `Restored: item un-voided (reversal of waste txn ${wasteTx.id})`,
            referenceType: 'void_reversal',
            referenceId: orderItemId,
          },
        })
      }
    })

    return { success: true, itemsRestored: wasteTransactions.length }
  } catch (error) {
    console.error('[Inventory] Failed to restore inventory for restored item:', error)
    return { success: false, itemsRestored: 0 }
  }
}

/**
 * Restore all inventory deductions for an entire order.
 *
 * Called when all payments on an order are voided or fully refunded, meaning
 * the sale is fully reversed. Finds all `type: 'sale'` transactions created
 * by `deductInventoryForOrder()` and creates compensating `type: 'adjustment'`
 * transactions to restore the stock.
 *
 * Idempotent: if a restoration has already been performed (matching
 * `referenceType: 'order_reversal'` transactions exist), it will not
 * double-restore.
 *
 * @param orderId - The order whose sale deductions should be reversed
 * @param locationId - The location for the new adjustment transactions
 * @param prisma - Optional PrismaClient to use (defaults to global `db`)
 */
export async function restoreInventoryForOrder(
  orderId: string,
  locationId: string,
  prisma?: PrismaClient,
): Promise<{ success: boolean; itemsRestored: number; totalCostRestored: number }> {
  const client = prisma ?? db
  try {
    // Check if deduction has actually run — if still pending, cancel it instead of restoring
    const pendingDeduction = await (client as any).pendingDeduction.findUnique({
      where: { orderId },
    })
    if (pendingDeduction && (pendingDeduction.status === 'pending' || pendingDeduction.status === 'processing')) {
      // Deduction hasn't completed yet — cancel it instead of restoring
      await (client as any).pendingDeduction.update({
        where: { orderId },
        data: { status: 'cancelled', lastError: 'Order voided/refunded before deduction ran' },
      })
      console.log(`[Inventory] Cancelled pending deduction for order ${orderId} — order voided before deduction ran`)
      return { success: true, itemsRestored: 0, totalCostRestored: 0 }
    }

    // Idempotency: check if we already restored for this order
    const existingReversal = await (client as any).inventoryItemTransaction.findFirst({
      where: {
        referenceType: 'order_reversal',
        referenceId: orderId,
      },
      select: { id: true },
    })

    if (existingReversal) {
      console.log(`[Inventory] Skipping restoration for order ${orderId} — already reversed`)
      return { success: true, itemsRestored: 0, totalCostRestored: 0 }
    }

    // Find all sale transactions for this order
    const saleTransactions = await (client as any).inventoryItemTransaction.findMany({
      where: {
        referenceType: 'order',
        referenceId: orderId,
        type: 'sale',
      },
      include: {
        inventoryItem: {
          select: { id: true, currentStock: true },
        },
      },
    })

    if (saleTransactions.length === 0) {
      return { success: true, itemsRestored: 0, totalCostRestored: 0 }
    }

    // Execute all restorations atomically in an interactive transaction
    let totalCostRestored = 0

    await (client as any).$transaction(async (tx: any) => {
      for (const saleTx of saleTransactions) {
        const restoreQty = Math.abs(toNumber(saleTx.quantityChange))
        const unitCost = toNumber(saleTx.unitCost)

        // Increment stock
        const updated = await tx.inventoryItem.update({
          where: { id: saleTx.inventoryItemId },
          data: { currentStock: { increment: restoreQty } },
          select: { currentStock: true },
        })

        // Post-increment stock is the authoritative "after" value
        const quantityAfter = toNumber(updated.currentStock)
        const quantityBefore = quantityAfter - restoreQty
        const totalCost = restoreQty * unitCost

        // Create compensating adjustment transaction
        await tx.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: saleTx.inventoryItemId,
            type: 'adjustment',
            quantityBefore,
            quantityChange: restoreQty,
            quantityAfter,
            unitCost,
            totalCost: -(totalCost),
            reason: `Restored: all payments voided/refunded (reversal of sale txn ${saleTx.id})`,
            referenceType: 'order_reversal',
            referenceId: orderId,
          },
        })

        totalCostRestored += totalCost
      }
    })

    console.log(
      `[Inventory] Restored ${saleTransactions.length} deductions for order ${orderId}, ` +
      `total cost restored: $${totalCostRestored.toFixed(2)}`
    )

    // Auto-un-86 ingredients that were restocked above zero (fire-and-forget)
    const restockedIds = saleTransactions.map((tx: any) => tx.inventoryItemId as string)
    if (restockedIds.length > 0) {
      void autoClear86ForRestockedItems(restockedIds).catch(err =>
        console.error('[inventory] auto-un-86 after order restore failed:', err)
      )
    }

    return { success: true, itemsRestored: saleTransactions.length, totalCostRestored }
  } catch (error) {
    console.error('[Inventory] Failed to restore inventory for order:', error)
    return { success: false, itemsRestored: 0, totalCostRestored: 0 }
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
  multiplierSettings?: MultiplierSettings | null,
  deductionType: 'waste' | 'comp' = 'waste'
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
        // Pricing option inventory links (additive deduction on top of base recipe)
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
            modifier: {
              select: {
                liteMultiplier: true,
                extraMultiplier: true,
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
        // Pizza-specific inventory (toppings, sauce, cheese, crust)
        pizzaData: {
          select: {
            toppingsData: true,
            sizeId: true,
            sauceId: true,
            cheeseId: true,
            crustId: true,
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
         
        else if ((mod.modifier as any)?.ingredient?.inventoryItem?.id) {
           
          removedIngredientIds.add((mod.modifier as any).ingredient.inventoryItem.id)
        }
      }
    }

    // Combo expansion: if this voided item is a combo, expand to its component menu items
    // and process each component's recipe for waste deduction
     
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
     
    const recipeIngredients = (orderItem.menuItem as any)?.recipeIngredients
    if (!isCombo && recipeIngredients && Array.isArray(recipeIngredients)) {
      // BUG #382: Build spirit substitution map (matches paid path)
      // When a customer upgrades their spirit tier, the modifier's linkedBottleProduct
      // tells us which bottle was actually used instead of the recipe's default.
      const spiritSubstitutions = new Map<string, { inventoryItem: InventoryItemWithStock; pourSizeOz: number | null }>()
      for (const mod of orderItem.modifiers) {
        // Primary path: Modifier relation has linkedBottleProduct (Modifier model)
        let lb = (mod as any).modifier?.linkedBottleProduct
        // Fallback: OrderItemModifier only has linkedBottleProductId (no relation),
        // so fetch the BottleProduct manually if the modifier path didn't resolve it.
        if (!lb && (mod as any).linkedBottleProductId) {
          lb = await db.bottleProduct.findUnique({
            where: { id: (mod as any).linkedBottleProductId },
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
          })
        }
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
         
        const pourMult = toNumber((orderItem as any).pourMultiplier) || 1
        const totalOz = pourCount * pourSizeOz * itemQty * pourMult

        // Add usage - inventory is tracked in oz for liquor items
        addUsage(inventoryItem, totalOz)
      }
    }

    // Process direct bottle link on MenuItem (simple spirit items like "Fireball Shot")
    // Only deduct if there are NO recipeIngredients — prevents double-counting
    // (skip for combos — handled above)
     
    const linkedBottle = (orderItem.menuItem as any)?.linkedBottleProduct
    if (!isCombo && linkedBottle?.inventoryItem && (!recipeIngredients || recipeIngredients.length === 0)) {
      const pourSizeOz =
         
        toNumber((orderItem.menuItem as any)?.linkedPourSizeOz) ??
        toNumber(linkedBottle.pourSizeOz) ??
        1.5
       
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
       
      const perModSettings: typeof multiplierSettings = { ...multiplierSettings } as any
       
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

    // Pricing option inventory links (additive deduction on top of base recipe)
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

    // Pizza topping inventory deductions
    // Parse OrderItemPizza.toppingsData and deduct each topping's linked inventory
    const pizzaData = (orderItem as any).pizzaData
    if (pizzaData?.toppingsData) {
      try {
        const toppingsJson = typeof pizzaData.toppingsData === 'string'
          ? JSON.parse(pizzaData.toppingsData)
          : pizzaData.toppingsData

        const toppingEntries: Array<{
          toppingId?: string
          sections?: number[]
          amount?: string
        }> = toppingsJson.toppings || []

        if (toppingEntries.length > 0) {
          // Fetch PizzaTopping records with inventory links
          const toppingIds = toppingEntries
            .map(t => t.toppingId)
            .filter((id): id is string => !!id)

          if (toppingIds.length > 0) {
            const pizzaToppings = await db.pizzaTopping.findMany({
              where: { id: { in: toppingIds } },
              select: {
                id: true,
                name: true,
                usageQuantity: true,
                usageUnit: true,
                inventoryItemId: true,
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
            })

            const toppingMap = new Map(pizzaToppings.map(t => [t.id, t]))

            // Fetch size multiplier if available
            let sizeInventoryMultiplier = 1.0
            if (pizzaData.sizeId) {
              const size = await db.pizzaSize.findUnique({
                where: { id: pizzaData.sizeId },
                select: { inventoryMultiplier: true },
              })
              if (size?.inventoryMultiplier) {
                sizeInventoryMultiplier = toNumber(size.inventoryMultiplier) || 1.0
              }
            }

            for (const entry of toppingEntries) {
              if (!entry.toppingId) continue
              const topping = toppingMap.get(entry.toppingId)
              if (!topping?.inventoryItem) continue

              const baseUsage = toNumber(topping.usageQuantity) || 0
              if (baseUsage <= 0) continue

              // Coverage fraction: sections array length / 24 (micro-section grid)
              const sectionCount = entry.sections?.length || 24
              const coverageFraction = sectionCount / 24.0

              // Amount multiplier: light=0.5, regular=1.0, extra=2.0
              const amountMultiplier = entry.amount === 'light' ? 0.5
                : entry.amount === 'extra' ? 2.0
                : 1.0

              const totalUsage = baseUsage * coverageFraction * amountMultiplier
                * sizeInventoryMultiplier * itemQty

              // Apply unit conversion if needed
              let finalUsage = totalUsage
              if (topping.usageUnit && topping.inventoryItem.storageUnit) {
                const converted = convertUnits(
                  totalUsage,
                  topping.usageUnit,
                  topping.inventoryItem.storageUnit
                )
                if (converted !== null) {
                  finalUsage = converted
                }
              }

              addUsage(topping.inventoryItem, finalUsage)
            }
          }
        }

        // Also deduct sauce/cheese/crust inventory if linked
        // Sauce
        if (pizzaData.sauceId) {
          const sauce = await db.pizzaSauce.findUnique({
            where: { id: pizzaData.sauceId },
            select: {
              inventoryItemId: true,
              inventoryItem: {
                select: {
                  id: true, name: true, category: true, department: true,
                  storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                },
              },
            },
          })
          if (sauce?.inventoryItem) {
            addUsage(sauce.inventoryItem, 1.0 * itemQty)
          }
        }

        // Cheese
        if (pizzaData.cheeseId) {
          const cheese = await db.pizzaCheese.findUnique({
            where: { id: pizzaData.cheeseId },
            select: {
              inventoryItemId: true,
              inventoryItem: {
                select: {
                  id: true, name: true, category: true, department: true,
                  storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                },
              },
            },
          })
          if (cheese?.inventoryItem) {
            addUsage(cheese.inventoryItem, 1.0 * itemQty)
          }
        }

        // Crust
        if (pizzaData.crustId) {
          const crust = await db.pizzaCrust.findUnique({
            where: { id: pizzaData.crustId },
            select: {
              inventoryItemId: true,
              inventoryItem: {
                select: {
                  id: true, name: true, category: true, department: true,
                  storageUnit: true, costPerUnit: true, yieldCostPerUnit: true, currentStock: true,
                },
              },
            },
          })
          if (crust?.inventoryItem) {
            addUsage(crust.inventoryItem, 1.0 * itemQty)
          }
        }
      } catch (err) {
        console.warn('[VOID-WASTE] Failed to process pizza toppings for voided item:', err)
      }
    }

    // Perform deductions
    const usageItems = Array.from(usageMap.values())

    if (usageItems.length === 0) {
      return { success: true, itemsDeducted: 0, totalCost: 0 }
    }

    // Interactive transaction: decrement stock FIRST, then read post-update value
    // for accurate before/after audit trail (prevents TOCTOU race).
    await db.$transaction(async (txClient) => {
      for (const item of usageItems) {
        const totalCost = item.quantity * item.costPerUnit

        // Decrement stock first
        const updated = await txClient.inventoryItem.update({
          where: { id: item.inventoryItemId },
          data: {
            currentStock: { decrement: item.quantity },
          },
          select: { currentStock: true },
        })

        // Post-decrement stock is the authoritative "after" value
        const quantityAfter = toNumber(updated.currentStock)
        const quantityBefore = quantityAfter + item.quantity

        // Create transaction record (type: waste)
        await txClient.inventoryItemTransaction.create({
          data: {
            locationId,
            inventoryItemId: item.inventoryItemId,
            type: deductionType,
            quantityBefore,
            quantityChange: -item.quantity,
            quantityAfter,
            unitCost: item.costPerUnit,
            totalCost,
            reason: `Void: ${voidReason} (Order #${orderNumber})`,
            referenceType: 'void',
            referenceId: orderItemId,
          },
        })

        // Create waste log entry
        await txClient.wasteLogEntry.create({
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
    console.error('Failed to deduct inventory for voided item:', error)
    return {
      success: false,
      itemsDeducted: 0,
      totalCost: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

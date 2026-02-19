/**
 * Waste Path: Voided Items That Were Made
 *
 * Deducts inventory for voided order items when the food was actually prepared.
 */

import { Decimal } from '@prisma/client/runtime/library'
import { db } from '@/lib/db'
import type { InventoryDeductionResult, MultiplierSettings, PrepItemWithIngredients } from './types'
import { getEffectiveCost, toNumber, getModifierMultiplier, isRemovalInstruction, explodePrepItem } from './helpers'
import { convertUnits } from './unit-conversion'

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

    // Process recipe ingredients
    if (orderItem.menuItem?.recipe) {
      for (const ing of orderItem.menuItem.recipe.ingredients) {
        if (ing.inventoryItem && removedIngredientIds.has(ing.inventoryItem.id)) {
          continue
        }

        const ingQty = toNumber(ing.quantity) * itemQty

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

    // Process modifier ingredients
    for (const mod of orderItem.modifiers) {
      const modQty = (mod.quantity || 1) * itemQty

      const preModifier = mod.preModifier
      const multiplier = getModifierMultiplier(preModifier, multiplierSettings || undefined)

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

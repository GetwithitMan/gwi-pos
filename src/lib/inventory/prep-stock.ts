/**
 * Prep Stock Deduction (on Send to Kitchen)
 *
 * Tracks prepared ingredient usage for daily count items.
 */

import { Decimal } from '@prisma/client/runtime/library'
import { db } from '@/lib/db'
import type { PrepStockDeductionResult } from './types'
import { toNumber, getModifierMultiplier, isRemovalInstruction } from './helpers'
import { convertUnits } from './unit-conversion'

/**
 * Deduct prep stock when order items are sent to kitchen.
 * This tracks prepared ingredient usage for daily count items.
 *
 * @param orderId - The order ID
 * @param orderItemIds - Specific item IDs being sent (empty = all pending items)
 * @returns Deduction result with items deducted
 */
export async function deductPrepStockForOrder(
  orderId: string,
  orderItemIds?: string[]
): Promise<PrepStockDeductionResult> {
  try {
    // Get order with items and their ingredients
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: {
          where: orderItemIds?.length
            ? { id: { in: orderItemIds }, deletedAt: null }
            : { deletedAt: null },
          include: {
            menuItem: {
              include: {
                // Get menu item ingredients (links to Ingredient model)
                ingredients: {
                  where: { deletedAt: null },
                  include: {
                    ingredient: {
                      include: {
                        // Include child prep items
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            modifiers: {
              where: { deletedAt: null },
              include: {
                modifier: {
                  include: {
                    // Modifiers may link to ingredients
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
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

    if (!order) {
      return { success: false, deductedItems: [], errors: ['Order not found'] }
    }

    // Check if prep stock tracking is enabled for this location
    const settings = await db.inventorySettings.findUnique({
      where: { locationId: order.locationId },
    })

    // Default to enabled if no settings exist
    const trackPrepStock = settings?.trackPrepStock ?? true
    const deductPrepOnSend = settings?.deductPrepOnSend ?? true

    if (!trackPrepStock || !deductPrepOnSend) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build usage map for prep items (ingredients with isDailyCountItem = true)
    const prepUsageMap = new Map<string, {
      ingredientId: string
      name: string
      quantity: number
      unit: string
      currentStock: number
    }>()

    function addPrepUsage(ingredient: {
      id: string
      name: string
      standardUnit?: string | null
      currentPrepStock: Decimal | number
      isDailyCountItem?: boolean
    }, quantity: number): void {
      if (!ingredient.isDailyCountItem) return

      const existing = prepUsageMap.get(ingredient.id)
      const currentStock = toNumber(ingredient.currentPrepStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        prepUsageMap.set(ingredient.id, {
          ingredientId: ingredient.id,
          name: ingredient.name,
          quantity,
          unit: ingredient.standardUnit || 'each',
          currentStock,
        })
      }
    }

    // Build removed ingredient set from "NO" modifiers
    const removedIngredientIds = new Set<string>()
    for (const item of order.items) {
      for (const mod of item.modifiers) {
        const preModifier = mod.preModifier
        if (isRemovalInstruction(preModifier) && mod.modifier?.ingredient?.id) {
          removedIngredientIds.add(mod.modifier.ingredient.id)
        }
      }
    }

    // Process each order item
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      // Process menu item ingredients
      if (orderItem.menuItem?.ingredients) {
        for (const link of orderItem.menuItem.ingredients) {
          const ingredient = link.ingredient
          if (!ingredient || removedIngredientIds.has(ingredient.id)) continue

          // Use override quantity or ingredient's standard quantity
          const baseQty = link.quantity
            ? toNumber(link.quantity)
            : ingredient.standardQuantity
              ? toNumber(ingredient.standardQuantity)
              : 1

          let totalQty = baseQty * itemQty

          // Apply unit conversion if link unit differs from ingredient's standard unit
          const linkUnit = (link as { unit?: string | null }).unit
          if (linkUnit && ingredient.standardUnit && linkUnit !== ingredient.standardUnit) {
            const converted = convertUnits(totalQty, linkUnit, ingredient.standardUnit)
            if (converted !== null) totalQty = converted
          }

          // Add the ingredient itself if it's a daily count item
          if (ingredient.isDailyCountItem) {
            addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
          }

          // Also check child prep items
          if (ingredient.childIngredients) {
            for (const child of ingredient.childIngredients) {
              if (child.isDailyCountItem) {
                // Child quantity is relative to parent
                const childQty = child.standardQuantity
                  ? toNumber(child.standardQuantity) * totalQty
                  : totalQty
                addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
              }
            }
          }
        }
      }

      // Process modifier ingredients
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty
        const ingredient = mod.modifier?.ingredient

        if (!ingredient || removedIngredientIds.has(ingredient.id)) continue

        const preModifier = mod.preModifier
        const multiplier = getModifierMultiplier(preModifier, {
          multiplierLite: settings?.multiplierLite ? toNumber(settings.multiplierLite) : 0.5,
          multiplierExtra: settings?.multiplierExtra ? toNumber(settings.multiplierExtra) : 2.0,
          multiplierTriple: settings?.multiplierTriple ? toNumber(settings.multiplierTriple) : 3.0,
        })

        if (multiplier === 0) continue

        const totalQty = modQty * multiplier

        if (ingredient.isDailyCountItem) {
          addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
        }

        // Check child prep items
        if (ingredient.childIngredients) {
          for (const child of ingredient.childIngredients) {
            if (child.isDailyCountItem) {
              const childQty = child.standardQuantity
                ? toNumber(child.standardQuantity) * totalQty
                : totalQty
              addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
            }
          }
        }
      }
    }

    // Perform deductions
    const prepItems = Array.from(prepUsageMap.values())

    if (prepItems.length === 0) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build update operations
    const deductedItems: PrepStockDeductionResult['deductedItems'] = []

    const operations = prepItems.map(item => {
      const newStock = Math.max(0, item.currentStock - item.quantity)

      deductedItems.push({
        ingredientId: item.ingredientId,
        name: item.name,
        quantityDeducted: item.quantity,
        unit: item.unit,
        stockBefore: item.currentStock,
        stockAfter: newStock,
      })

      return db.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          currentPrepStock: { decrement: item.quantity },
        },
      })
    })

    // Execute atomically
    await db.$transaction(operations)

    return {
      success: true,
      deductedItems,
      errors: [],
    }
  } catch (error) {
    console.error('Failed to deduct prep stock:', error)
    return {
      success: false,
      deductedItems: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

/**
 * Restore prep stock when order items are voided (before they're made).
 * Only restores if the item hasn't been prepared yet.
 *
 * @param orderId - The order ID
 * @param orderItemIds - Specific item IDs being voided
 * @param wasMade - Whether the food was actually made (don't restore if true)
 * @returns Restoration result
 */
export async function restorePrepStockForVoid(
  orderId: string,
  orderItemIds: string[],
  wasMade: boolean = false
): Promise<PrepStockDeductionResult> {
  // Don't restore if the food was actually made
  if (wasMade) {
    return { success: true, deductedItems: [], errors: [] }
  }

  try {
    // Get order with items and their ingredients
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        items: {
          where: { id: { in: orderItemIds } },
          include: {
            menuItem: {
              include: {
                ingredients: {
                  where: { deletedAt: null },
                  include: {
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            modifiers: {
              where: { deletedAt: null },
              include: {
                modifier: {
                  include: {
                    ingredient: {
                      include: {
                        childIngredients: {
                          where: { deletedAt: null, isDailyCountItem: true },
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

    if (!order) {
      return { success: false, deductedItems: [], errors: ['Order not found'] }
    }

    // Check settings
    const settings = await db.inventorySettings.findUnique({
      where: { locationId: order.locationId },
    })

    const restorePrepOnVoid = settings?.restorePrepOnVoid ?? true

    if (!restorePrepOnVoid) {
      return { success: true, deductedItems: [], errors: [] }
    }

    // Build usage map (same logic as deduction)
    const prepUsageMap = new Map<string, {
      ingredientId: string
      name: string
      quantity: number
      unit: string
      currentStock: number
    }>()

    function addPrepUsage(ingredient: {
      id: string
      name: string
      standardUnit?: string | null
      currentPrepStock: Decimal | number
      isDailyCountItem?: boolean
    }, quantity: number): void {
      if (!ingredient.isDailyCountItem) return

      const existing = prepUsageMap.get(ingredient.id)
      const currentStock = toNumber(ingredient.currentPrepStock)

      if (existing) {
        existing.quantity += quantity
      } else {
        prepUsageMap.set(ingredient.id, {
          ingredientId: ingredient.id,
          name: ingredient.name,
          quantity,
          unit: ingredient.standardUnit || 'each',
          currentStock,
        })
      }
    }

    // Process items (same as deduction)
    for (const orderItem of order.items) {
      const itemQty = orderItem.quantity

      if (orderItem.menuItem?.ingredients) {
        for (const link of orderItem.menuItem.ingredients) {
          const ingredient = link.ingredient
          if (!ingredient) continue

          const baseQty = link.quantity
            ? toNumber(link.quantity)
            : ingredient.standardQuantity
              ? toNumber(ingredient.standardQuantity)
              : 1

          const totalQty = baseQty * itemQty

          if (ingredient.isDailyCountItem) {
            addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
          }

          if (ingredient.childIngredients) {
            for (const child of ingredient.childIngredients) {
              if (child.isDailyCountItem) {
                const childQty = child.standardQuantity
                  ? toNumber(child.standardQuantity) * totalQty
                  : totalQty
                addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
              }
            }
          }
        }
      }

      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * itemQty
        const ingredient = mod.modifier?.ingredient

        if (!ingredient) continue

        const multiplier = getModifierMultiplier(mod.preModifier, {
          multiplierLite: settings?.multiplierLite ? toNumber(settings.multiplierLite) : 0.5,
          multiplierExtra: settings?.multiplierExtra ? toNumber(settings.multiplierExtra) : 2.0,
          multiplierTriple: settings?.multiplierTriple ? toNumber(settings.multiplierTriple) : 3.0,
        })

        if (multiplier === 0) continue

        const totalQty = modQty * multiplier

        if (ingredient.isDailyCountItem) {
          addPrepUsage(ingredient as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, totalQty)
        }

        if (ingredient.childIngredients) {
          for (const child of ingredient.childIngredients) {
            if (child.isDailyCountItem) {
              const childQty = child.standardQuantity
                ? toNumber(child.standardQuantity) * totalQty
                : totalQty
              addPrepUsage(child as { id: string; name: string; standardUnit?: string | null; currentPrepStock: Decimal | number; isDailyCountItem?: boolean }, childQty)
            }
          }
        }
      }
    }

    // Perform restorations (increment instead of decrement)
    const prepItems = Array.from(prepUsageMap.values())

    if (prepItems.length === 0) {
      return { success: true, deductedItems: [], errors: [] }
    }

    const restoredItems: PrepStockDeductionResult['deductedItems'] = []

    const operations = prepItems.map(item => {
      const newStock = item.currentStock + item.quantity

      restoredItems.push({
        ingredientId: item.ingredientId,
        name: item.name,
        quantityDeducted: -item.quantity, // Negative to indicate restoration
        unit: item.unit,
        stockBefore: item.currentStock,
        stockAfter: newStock,
      })

      return db.ingredient.update({
        where: { id: item.ingredientId },
        data: {
          currentPrepStock: { increment: item.quantity },
        },
      })
    })

    await db.$transaction(operations)

    return {
      success: true,
      deductedItems: restoredItems,
      errors: [],
    }
  } catch (error) {
    console.error('Failed to restore prep stock:', error)
    return {
      success: false,
      deductedItems: [],
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

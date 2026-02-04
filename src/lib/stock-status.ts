/**
 * Stock Status Calculation Utilities
 * Determines stock status for menu items based on prep ingredient levels
 */

import { db } from '@/lib/db'
import { Decimal } from '@prisma/client/runtime/library'

export type StockStatus = 'ok' | 'low' | 'critical' | 'out'

export interface StockStatusResult {
  status: StockStatus
  lowestCount: number | null
  lowestIngredientName: string | null
  criticalIngredients: Array<{
    name: string
    currentStock: number
    threshold: number
  }>
}

/**
 * Get stock status for a single menu item based on its prep ingredients
 *
 * @param menuItemId - The menu item ID to check
 * @param locationId - The location ID for multi-tenancy
 * @returns Stock status result with worst status and details
 */
export async function getMenuItemStockStatus(
  menuItemId: string,
  locationId: string
): Promise<StockStatusResult> {
  // Get all ingredients linked to this menu item
  const menuItemIngredients = await db.menuItemIngredient.findMany({
    where: {
      menuItemId,
      deletedAt: null,
      ingredient: {
        locationId,
        deletedAt: null,
        isDailyCountItem: true, // Only check prep items
      },
    },
    include: {
      ingredient: true,
    },
  })

  // Initialize result
  let worstStatus: StockStatus = 'ok'
  let lowestCount: number | null = null
  let lowestIngredientName: string | null = null
  const criticalIngredients: Array<{
    name: string
    currentStock: number
    threshold: number
  }> = []

  // Check each prep ingredient
  for (const link of menuItemIngredients) {
    const ingredient = link.ingredient
    if (!ingredient) continue

    const currentStock = Number(ingredient.currentPrepStock)
    const criticalThreshold = ingredient.criticalStockThreshold
      ? Number(ingredient.criticalStockThreshold)
      : 5 // Default critical threshold
    const lowThreshold = ingredient.lowStockThreshold
      ? Number(ingredient.lowStockThreshold)
      : 10 // Default low threshold

    // Determine status for this ingredient
    let ingredientStatus: StockStatus = 'ok'

    if (currentStock <= 0) {
      ingredientStatus = 'out'
    } else if (currentStock <= criticalThreshold) {
      ingredientStatus = 'critical'
      criticalIngredients.push({
        name: ingredient.name,
        currentStock,
        threshold: criticalThreshold,
      })
    } else if (currentStock <= lowThreshold) {
      ingredientStatus = 'low'
    }

    // Track lowest count and worst status
    if (ingredientStatus !== 'ok') {
      if (lowestCount === null || currentStock < lowestCount) {
        lowestCount = currentStock
        lowestIngredientName = ingredient.name
      }
    }

    // Update worst status (out > critical > low > ok)
    if (ingredientStatus === 'out') {
      worstStatus = 'out'
    } else if (ingredientStatus === 'critical' && worstStatus !== 'out') {
      worstStatus = 'critical'
    } else if (ingredientStatus === 'low' && worstStatus === 'ok') {
      worstStatus = 'low'
    }
  }

  return {
    status: worstStatus,
    lowestCount,
    lowestIngredientName,
    criticalIngredients,
  }
}

/**
 * Get stock status for all menu items in a location
 * Optimized for bulk operations
 *
 * @param locationId - The location ID
 * @param menuItemIds - Optional array of specific menu item IDs to check
 * @returns Map of menuItemId to StockStatusResult
 */
export async function getAllMenuItemsStockStatus(
  locationId: string,
  menuItemIds?: string[]
): Promise<Map<string, StockStatusResult>> {
  // Build filter
  const menuItemFilter = menuItemIds
    ? { id: { in: menuItemIds } }
    : {}

  // Get all menu items with their ingredients
  const menuItems = await db.menuItem.findMany({
    where: {
      locationId,
      deletedAt: null,
      isActive: true,
      ...menuItemFilter,
    },
    select: {
      id: true,
      ingredients: {
        where: {
          deletedAt: null,
          ingredient: {
            locationId,
            deletedAt: null,
            isDailyCountItem: true,
          },
        },
        include: {
          ingredient: true,
        },
      },
    },
  })

  const statusMap = new Map<string, StockStatusResult>()

  // Process each menu item
  for (const menuItem of menuItems) {
    let worstStatus: StockStatus = 'ok'
    let lowestCount: number | null = null
    let lowestIngredientName: string | null = null
    const criticalIngredients: Array<{
      name: string
      currentStock: number
      threshold: number
    }> = []

    // Check each prep ingredient
    for (const link of menuItem.ingredients) {
      const ingredient = link.ingredient
      if (!ingredient) continue

      const currentStock = Number(ingredient.currentPrepStock)
      const criticalThreshold = ingredient.criticalStockThreshold
        ? Number(ingredient.criticalStockThreshold)
        : 5
      const lowThreshold = ingredient.lowStockThreshold
        ? Number(ingredient.lowStockThreshold)
        : 10

      let ingredientStatus: StockStatus = 'ok'

      if (currentStock <= 0) {
        ingredientStatus = 'out'
      } else if (currentStock <= criticalThreshold) {
        ingredientStatus = 'critical'
        criticalIngredients.push({
          name: ingredient.name,
          currentStock,
          threshold: criticalThreshold,
        })
      } else if (currentStock <= lowThreshold) {
        ingredientStatus = 'low'
      }

      // Track lowest count
      if (ingredientStatus !== 'ok') {
        if (lowestCount === null || currentStock < lowestCount) {
          lowestCount = currentStock
          lowestIngredientName = ingredient.name
        }
      }

      // Update worst status
      if (ingredientStatus === 'out') {
        worstStatus = 'out'
      } else if (ingredientStatus === 'critical' && worstStatus !== 'out') {
        worstStatus = 'critical'
      } else if (ingredientStatus === 'low' && worstStatus === 'ok') {
        worstStatus = 'low'
      }
    }

    statusMap.set(menuItem.id, {
      status: worstStatus,
      lowestCount,
      lowestIngredientName,
      criticalIngredients,
    })
  }

  return statusMap
}

/**
 * Convert number to number (for type safety with Decimals)
 */
function toNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  return Number(value)
}

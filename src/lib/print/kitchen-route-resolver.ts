/**
 * Kitchen Print Route Resolver
 *
 * Determines which printer(s) receive which items based on:
 *   1. PrintRoute rules (highest priority)
 *   2. Item-level printerIds
 *   3. Category-level printerIds
 *   4. Default kitchen printer
 *   5. Pizza-specific routing
 *   6. Modifier routing (follow / also / only)
 */

export interface PrintRouteEntry {
  id: string
  printerId: string | null
  backupPrinterId: string | null
  routeType: string
  categoryIds: unknown
  itemTypes: unknown
  priority: number
  isActive: boolean
}

export interface EnrichedItem {
  id: string
  name: string
  quantity: number
  seatNumber: number | null
  courseNumber: number | null
  sourceTableId: string | null
  sourceTable: { id: string; name: string; abbreviation: string | null } | null
  specialNotes: string | null
  resendCount: number
  soldByWeight: boolean | null
  weight: unknown | null
  weightUnit: string | null
  tareWeight: unknown | null
  modifiers: Array<{
    name: string
    preModifier: string | null
    depth: number
    isCustomEntry?: boolean
    isNoneSelection?: boolean
    customEntryName?: string | null
    swapTargetName?: string | null
    modifier?: {
      printerRouting?: string | null
      printerIds?: unknown
      modifierGroup?: {
        nonePrintsToKitchen?: boolean
      } | null
    } | null
  }>
  ingredientModifications: Array<{
    ingredientName: string
    modificationType: string
  }>
  pizzaData: {
    sizeId: string
    crustId: string
    cookingInstructions: string | null
    cutStyle: string | null
    toppingsData: unknown
    sauceAmount: string
    cheeseAmount: string
    size: { name: string; inches: number | null } | null
    crust: { name: string } | null
    sauce: { name: string } | null
    cheese: { name: string } | null
  } | null
  _modifierOnlyFor?: string
  _specialtyName?: string | null
  pricingOptionLabel?: string | null
  menuItem?: {
    id: string
    categoryId: string | null
    printerIds: unknown
    backupPrinterIds: unknown
    category?: {
      id: string
      name: string
      printerIds: unknown
      categoryType: string | null
    } | null
  } | null
}

export interface RouteResult {
  itemsByPrinter: Map<string, EnrichedItem[]>
  routeForPrinterMap: Map<string, PrintRouteEntry>
}

/**
 * Resolve which printers receive which items based on routing rules.
 */
export function resolveKitchenRoutes(
  enrichedItems: EnrichedItem[],
  printRoutes: PrintRouteEntry[],
  defaultKitchenPrinterId: string | null,
  pizzaPrinterIds: string[],
): RouteResult {
  const itemsByPrinter = new Map<string, EnrichedItem[]>()
  const routeForPrinterMap = new Map<string, PrintRouteEntry>()

  for (const item of enrichedItems) {
    // Pizza items go to all configured pizza printers
    if (item.pizzaData && pizzaPrinterIds.length > 0) {
      for (const printerId of pizzaPrinterIds) {
        const existing = itemsByPrinter.get(printerId) || []
        existing.push(item)
        itemsByPrinter.set(printerId, existing)
      }
      continue
    }

    // Priority: PrintRoute > Item printers > Category printers > Default kitchen printer
    let targetPrinterIds: string[] = []
    let matchedRoute: PrintRouteEntry | null = null

    // 1. Check PrintRoutes first (highest priority tier)
    for (const route of printRoutes) {
      if (!route.printerId) continue
      const routeCategoryIds = route.categoryIds as string[] | null
      const routeItemTypes = route.itemTypes as string[] | null

      if (
        route.routeType === 'category' &&
        routeCategoryIds &&
        item.menuItem?.categoryId &&
        routeCategoryIds.includes(item.menuItem.categoryId)
      ) {
        targetPrinterIds = [route.printerId]
        matchedRoute = route
        break
      } else if (
        route.routeType === 'item_type' &&
        routeItemTypes &&
        item.menuItem?.category?.categoryType &&
        routeItemTypes.includes(item.menuItem.category.categoryType)
      ) {
        targetPrinterIds = [route.printerId]
        matchedRoute = route
        break
      }
    }

    // 2. Fall back to item/category/default if no PrintRoute matched
    if (targetPrinterIds.length === 0) {
      const itemPrinterIds = item.menuItem?.printerIds as string[] | null
      const categoryPrinterIds = item.menuItem?.category?.printerIds as string[] | null

      if (itemPrinterIds && itemPrinterIds.length > 0) {
        targetPrinterIds = itemPrinterIds
      } else if (categoryPrinterIds && categoryPrinterIds.length > 0) {
        targetPrinterIds = categoryPrinterIds
      } else if (defaultKitchenPrinterId) {
        targetPrinterIds = [defaultKitchenPrinterId]
      }
    }

    if (targetPrinterIds.length === 0) {
      console.error('[Kitchen Print] No printer found for item:', item.name)
    }

    // Determine which modifiers follow the main item vs. route elsewhere
    const mainItemModifiers = item.modifiers.filter(mod => {
      const modPrinterRouting = mod.modifier?.printerRouting ?? 'follow'
      if (modPrinterRouting === 'follow') return true
      if (modPrinterRouting === 'only') return false
      return true // 'also' keeps in main item AND sends elsewhere
    })

    // Build synthetic item for main printer groups (with filtered modifiers)
    const mainItem = mainItemModifiers.length === item.modifiers.length
      ? item
      : { ...item, modifiers: mainItemModifiers }

    // Add main item to each target printer
    for (const printerId of targetPrinterIds) {
      const existing = itemsByPrinter.get(printerId) || []
      existing.push(mainItem)
      itemsByPrinter.set(printerId, existing)
      if (matchedRoute && !routeForPrinterMap.has(printerId)) {
        routeForPrinterMap.set(printerId, matchedRoute)
      }
    }

    // Handle modifier routing: 'also' and 'only' modifiers go to their own printers
    for (const mod of item.modifiers) {
      const modPrinterRouting = mod.modifier?.printerRouting ?? 'follow'
      const modPrinterIds = mod.modifier?.printerIds as string[] | null
      if (modPrinterRouting === 'follow') continue
      if (!modPrinterIds || modPrinterIds.length === 0) continue

      const syntheticItem = {
        ...item,
        modifiers: [mod],
        _modifierOnlyFor: item.name,
      } as EnrichedItem

      for (const modPrinterId of modPrinterIds) {
        const existing = itemsByPrinter.get(modPrinterId) || []
        existing.push(syntheticItem)
        itemsByPrinter.set(modPrinterId, existing)
      }
    }
  }

  return { itemsByPrinter, routeForPrinterMap }
}

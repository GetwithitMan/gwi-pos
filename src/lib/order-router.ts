/**
 * OrderRouter - Unified tag-based routing engine for POS
 *
 * Resolves which stations (printers/KDS) should receive which order items
 * based on a pub/sub tag matching system.
 *
 * Key concepts:
 * - Items have routeTags (from MenuItem or inherited from Category)
 * - Stations subscribe to tags via their tags array
 * - Expo stations receive ALL items regardless of tags
 * - Returns a manifest grouped by station for efficient printing/display
 */

import { db } from '@/lib/db'
import type {
  TemplateType,
  RoutedItem,
  RoutingManifest,
  RoutingResult,
  OrderContext,
  PizzaItemData,
  AtomicPrintConfig,
} from '@/types/routing'

/**
 * Main routing resolution class
 */
export class OrderRouter {
  /**
   * Resolve routing for all items in an order
   *
   * @param orderId - The order to route
   * @param itemIds - Optional: specific items to route (for resends)
   * @returns RoutingResult with manifests grouped by station
   */
  static async resolveRouting(
    orderId: string,
    itemIds?: string[]
  ): Promise<RoutingResult> {
    // 1. Fetch order with all necessary relations
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        table: {
          select: {
            id: true,
            name: true,
            abbreviation: true,
            virtualGroupId: true,
            virtualGroupPrimary: true,
            virtualGroupColor: true,
          },
        },
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: { id: true },
        },
        items: {
          where: itemIds ? { id: { in: itemIds } } : undefined,
          include: {
            modifiers: {
              select: {
                id: true,
                name: true,
                preModifier: true,
                depth: true,
                quantity: true,
              },
            },
            ingredientModifications: {
              select: {
                ingredientName: true,
                modificationType: true,
                swappedToModifierName: true,
              },
            },
            sourceTable: {
              select: { id: true, name: true, abbreviation: true },
            },
            pizzaData: {
              include: {
                size: { select: { name: true, inches: true } },
                crust: { select: { name: true } },
                sauce: { select: { name: true } },
                cheese: { select: { name: true } },
              },
            },
            menuItem: {
              select: {
                id: true,
                categoryId: true,
                routeTags: true,
                itemType: true,
                category: {
                  select: {
                    id: true,
                    routeTags: true,
                    categoryType: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!order) {
      throw new Error(`Order not found: ${orderId}`)
    }

    // 2. Fetch all active stations for this location
    const stations = await db.station.findMany({
      where: {
        locationId: order.locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    // 3. Get virtual group info if applicable
    let memberTables: Array<{ id: string; name: string; abbreviation: string | null }> = []
    let primaryTableName: string | null = null

    if (order.table?.virtualGroupId) {
      const groupTables = await db.table.findMany({
        where: {
          virtualGroupId: order.table.virtualGroupId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          abbreviation: true,
          virtualGroupPrimary: true,
        },
      })

      memberTables = groupTables.map((t) => ({
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
      }))

      const primary = groupTables.find((t) => t.virtualGroupPrimary)
      primaryTableName = primary?.name || null
    }

    // 4. Build order context
    const orderContext: OrderContext = {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableName: order.table?.name || null,
      tabName: order.tabName,
      employeeName:
        order.employee?.displayName ||
        `${order.employee?.firstName || ''} ${order.employee?.lastName || ''}`.trim() ||
        'Unknown',
      createdAt: order.createdAt,
      virtualGroupId: order.table?.virtualGroupId || null,
      virtualGroupColor: order.table?.virtualGroupColor || null,
      primaryTableName,
      memberTables,
    }

    // 5. Transform items with resolved tags
    const routedItems: RoutedItem[] = order.items.map((item) =>
      this.transformItem(item)
    )

    // 6. Route items to stations
    const { manifests, unroutedItems } = this.routeItemsToStations(
      routedItems,
      stations
    )

    // 7. Calculate stats
    const routingStats = {
      totalItems: routedItems.length,
      routedItems: routedItems.length - unroutedItems.length,
      stationsUsed: manifests.length,
      expoItems: manifests
        .filter((m) => m.isExpo)
        .reduce((sum, m) => sum + m.items.length, 0),
    }

    return {
      order: orderContext,
      manifests,
      unroutedItems,
      routingStats,
    }
  }

  /**
   * Transform a raw order item into a RoutedItem with resolved tags
   */
  private static transformItem(item: any): RoutedItem {
    // Resolve tags: item.routeTags > category.routeTags > auto-detect
    let routeTags: string[] = []
    let tagSource: 'item' | 'category' | 'default' = 'default'

    const itemTags = item.menuItem?.routeTags as string[] | null
    const categoryTags = item.menuItem?.category?.routeTags as string[] | null

    if (itemTags && itemTags.length > 0) {
      routeTags = itemTags
      tagSource = 'item'
    } else if (categoryTags && categoryTags.length > 0) {
      routeTags = categoryTags
      tagSource = 'category'
    } else {
      // Auto-detect based on category type or item characteristics
      routeTags = this.autoDetectTags(item)
      tagSource = 'default'
    }

    // Detect item types
    const isPizza = !!item.pizzaData
    const isEntertainment = item.menuItem?.itemType === 'timed_rental'
    const categoryType = item.menuItem?.category?.categoryType || 'food'
    const isBar = categoryType === 'liquor' || categoryType === 'drinks'

    // Transform pizza data if present
    let pizzaData: PizzaItemData | null = null
    if (item.pizzaData) {
      pizzaData = {
        id: item.pizzaData.id,
        sizeName: item.pizzaData.size?.name || 'Unknown',
        sizeInches: item.pizzaData.size?.inches,
        crustName: item.pizzaData.crust?.name || 'Regular',
        sauceName: item.pizzaData.sauce?.name,
        sauceAmount: item.pizzaData.sauceAmount || 'regular',
        cheeseName: item.pizzaData.cheese?.name,
        cheeseAmount: item.pizzaData.cheeseAmount || 'regular',
        cookingInstructions: item.pizzaData.cookingInstructions,
        cutStyle: item.pizzaData.cutStyle,
        toppingsBySection: item.pizzaData.toppingsData as Record<
          string,
          Array<{ name: string; amount: 'regular' | 'light' | 'extra' }>
        > | undefined,
      }
    }

    return {
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      seatNumber: item.seatNumber,
      sourceTableId: item.sourceTableId,
      sourceTableName: item.sourceTable?.name || null,
      sourceTableAbbrev: item.sourceTable?.abbreviation || null,
      specialNotes: item.specialNotes,
      resendCount: item.resendCount || 0,
      courseNumber: item.courseNumber,
      routeTags,
      tagSource,
      isPizza,
      isEntertainment,
      isBar,
      categoryName: item.menuItem?.category?.name || null,
      modifiers: (item.modifiers || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        preModifier: m.preModifier,
        depth: m.depth || 0,
        quantity: m.quantity || 1,
      })),
      ingredientModifications: (item.ingredientModifications || []).map((i: any) => ({
        ingredientName: i.ingredientName,
        modificationType: i.modificationType,
        swappedToModifierName: i.swappedToModifierName,
      })),
      pizzaData,
      menuItem: {
        id: item.menuItem?.id || '',
        categoryId: item.menuItem?.categoryId || '',
        categoryType: item.menuItem?.category?.categoryType || 'food',
        categoryName: item.menuItem?.category?.name,
      },
    }
  }

  /**
   * Auto-detect routing tags based on item characteristics
   * Used when no explicit routeTags are set
   */
  private static autoDetectTags(item: any): string[] {
    const tags: string[] = []
    const categoryType = item.menuItem?.category?.categoryType

    // Pizza detection (highest priority)
    if (item.pizzaData) {
      tags.push('pizza')
      return tags
    }

    // Category-based detection
    switch (categoryType) {
      case 'liquor':
      case 'drinks':
        tags.push('bar')
        break
      case 'food':
        tags.push('kitchen')
        break
      case 'entertainment':
        tags.push('entertainment')
        break
      case 'pizza':
        tags.push('pizza')
        break
      default:
        tags.push('kitchen')
    }

    return tags
  }

  /**
   * Route items to stations based on tag matching
   * Now supports Reference Items - shows other items in order for context
   */
  private static routeItemsToStations(
    items: RoutedItem[],
    stations: any[]
  ): { manifests: RoutingManifest[]; unroutedItems: RoutedItem[] } {
    const manifestMap = new Map<string, RoutingManifest>()
    const unroutedItems: RoutedItem[] = []

    // Separate expo stations from regular stations
    const expoStations = stations.filter((s) => s.isExpo)
    const regularStations = stations.filter((s) => !s.isExpo)

    // Track which items are routed to which stations (for reference items)
    const itemToStations = new Map<string, Set<string>>()

    for (const item of items) {
      let wasRouted = false
      itemToStations.set(item.id, new Set())

      // 1. Route to regular stations via tag matching
      for (const station of regularStations) {
        const stationTags = (station.tags as string[]) || []
        const matchedTags = item.routeTags.filter((tag) =>
          stationTags.includes(tag)
        )

        if (matchedTags.length > 0) {
          this.addItemToManifest(manifestMap, station, item, matchedTags, false, true)
          itemToStations.get(item.id)?.add(station.id)
          wasRouted = true
        }
      }

      // 2. Route to ALL expo stations (they see everything)
      for (const expoStation of expoStations) {
        this.addItemToManifest(
          manifestMap,
          expoStation,
          item,
          item.routeTags, // All tags for reference
          true,
          true  // Expo items are always primary
        )
        itemToStations.get(item.id)?.add(expoStation.id)
        wasRouted = true
      }

      // 3. Track unrouted items
      if (!wasRouted) {
        unroutedItems.push(item)
      }
    }

    // 4. Add reference items to each station
    // Reference items are items NOT routed to this station
    for (const [stationId, manifest] of manifestMap) {
      const station = stations.find((s) => s.id === stationId)
      const showReferenceItems = station?.showReferenceItems ?? true

      if (showReferenceItems && !manifest.isExpo) {
        // Find items that are NOT in this station's primary items
        const primaryItemIds = new Set(manifest.primaryItems.map((i) => i.id))
        const referenceItems = items.filter(
          (item) => !primaryItemIds.has(item.id)
        )
        manifest.referenceItems = referenceItems
      }

      // Legacy: populate items array with primaryItems for backwards compatibility
      manifest.items = [...manifest.primaryItems]
    }

    return {
      manifests: Array.from(manifestMap.values()),
      unroutedItems,
    }
  }

  /**
   * Add an item to a station's manifest
   * @param isPrimary - true if this is a primary item (matched tags), false for reference items
   */
  private static addItemToManifest(
    manifestMap: Map<string, RoutingManifest>,
    station: any,
    item: RoutedItem,
    matchedTags: string[],
    isExpo: boolean,
    isPrimary: boolean = true
  ): void {
    let manifest = manifestMap.get(station.id)

    if (!manifest) {
      manifest = {
        stationId: station.id,
        stationName: station.name,
        type: station.type as 'PRINTER' | 'KDS',
        ipAddress: station.ipAddress,
        port: station.port,
        template: station.templateType as TemplateType,
        printerType: station.printerType as 'thermal' | 'impact' | null,
        paperWidth: station.paperWidth,
        printSettings: station.printSettings,
        atomicPrintConfig: station.atomicPrintConfig as any || null,
        backupStationId: station.backupStationId,
        failoverTimeout: station.failoverTimeout,
        primaryItems: [],
        referenceItems: [],
        items: [],  // Legacy: populated after all routing is done
        isExpo,
        matchedTags: [],
        showReferenceItems: station.showReferenceItems ?? true,
      }

      manifestMap.set(station.id, manifest)
    }

    // Add to primary or reference items array
    if (isPrimary) {
      manifest.primaryItems.push(item)
    } else {
      manifest.referenceItems.push(item)
    }

    // Track unique matched tags
    for (const tag of matchedTags) {
      if (!manifest.matchedTags.includes(tag)) {
        manifest.matchedTags.push(tag)
      }
    }
  }

  /**
   * Get default station for a location (fallback when no tags match)
   */
  static async getDefaultStation(
    locationId: string,
    type: 'PRINTER' | 'KDS' = 'PRINTER'
  ): Promise<any | null> {
    return db.station.findFirst({
      where: {
        locationId,
        type,
        isDefault: true,
        isActive: true,
        deletedAt: null,
      },
    })
  }

  /**
   * Get all stations subscribed to a specific tag
   */
  static async getStationsForTag(
    locationId: string,
    tag: string
  ): Promise<any[]> {
    const stations = await db.station.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    return stations.filter((station) => {
      const tags = (station.tags as string[]) || []
      return tags.includes(tag) || station.isExpo
    })
  }

  /**
   * Get all expo stations for a location
   */
  static async getExpoStations(locationId: string): Promise<any[]> {
    return db.station.findMany({
      where: {
        locationId,
        isExpo: true,
        isActive: true,
        deletedAt: null,
      },
    })
  }

  /**
   * Validate that all items would be routed to at least one station
   * Useful for checking configuration before sending orders
   */
  static async validateRouting(
    locationId: string,
    itemTags: string[][]
  ): Promise<{ valid: boolean; unroutedIndexes: number[] }> {
    const stations = await db.station.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    const hasExpo = stations.some((s) => s.isExpo)
    const allStationTags = new Set<string>()

    for (const station of stations) {
      const tags = (station.tags as string[]) || []
      tags.forEach((t) => allStationTags.add(t))
    }

    const unroutedIndexes: number[] = []

    itemTags.forEach((tags, index) => {
      const hasMatch = tags.some((t) => allStationTags.has(t))
      if (!hasMatch && !hasExpo) {
        unroutedIndexes.push(index)
      }
    })

    return {
      valid: unroutedIndexes.length === 0,
      unroutedIndexes,
    }
  }
}

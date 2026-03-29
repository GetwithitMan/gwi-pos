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
 *
 * TODO: Migrate db.order.findUnique to OrderRepository.getOrderByIdWithInclude
 * once locationId is available at the call site (currently derived from the fetched order).
 * TODO: Migrate db.station.* calls once a StationRepository is created.
 */

import { db } from '@/lib/db'
import { emitToLocation } from '@/lib/socket-server'
import type {
  TemplateType,
  RoutedItem,
  RoutingManifest,
  RoutingResult,
  OrderContext,
  PizzaItemData,
} from '@/types/routing'

/**
 * Pre-fetched order data that can be passed to resolveRouting() to avoid
 * a redundant DB fetch when the caller already has the order loaded.
 */
export interface PreloadedOrderData {
  id: string
  orderNumber: number
  orderType: string
  locationId: string
  tabName: string | null
  createdAt: Date
  table?: { id: string; name: string; abbreviation?: string | null } | null
  employee?: { id: string; displayName: string | null; firstName: string | null; lastName: string | null } | null
  // Delivery customer info (from DeliveryOrder table, resolved by caller)
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
  deliveryInstructions?: string | null
  source?: string | null
}

/**
 * Main routing resolution class
 */
export class OrderRouter {
  /**
   * Resolve routing for all items in an order
   *
   * @param orderId - The order to route
   * @param itemIds - Optional: specific items to route (for resends)
   * @param preloadedOrder - Optional: pre-fetched order data to skip redundant order query
   * @param preloadedItems - Optional: pre-fetched items with routing-specific includes to skip redundant items query
   * @param preloadedStations - Optional: pre-fetched active stations to skip redundant station query
   * @returns RoutingResult with manifests grouped by station
   */
  static async resolveRouting(
    orderId: string,
    itemIds?: string[],
    preloadedOrder?: PreloadedOrderData,
    preloadedItems?: any[],
    preloadedStations?: any[],
  ): Promise<RoutingResult> {
    let orderData: PreloadedOrderData
    let items: any[]

    if (preloadedOrder) {
      // Use pre-fetched order data
      orderData = preloadedOrder

      if (preloadedItems) {
        // Use pre-fetched items — skip redundant DB fetch (-40ms)
        items = preloadedItems
      } else {
        // Only fetch items with routing-specific includes
        items = await db.orderItem.findMany({
          where: {
            orderId,
            ...(itemIds ? { id: { in: itemIds } } : {}),
          },
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
        })
      }
    } else {
      // Full fetch — order + items in one query (original behavior)
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: {
          table: {
            select: {
              id: true,
              name: true,
              abbreviation: true,
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

      // Fetch delivery info from DeliveryOrder table (raw SQL, not in Prisma schema)
      let deliveryCustomerName: string | null = null
      let deliveryPhone: string | null = null
      let deliveryAddr: string | null = null
      let deliveryNotes: string | null = null
      if (order.orderType?.startsWith('delivery')) {
        try {
          const rows: Array<{ customerName: string | null; phone: string | null; address: string | null; addressLine2: string | null; city: string | null; state: string | null; zipCode: string | null; notes: string | null }> = await db.$queryRawUnsafe(
            `SELECT "customerName", "phone", "address", "addressLine2", "city", "state", "zipCode", "notes"
             FROM "DeliveryOrder" WHERE "orderId" = $1 LIMIT 1`,
            orderId
          )
          if (rows.length > 0) {
            const row = rows[0]
            deliveryCustomerName = row.customerName
            deliveryPhone = row.phone
            const addrParts = [row.address, row.addressLine2, row.city, row.state, row.zipCode].filter(Boolean)
            deliveryAddr = addrParts.length > 0 ? addrParts.join(', ') : null
            deliveryNotes = row.notes
          }
        } catch {
          // Non-fatal: delivery info is supplementary for ticket printing
        }
      }

      orderData = {
        ...order,
        customerName: deliveryCustomerName,
        customerPhone: deliveryPhone,
        deliveryAddress: deliveryAddr,
        deliveryInstructions: deliveryNotes,
      }
      items = order.items
    }

    // 2. Fetch all active stations for this location (skip if preloaded — saves ~25ms)
    const stations = preloadedStations ?? await db.station.findMany({
      where: {
        locationId: orderData.locationId,
        isActive: true,
        deletedAt: null,
      },
    })

    // 3. Build order context
    const orderContext: OrderContext = {
      orderId: orderData.id,
      orderNumber: orderData.orderNumber,
      orderType: orderData.orderType,
      tableName: orderData.table?.name || null,
      tabName: orderData.tabName,
      employeeName:
        orderData.employee?.displayName ||
        `${orderData.employee?.firstName || ''} ${orderData.employee?.lastName || ''}`.trim() ||
        'Unknown',
      createdAt: orderData.createdAt,
      // Delivery customer info (passed through from preloaded data)
      customerName: orderData.customerName || null,
      customerPhone: orderData.customerPhone || null,
      deliveryAddress: orderData.deliveryAddress || null,
      deliveryInstructions: orderData.deliveryInstructions || null,
      source: orderData.source || null,
    }

    // 4. Transform items with resolved tags
    const routedItems: RoutedItem[] = items.map((item) =>
      this.transformItem(item)
    )

    // 5. Route items to stations
    const { manifests, unroutedItems } = this.routeItemsToStations(
      routedItems,
      stations
    )

    // K9: Defense-in-depth — verify referenced stationIds still exist.
    // When stations were preloaded from the caller, skip the re-fetch since the data is
    // fresh enough (same request lifecycle). Only re-fetch when stations came from our
    // own query above (original non-preloaded path) to guard against mid-request deletion.
    if (manifests.length > 0) {
      const currentStations = preloadedStations
        ? stations // Already validated by caller — reuse without extra round-trip
        : await db.station.findMany({
            where: {
              locationId: orderData.locationId,
              isActive: true,
              deletedAt: null,
            },
            select: { id: true },
          })
      const currentStationIds = new Set(currentStations.map((s: any) => s.id))

      const orphanedManifests = manifests.filter((m) => !currentStationIds.has(m.stationId))
      if (orphanedManifests.length > 0) {
        // Find a valid station to absorb orphaned items
        const validManifest = manifests.find((m) => currentStationIds.has(m.stationId))
        for (const orphan of orphanedManifests) {
          console.warn(
            `[OrderRouter] Station "${orphan.stationName}" (${orphan.stationId}) was deleted after routing — re-routing ${orphan.primaryItems.length} items`
          )
          if (validManifest) {
            // Move orphaned items to a valid station
            validManifest.primaryItems.push(...orphan.primaryItems)
            validManifest.items.push(...orphan.primaryItems)
          } else {
            // No valid stations remain — items become unrouted
            unroutedItems.push(...orphan.primaryItems)
          }
        }
        // Remove orphaned manifests
        const validManifests = manifests.filter((m) => currentStationIds.has(m.stationId))
        manifests.length = 0
        manifests.push(...validManifests)
      }
    }

    // 6. KDS offline fallback routing (post-processing)
    // When a KDS station's linked KDS screens are ALL offline, re-route its items
    // to a fallback station so kitchen orders don't silently vanish. Print jobs
    // still go to original station since printers may work even if KDS is offline.
    // Check is per-station, not system-wide — a grill screen being online should
    // not suppress fallback for an offline pizza screen.
    const kdsManifests = manifests.filter((m) => m.type === 'KDS' && !m.isExpo && m.primaryItems.length > 0)
    if (kdsManifests.length > 0) {
      try {
        // Batch: resolve Station names → PrepStation IDs at this location
        const kdsStationNames = kdsManifests.map((m) => m.stationName)
        const matchingPrepStations = await db.prepStation.findMany({
          where: {
            locationId: orderData.locationId,
            name: { in: kdsStationNames },
            isActive: true,
            deletedAt: null,
          },
          select: { id: true, name: true },
        })
        const prepStationByName = new Map<string, string>(matchingPrepStations.map((ps) => [ps.name, ps.id]))

        // Batch: find all KDSScreenStation links for these prep stations, include screen online status
        const prepStationIds = matchingPrepStations.map((ps) => ps.id)
        const screenLinks = prepStationIds.length > 0
          ? await db.kDSScreenStation.findMany({
              where: {
                stationId: { in: prepStationIds },
                deletedAt: null,
                kdsScreen: {
                  isActive: true,
                  deletedAt: null,
                },
              },
              select: {
                stationId: true,
                kdsScreen: {
                  select: { id: true, isOnline: true },
                },
              },
            })
          : []

        // Build a set of PrepStation IDs that have at least one online screen
        const prepStationsWithOnlineScreen = new Set<string>()
        for (const link of screenLinks) {
          if (link.kdsScreen.isOnline) {
            prepStationsWithOnlineScreen.add(link.stationId)
          }
        }

        // Determine which KDS manifests have NO online screens for their specific station
        const offlineKdsManifests: typeof kdsManifests = []
        for (const kdsManifest of kdsManifests) {
          const prepStationId = prepStationByName.get(kdsManifest.stationName)
          // Offline if: no matching PrepStation found, OR no screen links, OR no online screens
          if (!prepStationId || !prepStationsWithOnlineScreen.has(prepStationId)) {
            offlineKdsManifests.push(kdsManifest)
          }
        }

        if (offlineKdsManifests.length > 0) {
          // Find fallback targets (shared across all offline stations)
          const expoManifest = manifests.find((m) => m.isExpo)
          const firstPrinterStation = manifests.find((m) => m.type === 'PRINTER' && m.primaryItems.length > 0)

          for (const kdsManifest of offlineKdsManifests) {
            const originalStationName = kdsManifest.stationName
            const itemCount = kdsManifest.primaryItems.length

            // Fallback priority: expo station > first printer station > keep original
            if (expoManifest) {
              // Expo already has all items — just tag the manifest for operator visibility
              kdsManifest.matchedTags.push('kds-offline-fallback')
              console.warn(
                `[OrderRouter] KDS station "${originalStationName}" offline — ${itemCount} items visible on expo "${expoManifest.stationName}"`
              )
            } else if (firstPrinterStation) {
              // Move items to the printer station so a ticket prints
              firstPrinterStation.primaryItems.push(...kdsManifest.primaryItems)
              firstPrinterStation.items.push(...kdsManifest.primaryItems)
              firstPrinterStation.matchedTags.push('kds-offline-fallback')
              // Clear from the offline KDS manifest (items moved to printer)
              kdsManifest.primaryItems = []
              kdsManifest.items = []
              console.warn(
                `[OrderRouter] KDS station "${originalStationName}" offline — ${itemCount} items re-routed to printer "${firstPrinterStation.stationName}"`
              )
            } else {
              // No fallback available — keep original routing (best effort)
              kdsManifest.matchedTags.push('kds-offline-no-fallback')
              console.warn(
                `[OrderRouter] KDS station "${originalStationName}" offline — no fallback station available, keeping original routing for ${itemCount} items`
              )
            }

            // Emit socket alert so staff is aware of the offline KDS
            void emitToLocation(orderData.locationId, 'kds:station-offline', {
              stationName: originalStationName,
              stationId: kdsManifest.stationId,
              fallbackStation: expoManifest?.stationName || firstPrinterStation?.stationName || 'none',
              itemCount,
              orderId: orderData.id,
              orderNumber: orderData.orderNumber,
            }).catch(console.error)
          }

          // Remove empty manifests (items were moved to fallback)
          const nonEmptyManifests = manifests.filter((m) => m.primaryItems.length > 0 || m.isExpo)
          manifests.length = 0
          manifests.push(...nonEmptyManifests)
        }
      } catch (err) {
        // Best effort — don't block the send if fallback check fails
        console.error('[OrderRouter] KDS offline fallback check failed:', err)
      }
    }

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
      // Pricing option label
      pricingOptionLabel: item.pricingOptionLabel ?? null,
      // Weight-based item fields
      soldByWeight: item.soldByWeight ?? false,
      weight: item.weight ? Number(item.weight) : null,
      weightUnit: item.weightUnit ?? null,
      unitPrice: item.unitPrice ? Number(item.unitPrice) : null,
      tareWeight: item.tareWeight ? Number(item.tareWeight) : null,
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

      // 3. Track unrouted items — fallback route to avoid silent vanishing
      if (!wasRouted) {
        // K2: Items with no matching route tags must not silently vanish.
        // Prefer expo station > first active station > first manifest entry.
        const fallbackStation =
          expoStations[0] ||
          regularStations[0] ||
          stations[0]

        if (fallbackStation) {
          console.warn(
            `[OrderRouter] Item "${item.name}" (${item.id}) has no matching station — fallback routing to "${fallbackStation.name}" (${fallbackStation.id}). Tags: [${item.routeTags.join(', ')}]`
          )
          this.addItemToManifest(
            manifestMap,
            fallbackStation,
            item,
            item.routeTags,
            fallbackStation.isExpo ?? false,
            true
          )
          itemToStations.get(item.id)?.add(fallbackStation.id)
        } else {
          // No stations exist at all — add to unroutedItems but log critical warning
          console.warn(
            `[OrderRouter] Item "${item.name}" (${item.id}) has NO available stations at all — item will be unrouted`
          )
          unroutedItems.push(item)
        }
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

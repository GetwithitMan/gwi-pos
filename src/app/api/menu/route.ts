import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllMenuItemsStockStatus } from '@/lib/stock-status'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getMenuCache, setMenuCache, buildMenuCacheKey } from '@/lib/menu-cache'
import { getLocationId } from '@/lib/location-cache'
import { getRequestLocationId } from '@/lib/request-context'
import type { CategoryType, CategoryShow } from '@/generated/prisma/client'

// TODO: Migrate db.menuItem.findMany to MenuItemRepository once complex include+parallel shapes are supported

const VALID_CATEGORY_TYPES: readonly string[] = ['food', 'drinks', 'liquor', 'entertainment', 'combos', 'retail', 'pizza'] as const
const VALID_CATEGORY_SHOWS: readonly string[] = ['food', 'bar', 'entertainment', 'all'] as const
const MAX_MENU_ITEMS = 2000 // safety cap — no venue should have more

// Force dynamic rendering - never use Next.js cache (we have our own)
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60 // Neon cold start (5-10s) + complex query (10-20s) needs headroom

export const GET = withVenue(withTiming(async function GET(request: NextRequest) {
  const timing = getTimingFromRequest(request)

  try {
    const { searchParams } = new URL(request.url)
    const categoryTypeRaw = searchParams.get('categoryType')
    const categoryShowRaw = searchParams.get('categoryShow')

    // Validate categoryType against known enum values
    if (categoryTypeRaw && !VALID_CATEGORY_TYPES.includes(categoryTypeRaw)) {
      return NextResponse.json(
        { error: `Invalid categoryType '${categoryTypeRaw}'. Must be one of: ${VALID_CATEGORY_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate categoryShow against known enum values
    if (categoryShowRaw && !VALID_CATEGORY_SHOWS.includes(categoryShowRaw)) {
      return NextResponse.json(
        { error: `Invalid categoryShow '${categoryShowRaw}'. Must be one of: ${VALID_CATEGORY_SHOWS.join(', ')}` },
        { status: 400 }
      )
    }

    const categoryType = categoryTypeRaw as CategoryType | null
    const categoryShow = categoryShowRaw as CategoryShow | null
    const categoryId = searchParams.get('categoryId')                              // Optional: filter items to a single category
    const slim = searchParams.get('slim') === 'true'                               // Optional: omit admin/cost fields for POS grid

    // Get the location ID — prefer request context (set by proxy, zero DB cost)
    const locationId = getRequestLocationId() || await getLocationId()
    if (!locationId) {
      return NextResponse.json(
        { error: 'No location found' },
        { status: 400 }
      )
    }

    // Check server-side cache first
    const cacheKey = buildMenuCacheKey(locationId, categoryType, categoryShow) + (categoryId ? `:cat=${categoryId}` : '') + (slim ? ':slim' : '')
    const cached = getMenuCache(cacheKey)
    if (cached) {
      timing.add('cache', 0, 'Hit')
      return NextResponse.json({ data: cached })
    }

    const categoryTypeFilter = categoryType ? { categoryType } : {}
    const categoryShowFilter = categoryShow ? { categoryShow } : {}

    // Run all three queries in parallel
    timing.start('db')
    const [categories, items, stockStatusMap] = await Promise.all([
      db.category.findMany({
        where: { isActive: true, deletedAt: null, locationId, ...categoryTypeFilter, ...categoryShowFilter },
        orderBy: { sortOrder: 'asc' },
        include: {
          _count: {
            select: {
              menuItems: { where: { deletedAt: null, isActive: true } }
            }
          }
        }
      }),

      db.menuItem.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          locationId,
          ...(categoryId ? { categoryId } : {}),
          ...(categoryType ? { category: { categoryType } } : {}),
          ...(categoryShow ? { category: { categoryShow } } : {}),
        },
        take: MAX_MENU_ITEMS,
        orderBy: { sortOrder: 'asc' },
        include: {
          category: {
            select: { categoryType: true }
          },
          // When slim=true, skip modifier groups and pricing options entirely from the DB query.
          // These are only needed for full admin responses and add significant query overhead.
          ...(slim ? {} : {
            ownedModifierGroups: {
              where: { deletedAt: null },
              select: { id: true, name: true, isSpiritGroup: true, showOnline: true, sortOrder: true },
              orderBy: { sortOrder: 'asc' },
            },
            pricingOptionGroups: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
              include: {
                options: {
                  where: { deletedAt: null },
                  orderBy: { sortOrder: 'asc' },
                  select: { id: true, label: true, price: true, priceCC: true, sortOrder: true, isDefault: true, showOnPos: true, color: true },
                },
              },
            },
          }),
        }
      }),

      getAllMenuItemsStockStatus(locationId),
    ])
    timing.end('db', 'Queries')

    // Get waitlist counts for entertainment items
    const entertainmentItemIds = items
      .filter(item => item.itemType === 'timed_rental')
      .map(item => item.id)

    const waitlistCountMap = new Map<string, number>()
    if (entertainmentItemIds.length > 0) {
      const waitlistCounts = await db.$queryRaw<Array<{menuItemId: string, count: bigint}>>`
        SELECT fpe."linkedMenuItemId" as "menuItemId", COUNT(ew.id)::bigint as count
        FROM "FloorPlanElement" fpe
        JOIN "EntertainmentWaitlist" ew ON ew."elementId" = fpe.id
        WHERE fpe."linkedMenuItemId" = ANY(${entertainmentItemIds})
          AND fpe."deletedAt" IS NULL
          AND ew."deletedAt" IS NULL
          AND ew.status = 'waiting'
        GROUP BY fpe."linkedMenuItemId"
      `
      for (const row of waitlistCounts) {
        waitlistCountMap.set(row.menuItemId, Number(row.count))
      }
    }

    timing.start('map')

    // Filter out items outside their seasonal date range
    const now = new Date()
    const seasonallyAvailable = items.filter(item => {
      if (item.availableFromDate && now < item.availableFromDate) return false
      if (item.availableUntilDate && now > item.availableUntilDate) return false
      return true
    })

    // Map items with lightweight computed fields (no deep joins needed)
    const itemsWithPourCost = seasonallyAvailable.map(item => {
      const stockStatus = stockStatusMap.get(item.id)

      return {
        ...item,
        hasRecipe: false, // Recipe details loaded on-demand via /api/menu/items/[id]
        recipeIngredientCount: 0,
        totalPourCost: null as number | null,
        profitMargin: null as number | null,
        isLiquorItem: item.category?.categoryType === 'liquor',
        // Placeholder values: deep ingredient includes were removed for menu grid performance.
        // Real 86 status is computed on-demand via the item detail endpoint (/api/menu/items/[id])
        // which checks ingredient stock levels and recipe requirements.
        is86d: false,
        reasons86d: [] as string[],
        stockStatus: stockStatus?.status || 'ok',
        stockCount: stockStatus?.lowestCount || null,
        stockIngredientName: stockStatus?.lowestIngredientName || null,
        spiritTiers: null, // Spirit tiers loaded on-demand via modifier endpoint
        hasOtherModifiers: (item.ownedModifierGroups || []).filter((mg: any) => !mg.isSpiritGroup).length > 0,
      }
    })

    const responseData = {
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        categoryType: c.categoryType || 'food', // Ensure fallback for legacy data
        categoryShow: c.categoryShow || 'all', // Bartender view section (bar/food/entertainment/all)
        isActive: c.isActive,
        showOnline: c.showOnline,
        itemCount: c._count.menuItems,
        printerIds: c.printerIds,
      })),
      items: itemsWithPourCost.map(item => {
        // Pizza detection: item type OR category type
        const isPizzaItem = item.itemType === 'pizza' || item.category?.categoryType === 'pizza'

        // Core fields needed for POS grid and ordering
        const core = {
          id: item.id,
          categoryId: item.categoryId,
          categoryType: item.category?.categoryType || 'food',
          name: item.name,
          price: Number(item.price),
          priceCC: item.priceCC !== null && item.priceCC !== undefined ? Number(item.priceCC) : null,
          isActive: item.isActive,
          isAvailable: item.isAvailable,
          itemType: item.itemType,
          isPizza: isPizzaItem,
          hasModifiers: (item.ownedModifierGroups || []).length > 0 || isPizzaItem,
          timedPricing: item.timedPricing,
          minimumMinutes: item.minimumMinutes,
          commissionType: item.commissionType,
          commissionValue: item.commissionValue !== null && item.commissionValue !== undefined ? Number(item.commissionValue) : null,
          availableFrom: item.availableFrom,
          availableTo: item.availableTo,
          availableDays: item.availableDays,
          // Entertainment status for timed_rental items
          entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
          currentOrderId: item.itemType === 'timed_rental' ? item.currentOrderId : null,
          blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
          waitlistCount: item.itemType === 'timed_rental' ? (waitlistCountMap.get(item.id) || 0) : undefined,
          visualType: item.itemType === 'timed_rental' ? ((item.metadata as Record<string, unknown>)?.visualType as string || null) : null,
          modifierGroupCount: (item.ownedModifierGroups || []).length,
          modifierGroups: (item.ownedModifierGroups || []).map((mg: any) => ({
            id: mg.id,
            name: mg.name,
            showOnline: mg.showOnline,
          })),
          isLiquorItem: item.isLiquorItem,
          hasRecipe: item.hasRecipe,
          linkedBottleProductId: item.linkedBottleProductId,
          // Pour size options (needed for ordering)
          pourSizes: item.pourSizes as Record<string, number> | null,
          defaultPourSize: item.defaultPourSize,
          applyPourToModifiers: item.applyPourToModifiers,
          // Spirit tier data for quick selection
          spiritTiers: item.spiritTiers,
          hasOtherModifiers: item.hasOtherModifiers,
          // Printer routing
          printerIds: item.printerIds,
          backupPrinterIds: item.backupPrinterIds,
          // Combo print mode
          comboPrintMode: item.comboPrintMode,
          // Weight-based selling
          soldByWeight: item.soldByWeight,
          weightUnit: item.weightUnit,
          pricePerWeightUnit: item.pricePerWeightUnit !== null && item.pricePerWeightUnit !== undefined ? Number(item.pricePerWeightUnit) : null,
          // Pricing option groups (size/variant pricing)
          pricingOptionGroups: (item as any).pricingOptionGroups?.map((group: any) => ({
            id: group.id,
            name: group.name,
            sortOrder: group.sortOrder,
            isRequired: group.isRequired,
            showAsQuickPick: group.showAsQuickPick,
            options: group.options.map((opt: any) => ({
              id: opt.id,
              label: opt.label,
              price: opt.price !== null ? Number(opt.price) : null,
              priceCC: opt.priceCC !== null ? Number(opt.priceCC) : null,
              sortOrder: opt.sortOrder,
              isDefault: opt.isDefault,
              showOnPos: opt.showOnPos ?? false,
              color: opt.color,
            })),
          })) || [],
          hasPricingOptions: ((item as any).pricingOptionGroups?.length || 0) > 0,
          // 86 status (ingredient out of stock) — always needed
          is86d: item.is86d,
          reasons86d: item.reasons86d,
          // Prep stock status
          stockStatus: item.stockStatus,
          stockCount: item.stockCount,
          stockIngredientName: item.stockIngredientName,
        }

        // In slim mode, return only what POS grid needs (omit admin/cost/online fields)
        if (slim) return core

        // Full response includes admin, cost, and online-ordering fields
        return {
          ...core,
          description: item.description,
          // Seasonal date-based availability
          availableFromDate: item.availableFromDate?.toISOString() ?? null,
          availableUntilDate: item.availableUntilDate?.toISOString() ?? null,
          showOnline: item.showOnline,
          onlinePrice: item.onlinePrice !== null && item.onlinePrice !== undefined ? Number(item.onlinePrice) : null,
          // Liquor Builder recipe/cost data (loaded on-demand via item detail endpoint)
          recipeIngredientCount: item.recipeIngredientCount,
          linkedBottleProductName: null,
          linkedBottleTier: null,
          linkedBottlePourCost: null,
          linkedBottlePourSizeOz: null,
          linkedBottleUnitCost: null,
          linkedBottleSizeMl: null,
          linkedBottleSpiritCategory: null,
          linkedPourSizeOz: item.linkedPourSizeOz !== null && item.linkedPourSizeOz !== undefined ? Number(item.linkedPourSizeOz) : null,
          totalPourCost: item.totalPourCost,
          profitMargin: item.profitMargin,
          // CFD featured
          isFeaturedCfd: item.isFeaturedCfd,
          // Nutritional info (optional — columns may not exist yet)
          calories: (item as any).calories ?? null,
        }
      }),
    }
    timing.end('map', 'Response mapping')

    // Store in cache
    setMenuCache(cacheKey, responseData)

    return NextResponse.json({ data: responseData })
  } catch (error) {
    console.error('Failed to fetch menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
}, 'menu-load'))

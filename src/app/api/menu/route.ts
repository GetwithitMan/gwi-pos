import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAllMenuItemsStockStatus } from '@/lib/stock-status'
import { withVenue } from '@/lib/with-venue'

// Force dynamic rendering - never cache (entertainment status changes frequently)
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const categoryType = searchParams.get('categoryType')   // Optional: 'food', 'liquor', 'drinks', etc.
    const categoryShow = searchParams.get('categoryShow')   // Optional: 'food', 'bar', 'entertainment'

    // Build location filter - if locationId provided, filter by it
    const locationFilter = locationId ? { locationId } : {}
    const categoryTypeFilter = categoryType ? { categoryType } : {}
    const categoryShowFilter = categoryShow ? { categoryShow } : {}

    const categories = await db.category.findMany({
      where: { isActive: true, deletedAt: null, ...locationFilter, ...categoryTypeFilter, ...categoryShowFilter },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            menuItems: { where: { deletedAt: null, isActive: true } }
          }
        }
      }
    })

    const items = await db.menuItem.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        ...locationFilter,
        ...(categoryType ? { category: { categoryType } } : {}),
        ...(categoryShow ? { category: { categoryShow } } : {}),
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: {
          select: { categoryType: true }
        },
        modifierGroups: {
          where: {
            deletedAt: null,
            modifierGroup: { deletedAt: null }
          },
          include: {
            modifierGroup: {
              include: {
                modifiers: {
                  where: { deletedAt: null, isActive: true },
                  select: {
                    id: true,
                    name: true,
                    price: true,
                    spiritTier: true,
                  },
                  orderBy: { sortOrder: 'asc' }
                }
              }
            }
          }
        },
        recipeIngredients: {
          include: {
            bottleProduct: {
              select: {
                id: true,
                name: true,
                pourCost: true
              }
            }
          }
        },
        // Include ingredients to check 86 status
        ingredients: {
          where: { deletedAt: null },
          include: {
            ingredient: {
              select: {
                id: true,
                name: true,
                is86d: true
              }
            }
          }
        }
      }
    })

    // Get stock status for all menu items (if locationId provided)
    let stockStatusMap = new Map()
    if (locationId) {
      stockStatusMap = await getAllMenuItemsStockStatus(locationId)
    }

    // Calculate pour cost for items with recipes and check 86 status
    const itemsWithPourCost = items.map(item => {
      let totalPourCost = 0
      let hasRecipe = false

      if (item.recipeIngredients && item.recipeIngredients.length > 0) {
        hasRecipe = true
        totalPourCost = item.recipeIngredients.reduce((sum, ing) => {
          const pourCost = ing.bottleProduct?.pourCost ? Number(ing.bottleProduct.pourCost) : 0
          return sum + (pourCost * Number(ing.pourCount))
        }, 0)
      }

      const sellPrice = Number(item.price)
      const profitMargin = hasRecipe && sellPrice > 0
        ? ((sellPrice - totalPourCost) / sellPrice) * 100
        : null

      // Check if any ingredient is 86'd
      const ingredients86d = item.ingredients
        ?.filter(mi => mi.ingredient?.is86d)
        .map(mi => mi.ingredient?.name) || []
      const is86d = ingredients86d.length > 0

      // Get prep stock status
      const stockStatus = stockStatusMap.get(item.id)

      // Check for spirit upgrade group
      const spiritGroup = item.modifierGroups.find(mg => mg.modifierGroup.isSpiritGroup)
      const spiritModifiers = spiritGroup?.modifierGroup.modifiers || []

      // Group spirit modifiers by tier
      const spiritTiers = spiritModifiers.length > 0 ? {
        well: spiritModifiers.filter(m => m.spiritTier === 'well').map(m => ({
          id: m.id, name: m.name, price: Number(m.price)
        })),
        call: spiritModifiers.filter(m => m.spiritTier === 'call').map(m => ({
          id: m.id, name: m.name, price: Number(m.price)
        })),
        premium: spiritModifiers.filter(m => m.spiritTier === 'premium').map(m => ({
          id: m.id, name: m.name, price: Number(m.price)
        })),
        top_shelf: spiritModifiers.filter(m => m.spiritTier === 'top_shelf').map(m => ({
          id: m.id, name: m.name, price: Number(m.price)
        })),
      } : null

      return {
        ...item,
        hasRecipe,
        recipeIngredientCount: item.recipeIngredients?.length || 0,
        totalPourCost: hasRecipe ? Math.round(totalPourCost * 100) / 100 : null,
        profitMargin: profitMargin !== null ? Math.round(profitMargin * 10) / 10 : null,
        isLiquorItem: item.category?.categoryType === 'liquor',
        // 86 status from ingredients
        is86d,
        reasons86d: ingredients86d,
        // Prep stock status
        stockStatus: stockStatus?.status || 'ok',
        stockCount: stockStatus?.lowestCount || null,
        stockIngredientName: stockStatus?.lowestIngredientName || null,
        // Spirit tier data for quick selection
        spiritTiers,
        // Has non-spirit modifier groups
        hasOtherModifiers: item.modifierGroups.filter(mg => !mg.modifierGroup.isSpiritGroup).length > 0,
      }
    })

    return NextResponse.json({
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        categoryType: c.categoryType || 'food', // Ensure fallback for legacy data
        categoryShow: c.categoryShow || 'all', // Bartender view section (bar/food/entertainment/all)
        isActive: c.isActive,
        itemCount: c._count.menuItems,
        printerIds: c.printerIds,
      })),
      items: itemsWithPourCost.map(item => ({
        id: item.id,
        categoryId: item.categoryId,
        categoryType: item.category?.categoryType || 'food',
        name: item.name,
        price: Number(item.price),
        priceCC: item.priceCC ? Number(item.priceCC) : null,
        description: item.description,
        isActive: item.isActive,
        isAvailable: item.isAvailable,
        itemType: item.itemType,
        timedPricing: item.timedPricing,
        minimumMinutes: item.minimumMinutes,
        commissionType: item.commissionType,
        commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
        availableFrom: item.availableFrom,
        availableTo: item.availableTo,
        availableDays: item.availableDays,
        // Entertainment status for timed_rental items
        entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
        currentOrderId: item.itemType === 'timed_rental' ? item.currentOrderId : null,
        blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
        modifierGroupCount: item.modifierGroups.length,
        modifierGroups: item.modifierGroups.map(mg => ({
          id: mg.modifierGroup.id,
          name: mg.modifierGroup.name
        })),
        // Liquor Builder recipe data
        isLiquorItem: item.isLiquorItem,
        hasRecipe: item.hasRecipe,
        recipeIngredientCount: item.recipeIngredientCount,
        totalPourCost: item.totalPourCost,
        profitMargin: item.profitMargin,
        // Pour size options
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
        // 86 status (ingredient out of stock)
        is86d: item.is86d,
        reasons86d: item.reasons86d,
        // Prep stock status
        stockStatus: item.stockStatus,
        stockCount: item.stockCount,
        stockIngredientName: item.stockIngredientName,
      }))
    })
  } catch (error) {
    console.error('Failed to fetch menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
})

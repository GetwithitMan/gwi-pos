import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getFloorPlanSnapshot } from '@/lib/snapshot'
import { getMenuCache, setMenuCache, buildMenuCacheKey } from '@/lib/menu-cache'
import { getAllMenuItemsStockStatus } from '@/lib/stock-status'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

/**
 * GET /api/session/bootstrap?locationId=...&employeeId=...
 *
 * Single endpoint that returns everything needed for first paint on the
 * orders page: floor plan snapshot, menu data, active shift, order types,
 * and employee preferences. All queries run in parallel.
 *
 * Replaces 4-5 separate mount-time fetches in orders/page.tsx.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('locationId')
  const employeeId = searchParams.get('employeeId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  // Auth check — require basic POS access (any authenticated employee)
  if (employeeId) {
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const [snapshot, menuData, shift, orderTypes, preferences] = await Promise.all([
      getFloorPlanSnapshot(locationId),
      getMenuForBootstrap(locationId),
      employeeId ? getActiveShift(locationId, employeeId) : null,
      getOrderTypes(locationId),
      employeeId ? getEmployeePreferences(employeeId) : null,
    ])

    return NextResponse.json({
      data: {
        snapshot,
        menu: menuData,
        shift,
        orderTypes,
        preferences,
      },
    })
  } catch (error) {
    console.error('[session/bootstrap] GET error:', error)
    return NextResponse.json({ error: 'Failed to bootstrap session' }, { status: 500 })
  }
})

// ---------------------------------------------------------------------------
// Helper functions — each mirrors the logic from its individual API route
// ---------------------------------------------------------------------------

/**
 * Get menu data (categories + items with modifiers, stock, spirit tiers).
 * Reuses the server-side menu cache from menu-cache.ts.
 */
async function getMenuForBootstrap(locationId: string) {
  // Check server-side cache first (same cache as /api/menu)
  const cacheKey = buildMenuCacheKey(locationId, null, null)
  const cached = getMenuCache(cacheKey)
  if (cached) return cached

  const [categories, items, stockStatusMap] = await Promise.all([
    db.category.findMany({
      where: { isActive: true, deletedAt: null, locationId },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: {
          select: {
            menuItems: { where: { deletedAt: null, isActive: true } },
          },
        },
      },
    }),

    db.menuItem.findMany({
      where: { isActive: true, deletedAt: null, locationId },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: { select: { categoryType: true } },
        ownedModifierGroups: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            isSpiritGroup: true,
            modifiers: {
              where: { deletedAt: null, isActive: true },
              select: { id: true, name: true, price: true, spiritTier: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        recipeIngredients: {
          select: {
            pourCount: true,
            bottleProduct: { select: { id: true, name: true, pourCost: true } },
          },
        },
        ingredients: {
          where: { deletedAt: null },
          include: {
            ingredient: { select: { id: true, name: true, is86d: true } },
          },
        },
        pricingOptionGroups: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          include: {
            options: {
              where: { deletedAt: null },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    }),

    getAllMenuItemsStockStatus(locationId),
  ])

  // Map items — identical logic to /api/menu route
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

    const ingredients86d = item.ingredients
      ?.filter(mi => mi.ingredient?.is86d)
      .map(mi => mi.ingredient?.name) || []
    const is86d = ingredients86d.length > 0

    const stockStatus = stockStatusMap.get(item.id)

    const spiritGroup = item.ownedModifierGroups.find(mg => mg.isSpiritGroup)
    const spiritModifiers = spiritGroup?.modifiers || []

    const spiritTiers = spiritModifiers.length > 0 ? {
      well: spiritModifiers.filter(m => m.spiritTier === 'well').map(m => ({ id: m.id, name: m.name, price: Number(m.price) })),
      call: spiritModifiers.filter(m => m.spiritTier === 'call').map(m => ({ id: m.id, name: m.name, price: Number(m.price) })),
      premium: spiritModifiers.filter(m => m.spiritTier === 'premium').map(m => ({ id: m.id, name: m.name, price: Number(m.price) })),
      top_shelf: spiritModifiers.filter(m => m.spiritTier === 'top_shelf').map(m => ({ id: m.id, name: m.name, price: Number(m.price) })),
    } : null

    return {
      ...item,
      hasRecipe,
      recipeIngredientCount: item.recipeIngredients?.length || 0,
      totalPourCost: hasRecipe ? Math.round(totalPourCost * 100) / 100 : null,
      profitMargin: profitMargin !== null ? Math.round(profitMargin * 10) / 10 : null,
      isLiquorItem: item.category?.categoryType === 'liquor',
      is86d,
      reasons86d: ingredients86d,
      stockStatus: stockStatus?.status || 'ok',
      stockCount: stockStatus?.lowestCount || null,
      stockIngredientName: stockStatus?.lowestIngredientName || null,
      spiritTiers,
      hasOtherModifiers: item.ownedModifierGroups.filter(mg => !mg.isSpiritGroup).length > 0,
    }
  })

  const responseData = {
    categories: categories.map(c => ({
      id: c.id,
      name: c.name,
      color: c.color,
      categoryType: c.categoryType || 'food',
      categoryShow: c.categoryShow || 'all',
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
      entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
      currentOrderId: item.itemType === 'timed_rental' ? item.currentOrderId : null,
      blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
      modifierGroupCount: item.ownedModifierGroups.length,
      modifierGroups: item.ownedModifierGroups.map(mg => ({
        id: mg.id,
        name: mg.name,
      })),
      isLiquorItem: item.isLiquorItem,
      hasRecipe: item.hasRecipe,
      recipeIngredientCount: item.recipeIngredientCount,
      totalPourCost: item.totalPourCost,
      profitMargin: item.profitMargin,
      pourSizes: item.pourSizes as Record<string, number> | null,
      defaultPourSize: item.defaultPourSize,
      applyPourToModifiers: item.applyPourToModifiers,
      spiritTiers: item.spiritTiers,
      hasOtherModifiers: item.hasOtherModifiers,
      printerIds: item.printerIds,
      backupPrinterIds: item.backupPrinterIds,
      comboPrintMode: item.comboPrintMode,
      is86d: item.is86d,
      reasons86d: item.reasons86d,
      stockStatus: item.stockStatus,
      stockCount: item.stockCount,
      stockIngredientName: item.stockIngredientName,
      soldByWeight: item.soldByWeight,
      weightUnit: item.weightUnit,
      pricePerWeightUnit: item.pricePerWeightUnit ? Number(item.pricePerWeightUnit) : null,
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
    })),
  }

  // Store in same cache as /api/menu
  setMenuCache(cacheKey, responseData)

  return responseData
}

/**
 * Get the employee's current open shift (if any).
 * Returns the first open shift or null.
 */
async function getActiveShift(locationId: string, employeeId: string) {
  const shifts = await db.shift.findMany({
    where: { locationId, employeeId, status: 'open' },
    include: {
      employee: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
          role: { select: { permissions: true } },
        },
      },
    },
    orderBy: { startedAt: 'desc' },
    take: 1,
  })

  if (shifts.length === 0) return null

  const shift = shifts[0]
  return {
    id: shift.id,
    employee: {
      id: shift.employee.id,
      name: shift.employee.displayName || `${shift.employee.firstName} ${shift.employee.lastName}`,
      permissions: Array.isArray(shift.employee.role?.permissions) ? shift.employee.role.permissions as string[] : [],
    },
    startedAt: shift.startedAt.toISOString(),
    endedAt: shift.endedAt?.toISOString() || null,
    status: shift.status,
    startingCash: Number(shift.startingCash),
    expectedCash: shift.expectedCash ? Number(shift.expectedCash) : null,
    actualCash: shift.actualCash ? Number(shift.actualCash) : null,
    variance: shift.variance ? Number(shift.variance) : null,
    totalSales: shift.totalSales ? Number(shift.totalSales) : null,
    cashSales: shift.cashSales ? Number(shift.cashSales) : null,
    cardSales: shift.cardSales ? Number(shift.cardSales) : null,
    tipsDeclared: shift.tipsDeclared ? Number(shift.tipsDeclared) : null,
    notes: shift.notes,
  }
}

/**
 * Get active order types for the location.
 */
async function getOrderTypes(locationId: string) {
  const orderTypes = await db.orderType.findMany({
    where: { locationId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return orderTypes
}

/**
 * Get employee preferences (room order).
 */
async function getEmployeePreferences(employeeId: string) {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, preferredRoomOrder: true },
  })

  if (!employee) return null

  let roomOrder: string[] = []
  if (employee.preferredRoomOrder) {
    try {
      roomOrder = JSON.parse(employee.preferredRoomOrder)
    } catch {
      roomOrder = []
    }
  }

  return { preferredRoomOrder: roomOrder }
}

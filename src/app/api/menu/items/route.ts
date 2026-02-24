import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchMenuItemChanged } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { invalidateMenuCache } from '@/lib/menu-cache'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { getLocationId } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

// GET /api/menu/items - Fetch menu items, optionally filtered by category
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const categoryId = searchParams.get('categoryId')
    const locationId = searchParams.get('locationId') || await getLocationId()
    const includeStock = searchParams.get('includeStock') === 'true'

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Build filter
    const where: {
      isActive: boolean
      deletedAt: null
      categoryId?: string
      locationId: string
    } = {
      isActive: true,
      deletedAt: null,
      locationId,
    }

    if (categoryId) {
      where.categoryId = categoryId
    }

    const items = await db.menuItem.findMany({
      where,
      orderBy: { sortOrder: 'asc' },
      include: {
        category: {
          select: { name: true, categoryType: true }
        },
        ownedModifierGroups: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            isSpiritGroup: true,
            modifiers: {
              where: { deletedAt: null, isActive: true },
              select: {
                id: true,
                name: true,
                price: true,
                spiritTier: true,
              },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        // Include ingredients for stock status (only if requested)
        ...(includeStock ? {
          ingredients: {
            where: { deletedAt: null },
            include: {
              ingredient: {
                select: {
                  id: true,
                  name: true,
                  isDailyCountItem: true,
                  currentPrepStock: true,
                  lowStockThreshold: true,
                  criticalStockThreshold: true,
                  onlineStockThreshold: true,
                }
              }
            }
          }
        } : {})
      }
    })

    // Helper to calculate stock status for an item
    type StockStatus = 'in_stock' | 'low_stock' | 'critical' | 'out_of_stock'
    function getStockStatus(item: typeof items[0]): {
      status: StockStatus
      lowestIngredient?: { name: string; stock: number; threshold: number }
    } {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const itemWithIngredients = item as any
      if (!includeStock || !itemWithIngredients.ingredients) {
        return { status: 'in_stock' }
      }

      let worstStatus: StockStatus = 'in_stock'
      let lowestIngredient: { name: string; stock: number; threshold: number } | undefined

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const link of itemWithIngredients.ingredients) {
        const ing = link.ingredient
        if (!ing || !ing.isDailyCountItem) continue

        const stock = Number(ing.currentPrepStock || 0)
        const criticalThreshold = Number(ing.criticalStockThreshold || 0)
        const lowThreshold = Number(ing.lowStockThreshold || 0)

        // Check stock levels - worst status wins
        if (stock <= 0) {
          worstStatus = 'out_of_stock'
          lowestIngredient = { name: ing.name, stock, threshold: criticalThreshold }
          break // Can't get worse than out of stock
        } else if (stock <= criticalThreshold && criticalThreshold > 0) {
          if (worstStatus === 'in_stock' || worstStatus === 'low_stock') {
            worstStatus = 'critical'
            lowestIngredient = { name: ing.name, stock, threshold: criticalThreshold }
          }
        } else if (stock <= lowThreshold && lowThreshold > 0 && worstStatus === 'in_stock') {
          worstStatus = 'low_stock'
          lowestIngredient = { name: ing.name, stock, threshold: lowThreshold }
        }
      }

      return { status: worstStatus, lowestIngredient }
    }

    return NextResponse.json({ data: {
      items: items.map(item => {
        // Check if this is a pizza item based on category type OR item type
        const isPizzaItem = item.itemType === 'pizza' || item.category?.categoryType === 'pizza'

        // Check for spirit upgrade group
        const spiritGroup = item.ownedModifierGroups.find(mg => mg.isSpiritGroup)
        const spiritModifiers = spiritGroup?.modifiers || []

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

        // Get stock status
        const stockInfo = getStockStatus(item)

        return {
          id: item.id,
          categoryId: item.categoryId,
          categoryName: item.category?.name,
          categoryType: item.category?.categoryType,
          name: item.name,
          price: Number(item.price),
          priceCC: item.priceCC ? Number(item.priceCC) : null,
          description: item.description,
          isActive: item.isActive,
          isAvailable: item.isAvailable,
          itemType: item.itemType,
          hasModifiers: item.ownedModifierGroups.length > 0 || isPizzaItem,
          // Only count non-spirit modifier groups for "other" modifiers
          hasOtherModifiers: item.ownedModifierGroups.filter(mg => !mg.isSpiritGroup).length > 0 || isPizzaItem,
          isPizza: isPizzaItem,
          // Entertainment/timed rental fields
          entertainmentStatus: item.itemType === 'timed_rental' ? (item.entertainmentStatus || 'available') : null,
          blockTimeMinutes: item.itemType === 'timed_rental' ? item.blockTimeMinutes : null,
          timedPricing: item.itemType === 'timed_rental' ? item.timedPricing : null,
          pourSizes: item.pourSizes,
          defaultPourSize: item.defaultPourSize,
          applyPourToModifiers: item.applyPourToModifiers,
          // Spirit tier data for quick selection
          spiritTiers,
          // Stock status (only included if requested)
          ...(includeStock ? {
            stockStatus: stockInfo.status,
            stockWarning: stockInfo.lowestIngredient,
          } : {}),
        }
      })
    } })
  } catch (error) {
    console.error('Failed to fetch items:', error)
    return NextResponse.json(
      { error: 'Failed to fetch items' },
      { status: 500 }
    )
  }
})

export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      name,
      price,
      description,
      categoryId,
      commissionType,
      commissionValue,
      availableFrom,
      availableTo,
      availableDays,
      // Pour size options for liquor items
      pourSizes,
      defaultPourSize,
      applyPourToModifiers,
      // Printer routing
      printerIds,
      backupPrinterIds,
      // Combo print mode
      comboPrintMode,
    } = body

    if (!name?.trim()) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    if (price === undefined || price < 0) {
      return NextResponse.json(
        { error: 'Valid price is required' },
        { status: 400 }
      )
    }

    // Get the location from the category
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: { locationId: true }
    })

    if (!category) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 400 }
      )
    }

    // Get max sort order in category
    const maxSortOrder = await db.menuItem.aggregate({
      where: { categoryId },
      _max: { sortOrder: true }
    })

    const item = await db.menuItem.create({
      data: {
        locationId: category.locationId,
        categoryId,
        name: name.trim(),
        price,
        description: description || null,
        sortOrder: (maxSortOrder._max.sortOrder || 0) + 1,
        commissionType: commissionType || null,
        commissionValue: commissionValue ?? null,
        availableFrom: availableFrom || null,
        availableTo: availableTo || null,
        availableDays: availableDays || null,
        // Pour size options
        pourSizes: pourSizes || null,
        defaultPourSize: defaultPourSize || null,
        applyPourToModifiers: applyPourToModifiers || false,
        // Printer routing
        printerIds: printerIds && printerIds.length > 0 ? printerIds : null,
        backupPrinterIds: backupPrinterIds && backupPrinterIds.length > 0 ? backupPrinterIds : null,
        // Combo print mode
        comboPrintMode: comboPrintMode || null,
      }
    })

    // Invalidate server-side menu cache so next GET returns fresh data
    invalidateMenuCache(category.locationId)

    // Fire-and-forget socket dispatch for real-time menu updates
    void emitToLocation(category.locationId, 'menu:changed', { action: 'created' }).catch(() => {})

    // Dispatch socket event for real-time menu updates
    dispatchMenuItemChanged(category.locationId, {
      itemId: item.id,
      action: 'created',
      changes: {
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        price: Number(item.price),
        isActive: item.isActive,
        isAvailable: item.isAvailable,
      }
    }, { async: true }).catch(err => {
      console.error('Failed to dispatch menu item created event:', err)
    })

    // Notify cloud → NUC sync for real-time updates
    void notifyDataChanged({ locationId: category.locationId, domain: 'menu', action: 'created', entityId: item.id })

    return NextResponse.json({ data: {
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      price: Number(item.price),
      description: item.description,
      isActive: item.isActive,
      isAvailable: item.isAvailable,
      commissionType: item.commissionType,
      commissionValue: item.commissionValue ? Number(item.commissionValue) : null,
      availableFrom: item.availableFrom,
      availableTo: item.availableTo,
      availableDays: item.availableDays,
      printerIds: item.printerIds,
      backupPrinterIds: item.backupPrinterIds,
      comboPrintMode: item.comboPrintMode,
    } })
  } catch (error) {
    console.error('Failed to create item:', error)
    return NextResponse.json(
      { error: 'Failed to create item' },
      { status: 500 }
    )
  }
})

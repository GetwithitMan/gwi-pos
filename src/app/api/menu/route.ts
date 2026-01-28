import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    // Build location filter - if locationId provided, filter by it
    const locationFilter = locationId ? { locationId } : {}

    const categories = await db.category.findMany({
      where: { isActive: true, ...locationFilter },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { menuItems: true } } }
    })

    const items = await db.menuItem.findMany({
      where: { isActive: true, ...locationFilter },
      orderBy: { sortOrder: 'asc' },
      include: {
        category: {
          select: { categoryType: true }
        },
        modifierGroups: {
          include: {
            modifierGroup: {
              select: { id: true, name: true }
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
        }
      }
    })

    // Calculate pour cost for items with recipes
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

      return {
        ...item,
        hasRecipe,
        recipeIngredientCount: item.recipeIngredients?.length || 0,
        totalPourCost: hasRecipe ? Math.round(totalPourCost * 100) / 100 : null,
        profitMargin: profitMargin !== null ? Math.round(profitMargin * 10) / 10 : null,
        isLiquorItem: item.category?.categoryType === 'liquor'
      }
    })

    return NextResponse.json({
      categories: categories.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color,
        categoryType: c.categoryType || 'food', // Ensure fallback for legacy data
        isActive: c.isActive,
        itemCount: c._count.menuItems
      })),
      items: itemsWithPourCost.map(item => ({
        id: item.id,
        categoryId: item.categoryId,
        name: item.name,
        price: Number(item.price),
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
        applyPourToModifiers: item.applyPourToModifiers
      }))
    })
  } catch (error) {
    console.error('Failed to fetch menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
}

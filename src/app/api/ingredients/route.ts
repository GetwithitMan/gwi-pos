import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/ingredients - List ingredients with filtering and grouping
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const categoryId = searchParams.get('categoryId')
    const includeInactive = searchParams.get('includeInactive') === 'true'
    const visibility = searchParams.get('visibility') || 'visible' // 'visible', 'admin_only', 'all'
    const groupByCategory = searchParams.get('groupByCategory') === 'true'
    const hierarchy = searchParams.get('hierarchy') === 'true'
    const baseOnly = searchParams.get('baseOnly') === 'true' // Only get base ingredients (no children)
    const deletedOnly = searchParams.get('deletedOnly') === 'true' // Only get soft-deleted ingredients

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Build visibility filter
    const visibilityFilter = visibility === 'all'
      ? {}
      : { visibility: visibility === 'admin_only' ? { in: ['visible', 'admin_only'] } : 'visible' }

    // Build hierarchy filter - when hierarchy=true, only get root ingredients (parentIngredientId = null)
    // When baseOnly=true, only get base ingredients
    const hierarchyFilter = hierarchy || baseOnly
      ? { parentIngredientId: null }
      : {}

    // Build deletion filter
    const deletionFilter = deletedOnly
      ? { deletedAt: { not: null } } // Only deleted items
      : { deletedAt: null } // Only non-deleted items (default)

    const ingredients = await db.ingredient.findMany({
      where: {
        locationId,
        ...deletionFilter,
        ...(categoryId ? { categoryId } : {}),
        ...(includeInactive ? {} : { isActive: true }),
        ...visibilityFilter,
        ...hierarchyFilter,
      },
      include: {
        categoryRelation: {
          select: {
            id: true,
            code: true,
            name: true,
            icon: true,
            color: true,
          },
        },
        inventoryItem: {
          select: {
            id: true,
            name: true,
            storageUnit: true,
          },
        },
        prepItem: {
          select: {
            id: true,
            name: true,
            outputUnit: true,
          },
        },
        swapGroup: {
          select: {
            id: true,
            name: true,
          },
        },
        // Include parent ingredient info
        parentIngredient: {
          select: {
            id: true,
            name: true,
            standardQuantity: true,
            standardUnit: true,
          },
        },
        // Include child ingredients (preparations) when hierarchy mode
        ...(hierarchy ? {
          childIngredients: {
            where: { deletedAt: null },
            include: {
              inventoryItem: {
                select: { id: true, name: true, storageUnit: true },
              },
              prepItem: {
                select: { id: true, name: true, outputUnit: true },
              },
              // Count of linked modifiers (for showing connection badge)
              _count: {
                select: {
                  linkedModifiers: { where: { deletedAt: null } },
                  menuItemIngredients: true,
                },
              },
              // Recursively include grandchildren (one level deep for now)
              childIngredients: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  locationId: true,
                  name: true,
                  description: true,
                  categoryId: true,
                  preparationType: true,
                  yieldPercent: true,
                  batchYield: true,
                  portionSize: true,
                  portionUnit: true,
                  liteMultiplier: true,
                  extraMultiplier: true,
                  standardQuantity: true,
                  standardUnit: true,
                  isBaseIngredient: true,
                  isActive: true,
                  visibility: true,
                  isDailyCountItem: true,
                  currentPrepStock: true,
                  lowStockThreshold: true,
                  criticalStockThreshold: true,
                  onlineStockThreshold: true,
                  parentIngredientId: true,
                  needsVerification: true,
                },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        } : {}),
        _count: {
          select: {
            menuItemIngredients: true,
            childIngredients: true,
          },
        },
      },
      orderBy: [
        { categoryRelation: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    })

    // Helper to format child ingredients recursively
    const formatChildIngredient = (child: typeof ingredients[0]['childIngredients'][0] | any, parent?: any): any => ({
      id: child.id,
      locationId: child.locationId,
      name: child.name,
      description: child.description,
      categoryId: child.categoryId,
      preparationType: child.preparationType,
      yieldPercent: child.yieldPercent ? Number(child.yieldPercent) : null,
      batchYield: child.batchYield ? Number(child.batchYield) : null,
      portionSize: child.portionSize ? Number(child.portionSize) : null,
      portionUnit: child.portionUnit,
      liteMultiplier: child.liteMultiplier ? Number(child.liteMultiplier) : 0.5,
      extraMultiplier: child.extraMultiplier ? Number(child.extraMultiplier) : 2.0,
      standardQuantity: child.standardQuantity ? Number(child.standardQuantity) : null,
      standardUnit: child.standardUnit,
      isBaseIngredient: child.isBaseIngredient,
      isActive: child.isActive,
      visibility: child.visibility,
      isDailyCountItem: child.isDailyCountItem || false,
      countPrecision: child.countPrecision || 'whole',
      currentPrepStock: child.currentPrepStock ? Number(child.currentPrepStock) : 0,
      lowStockThreshold: child.lowStockThreshold ? Number(child.lowStockThreshold) : null,
      criticalStockThreshold: child.criticalStockThreshold ? Number(child.criticalStockThreshold) : null,
      onlineStockThreshold: child.onlineStockThreshold ? Number(child.onlineStockThreshold) : null,
      inventoryItem: child.inventoryItem,
      prepItem: child.prepItem,
      // Critical: include parent info so modal knows this is a prep item
      parentIngredientId: child.parentIngredientId,
      parentIngredient: parent ? {
        id: parent.id,
        name: parent.name,
        standardQuantity: parent.standardQuantity ? Number(parent.standardQuantity) : null,
        standardUnit: parent.standardUnit,
      } : null,
      needsVerification: child.needsVerification || false,
      linkedModifierCount: child._count?.linkedModifiers || 0,
      usedByCount: child._count?.menuItemIngredients || 0,
      childIngredients: child.childIngredients?.map((c: any) => formatChildIngredient(c, child)) || [],
    })

    // Format ingredients
    const formattedIngredients = ingredients.map(ing => ({
      id: ing.id,
      locationId: ing.locationId,
      name: ing.name,
      description: ing.description,
      category: ing.category, // Legacy string
      categoryId: ing.categoryId,
      categoryRelation: ing.categoryRelation,
      inventoryItemId: ing.inventoryItemId,
      inventoryItem: ing.inventoryItem,
      prepItemId: ing.prepItemId,
      prepItem: ing.prepItem,
      standardQuantity: ing.standardQuantity ? Number(ing.standardQuantity) : null,
      standardUnit: ing.standardUnit,
      allowNo: ing.allowNo,
      allowLite: ing.allowLite,
      allowExtra: ing.allowExtra,
      allowOnSide: ing.allowOnSide,
      extraPrice: Number(ing.extraPrice),
      liteMultiplier: Number(ing.liteMultiplier),
      extraMultiplier: Number(ing.extraMultiplier),
      allowSwap: ing.allowSwap,
      swapGroupId: ing.swapGroupId,
      swapGroup: ing.swapGroup,
      swapUpcharge: Number(ing.swapUpcharge),
      visibility: ing.visibility,
      sortOrder: ing.sortOrder,
      isActive: ing.isActive,
      usedByCount: ing._count.menuItemIngredients,
      // Hierarchy fields
      parentIngredientId: ing.parentIngredientId,
      parentIngredient: ing.parentIngredient,
      preparationType: ing.preparationType,
      yieldPercent: ing.yieldPercent ? Number(ing.yieldPercent) : null,
      batchYield: ing.batchYield ? Number(ing.batchYield) : null,
      portionSize: ing.portionSize ? Number(ing.portionSize) : null,
      portionUnit: ing.portionUnit,
      isBaseIngredient: ing.isBaseIngredient,
      isDailyCountItem: ing.isDailyCountItem || false,
      countPrecision: ing.countPrecision || 'whole',
      childIngredients: (ing as any).childIngredients?.map((c: any) => formatChildIngredient(c, ing)) || [],
      childCount: ing._count.childIngredients,
      createdAt: ing.createdAt,
      updatedAt: ing.updatedAt,
      needsVerification: ing.needsVerification || false,
    }))

    // Optionally group by category
    if (groupByCategory) {
      const grouped: Record<string, {
        category: {
          id: string
          code: number
          name: string
          icon: string | null
          color: string | null
        } | null
        ingredients: typeof formattedIngredients
      }> = {}

      for (const ing of formattedIngredients) {
        const catId = ing.categoryId || 'uncategorized'
        if (!grouped[catId]) {
          grouped[catId] = {
            category: ing.categoryRelation || null,
            ingredients: [],
          }
        }
        grouped[catId].ingredients.push(ing)
      }

      return NextResponse.json({
        data: Object.values(grouped).sort((a, b) => {
          if (!a.category) return 1
          if (!b.category) return -1
          return 0
        }),
      })
    }

    return NextResponse.json({ data: formattedIngredients })
  } catch (error) {
    console.error('Error fetching ingredients:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredients' }, { status: 500 })
  }
}

// POST /api/ingredients - Create a new ingredient
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      name,
      description,
      categoryId,
      inventoryItemId,
      prepItemId,
      standardQuantity,
      standardUnit,
      // Source and purchase info
      sourceType = 'delivered',
      purchaseUnit,
      purchaseCost,
      unitsPerPurchase,
      // Customization
      allowNo = true,
      allowLite = true,
      allowExtra = true,
      allowOnSide = false,
      extraPrice = 0,
      liteMultiplier = 0.5,
      extraMultiplier = 2.0,
      allowSwap = false,
      swapGroupId,
      swapUpcharge = 0,
      visibility = 'visible',
      sortOrder,
      // Hierarchy fields
      parentIngredientId,
      preparationType,
      yieldPercent,
      isBaseIngredient = true,
      // Input/Output transformation (for prep items)
      inputQuantity,
      inputUnit,
      outputQuantity,
      outputUnit,
      // Quick 86
      showOnQuick86 = false,
      // Verification
      needsVerification = false,
    } = body

    if (!locationId || !name) {
      return NextResponse.json(
        { error: 'locationId and name are required' },
        { status: 400 }
      )
    }

    // Check for duplicate name — but allow a prep item to share a name with its parent inventory item
    // e.g. INV "Ketchup" can have a PREP child also named "Ketchup"
    const existing = await db.ingredient.findFirst({
      where: { locationId, name, deletedAt: null },
      select: { id: true, name: true, parentIngredientId: true, categoryId: true },
    })
    if (existing) {
      // Allow if: we're creating a prep item (has parentIngredientId) AND the existing item is the parent INV item
      const isCreatingPrepUnderParent = parentIngredientId && existing.id === parentIngredientId && !existing.parentIngredientId
      // Also allow if: we're creating a prep item AND the existing one is an INV item (not the same parent, but different type)
      const isCreatingPrepAndExistingIsInv = parentIngredientId && !existing.parentIngredientId

      if (!isCreatingPrepUnderParent && !isCreatingPrepAndExistingIsInv) {
        return NextResponse.json(
          {
            error: 'An ingredient with this name already exists',
            existing: {
              id: existing.id,
              name: existing.name,
              parentIngredientId: existing.parentIngredientId,
              categoryId: existing.categoryId,
            },
          },
          { status: 409 }
        )
      }
      // else: allow creation — a prep item can share a name with an inventory item
    }

    // Validate categoryId if provided
    if (categoryId) {
      const category = await db.ingredientCategory.findUnique({ where: { id: categoryId } })
      if (!category || category.deletedAt) {
        return NextResponse.json(
          { error: 'Invalid category' },
          { status: 400 }
        )
      }
    }

    // Validate parentIngredientId if provided
    let parentIngredient = null
    if (parentIngredientId) {
      parentIngredient = await db.ingredient.findUnique({ where: { id: parentIngredientId } })
      if (!parentIngredient || parentIngredient.deletedAt) {
        return NextResponse.json(
          { error: 'Invalid parent ingredient' },
          { status: 400 }
        )
      }
    }

    // Get max sortOrder if not provided
    let finalSortOrder = sortOrder
    if (finalSortOrder === undefined) {
      const maxSort = await db.ingredient.aggregate({
        where: { locationId },
        _max: { sortOrder: true },
      })
      finalSortOrder = (maxSort._max.sortOrder ?? -1) + 1
    }

    // If this is a child ingredient (has parentIngredientId), inherit category from parent
    // and set isBaseIngredient to false
    const finalCategoryId = parentIngredientId && parentIngredient
      ? parentIngredient.categoryId
      : categoryId
    const finalIsBaseIngredient = parentIngredientId ? false : isBaseIngredient

    const ingredient = await db.ingredient.create({
      data: {
        locationId,
        name,
        description,
        categoryId: finalCategoryId,
        inventoryItemId,
        prepItemId,
        standardQuantity,
        standardUnit,
        // Source and purchase info
        sourceType,
        purchaseUnit: sourceType === 'delivered' ? purchaseUnit : null,
        purchaseCost: sourceType === 'delivered' ? purchaseCost : null,
        unitsPerPurchase: sourceType === 'delivered' ? unitsPerPurchase : null,
        // Customization
        allowNo,
        allowLite,
        allowExtra,
        allowOnSide,
        extraPrice,
        liteMultiplier,
        extraMultiplier,
        allowSwap,
        swapGroupId: allowSwap ? swapGroupId : null,
        swapUpcharge: allowSwap ? swapUpcharge : 0,
        visibility,
        sortOrder: finalSortOrder,
        // Hierarchy fields
        parentIngredientId,
        preparationType: parentIngredientId ? preparationType : null,
        yieldPercent: parentIngredientId ? yieldPercent : null,
        isBaseIngredient: finalIsBaseIngredient,
        // Input/Output transformation (for prep items)
        inputQuantity: parentIngredientId ? inputQuantity : null,
        inputUnit: parentIngredientId ? inputUnit : null,
        outputQuantity: parentIngredientId ? outputQuantity : null,
        outputUnit: parentIngredientId ? outputUnit : null,
        // Quick 86
        showOnQuick86,
        // Verification
        needsVerification,
      },
      include: {
        categoryRelation: {
          select: { id: true, code: true, name: true, icon: true, color: true },
        },
        inventoryItem: {
          select: { id: true, name: true, storageUnit: true },
        },
        prepItem: {
          select: { id: true, name: true, outputUnit: true },
        },
        swapGroup: {
          select: { id: true, name: true },
        },
        parentIngredient: {
          select: { id: true, name: true, standardQuantity: true, standardUnit: true },
        },
      },
    })

    return NextResponse.json({
      data: {
        ...ingredient,
        standardQuantity: ingredient.standardQuantity ? Number(ingredient.standardQuantity) : null,
        purchaseCost: ingredient.purchaseCost ? Number(ingredient.purchaseCost) : null,
        unitsPerPurchase: ingredient.unitsPerPurchase ? Number(ingredient.unitsPerPurchase) : null,
        extraPrice: Number(ingredient.extraPrice),
        liteMultiplier: Number(ingredient.liteMultiplier),
        extraMultiplier: Number(ingredient.extraMultiplier),
        swapUpcharge: Number(ingredient.swapUpcharge),
        yieldPercent: ingredient.yieldPercent ? Number(ingredient.yieldPercent) : null,
        needsVerification: ingredient.needsVerification,
      },
    })
  } catch (error) {
    console.error('Error creating ingredient:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to create ingredient', detail: message }, { status: 500 })
  }
}

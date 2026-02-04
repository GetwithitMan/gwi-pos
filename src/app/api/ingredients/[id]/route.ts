import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/ingredients/[id] - Get a single ingredient with full details
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const ingredient = await db.ingredient.findUnique({
      where: { id },
      include: {
        categoryRelation: {
          select: { id: true, code: true, name: true, icon: true, color: true },
        },
        inventoryItem: {
          select: { id: true, name: true, storageUnit: true, costPerUnit: true },
        },
        prepItem: {
          select: { id: true, name: true, outputUnit: true, costPerUnit: true },
        },
        swapGroup: {
          select: {
            id: true,
            name: true,
            ingredients: {
              where: { deletedAt: null, isActive: true },
              select: { id: true, name: true, swapUpcharge: true },
            },
          },
        },
        menuItemIngredients: {
          include: {
            menuItem: {
              select: { id: true, name: true },
            },
          },
        },
        // Hierarchy relations
        parentIngredient: {
          select: { id: true, name: true, standardQuantity: true, standardUnit: true },
        },
        childIngredients: {
          where: { deletedAt: null },
          include: {
            inventoryItem: {
              select: { id: true, name: true, storageUnit: true },
            },
            prepItem: {
              select: { id: true, name: true, outputUnit: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    })

    if (!ingredient || ingredient.deletedAt) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        ...ingredient,
        standardQuantity: ingredient.standardQuantity ? Number(ingredient.standardQuantity) : null,
        purchaseCost: ingredient.purchaseCost ? Number(ingredient.purchaseCost) : null,
        unitsPerPurchase: ingredient.unitsPerPurchase ? Number(ingredient.unitsPerPurchase) : null,
        recipeYieldQuantity: ingredient.recipeYieldQuantity ? Number(ingredient.recipeYieldQuantity) : null,
        extraPrice: Number(ingredient.extraPrice),
        liteMultiplier: Number(ingredient.liteMultiplier),
        extraMultiplier: Number(ingredient.extraMultiplier),
        swapUpcharge: Number(ingredient.swapUpcharge),
        yieldPercent: ingredient.yieldPercent ? Number(ingredient.yieldPercent) : null,
        batchYield: ingredient.batchYield ? Number(ingredient.batchYield) : null,
        portionSize: ingredient.portionSize ? Number(ingredient.portionSize) : null,
        portionUnit: ingredient.portionUnit,
        currentPrepStock: ingredient.currentPrepStock ? Number(ingredient.currentPrepStock) : 0,
        lowStockThreshold: ingredient.lowStockThreshold ? Number(ingredient.lowStockThreshold) : null,
        criticalStockThreshold: ingredient.criticalStockThreshold ? Number(ingredient.criticalStockThreshold) : null,
        onlineStockThreshold: ingredient.onlineStockThreshold ? Number(ingredient.onlineStockThreshold) : null,
        resetDailyToZero: ingredient.resetDailyToZero,
        varianceHandling: ingredient.varianceHandling,
        varianceThreshold: ingredient.varianceThreshold ? Number(ingredient.varianceThreshold) : 10,
        countPrecision: ingredient.countPrecision || 'whole',
        inventoryItem: ingredient.inventoryItem ? {
          ...ingredient.inventoryItem,
          costPerUnit: ingredient.inventoryItem.costPerUnit ? Number(ingredient.inventoryItem.costPerUnit) : null,
        } : null,
        prepItem: ingredient.prepItem ? {
          ...ingredient.prepItem,
          costPerUnit: ingredient.prepItem.costPerUnit ? Number(ingredient.prepItem.costPerUnit) : null,
        } : null,
        swapGroup: ingredient.swapGroup ? {
          ...ingredient.swapGroup,
          ingredients: ingredient.swapGroup.ingredients.map(i => ({
            ...i,
            swapUpcharge: Number(i.swapUpcharge),
          })),
        } : null,
        menuItemIngredients: ingredient.menuItemIngredients.map(mi => ({
          ...mi,
          quantity: mi.quantity ? Number(mi.quantity) : null,
          extraPrice: mi.extraPrice ? Number(mi.extraPrice) : null,
        })),
        childIngredients: ingredient.childIngredients.map(child => ({
          ...child,
          yieldPercent: child.yieldPercent ? Number(child.yieldPercent) : null,
        })),
      },
    })
  } catch (error) {
    console.error('Error fetching ingredient:', error)
    return NextResponse.json({ error: 'Failed to fetch ingredient' }, { status: 500 })
  }
}

// PUT /api/ingredients/[id] - Update an ingredient
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()

    const {
      name,
      description,
      categoryId,
      inventoryItemId,
      prepItemId,
      standardQuantity,
      standardUnit,
      // Source and purchase info
      sourceType,
      purchaseUnit,
      purchaseCost,
      unitsPerPurchase,
      // Customization
      allowNo,
      allowLite,
      allowExtra,
      allowOnSide,
      extraPrice,
      liteMultiplier,
      extraMultiplier,
      allowSwap,
      swapGroupId,
      swapUpcharge,
      visibility,
      sortOrder,
      isActive,
      // Hierarchy fields
      parentIngredientId,
      preparationType,
      yieldPercent,
      batchYield,
      portionSize,
      portionUnit,
      isBaseIngredient,
      // Input/Output transformation (for prep items)
      inputQuantity,
      inputUnit,
      outputQuantity,
      outputUnit,
      // Recipe batch yield
      recipeYieldQuantity,
      recipeYieldUnit,
      // Daily count fields
      isDailyCountItem,
      countPrecision,
      lowStockThreshold,
      criticalStockThreshold,
      onlineStockThreshold,
      resetDailyToZero,
      varianceHandling,
      varianceThreshold,
      // Quick 86
      showOnQuick86,
    } = body

    // Check ingredient exists
    const existing = await db.ingredient.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Allow restoring deleted items (when deletedAt is being set to null)
    const isRestoring = body.deletedAt === null && existing.deletedAt !== null
    if (existing.deletedAt && !isRestoring) {
      return NextResponse.json({ error: 'Ingredient not found (deleted)' }, { status: 404 })
    }

    // Check for duplicate name (if name is being changed)
    if (name && name !== existing.name) {
      const duplicate = await db.ingredient.findFirst({
        where: { locationId: existing.locationId, name, deletedAt: null, NOT: { id } },
      })
      if (duplicate) {
        return NextResponse.json(
          { error: 'An ingredient with this name already exists' },
          { status: 409 }
        )
      }
    }

    // Validate categoryId if provided
    if (categoryId !== undefined && categoryId !== null) {
      const category = await db.ingredientCategory.findUnique({ where: { id: categoryId } })
      if (!category || category.deletedAt) {
        return NextResponse.json(
          { error: 'Invalid category' },
          { status: 400 }
        )
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (categoryId !== undefined) updateData.categoryId = categoryId
    if (inventoryItemId !== undefined) updateData.inventoryItemId = inventoryItemId
    if (prepItemId !== undefined) updateData.prepItemId = prepItemId
    if (standardQuantity !== undefined) updateData.standardQuantity = standardQuantity
    if (standardUnit !== undefined) updateData.standardUnit = standardUnit
    // Source and purchase info
    if (sourceType !== undefined) updateData.sourceType = sourceType
    if (purchaseUnit !== undefined) updateData.purchaseUnit = purchaseUnit
    if (purchaseCost !== undefined) updateData.purchaseCost = purchaseCost
    if (unitsPerPurchase !== undefined) updateData.unitsPerPurchase = unitsPerPurchase
    // Recipe batch yield
    if (recipeYieldQuantity !== undefined) updateData.recipeYieldQuantity = recipeYieldQuantity
    if (recipeYieldUnit !== undefined) updateData.recipeYieldUnit = recipeYieldUnit
    // Customization
    if (allowNo !== undefined) updateData.allowNo = allowNo
    if (allowLite !== undefined) updateData.allowLite = allowLite
    if (allowExtra !== undefined) updateData.allowExtra = allowExtra
    if (allowOnSide !== undefined) updateData.allowOnSide = allowOnSide
    if (extraPrice !== undefined) updateData.extraPrice = extraPrice
    if (liteMultiplier !== undefined) updateData.liteMultiplier = liteMultiplier
    if (extraMultiplier !== undefined) updateData.extraMultiplier = extraMultiplier
    if (allowSwap !== undefined) {
      updateData.allowSwap = allowSwap
      if (!allowSwap) {
        updateData.swapGroupId = null
        updateData.swapUpcharge = 0
      }
    }
    if (swapGroupId !== undefined && body.allowSwap !== false) updateData.swapGroupId = swapGroupId
    if (swapUpcharge !== undefined && body.allowSwap !== false) updateData.swapUpcharge = swapUpcharge
    if (visibility !== undefined) updateData.visibility = visibility
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder
    if (isActive !== undefined) updateData.isActive = isActive
    // Hierarchy fields
    if (parentIngredientId !== undefined) updateData.parentIngredientId = parentIngredientId
    if (preparationType !== undefined) updateData.preparationType = preparationType
    if (yieldPercent !== undefined) updateData.yieldPercent = yieldPercent
    if (batchYield !== undefined) updateData.batchYield = batchYield
    if (portionSize !== undefined) updateData.portionSize = portionSize
    if (portionUnit !== undefined) updateData.portionUnit = portionUnit
    if (isBaseIngredient !== undefined) updateData.isBaseIngredient = isBaseIngredient
    // Input/Output transformation
    if (inputQuantity !== undefined) updateData.inputQuantity = inputQuantity
    if (inputUnit !== undefined) updateData.inputUnit = inputUnit
    if (outputQuantity !== undefined) updateData.outputQuantity = outputQuantity
    if (outputUnit !== undefined) updateData.outputUnit = outputUnit
    // Restore from deleted (set deletedAt to null)
    if (body.deletedAt === null) updateData.deletedAt = null
    // Daily count fields
    if (isDailyCountItem !== undefined) updateData.isDailyCountItem = isDailyCountItem
    if (countPrecision !== undefined) updateData.countPrecision = countPrecision
    if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold
    if (criticalStockThreshold !== undefined) updateData.criticalStockThreshold = criticalStockThreshold
    if (onlineStockThreshold !== undefined) updateData.onlineStockThreshold = onlineStockThreshold
    if (resetDailyToZero !== undefined) updateData.resetDailyToZero = resetDailyToZero
    if (varianceHandling !== undefined) updateData.varianceHandling = varianceHandling
    if (varianceThreshold !== undefined) updateData.varianceThreshold = varianceThreshold
    // Quick 86
    if (showOnQuick86 !== undefined) updateData.showOnQuick86 = showOnQuick86

    const ingredient = await db.ingredient.update({
      where: { id },
      data: updateData,
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
        recipeYieldQuantity: ingredient.recipeYieldQuantity ? Number(ingredient.recipeYieldQuantity) : null,
        extraPrice: Number(ingredient.extraPrice),
        liteMultiplier: Number(ingredient.liteMultiplier),
        extraMultiplier: Number(ingredient.extraMultiplier),
        swapUpcharge: Number(ingredient.swapUpcharge),
        yieldPercent: ingredient.yieldPercent ? Number(ingredient.yieldPercent) : null,
        batchYield: ingredient.batchYield ? Number(ingredient.batchYield) : null,
        portionSize: ingredient.portionSize ? Number(ingredient.portionSize) : null,
        portionUnit: ingredient.portionUnit,
        currentPrepStock: ingredient.currentPrepStock ? Number(ingredient.currentPrepStock) : 0,
        lowStockThreshold: ingredient.lowStockThreshold ? Number(ingredient.lowStockThreshold) : null,
        criticalStockThreshold: ingredient.criticalStockThreshold ? Number(ingredient.criticalStockThreshold) : null,
        onlineStockThreshold: ingredient.onlineStockThreshold ? Number(ingredient.onlineStockThreshold) : null,
        resetDailyToZero: ingredient.resetDailyToZero,
        varianceHandling: ingredient.varianceHandling,
        varianceThreshold: ingredient.varianceThreshold ? Number(ingredient.varianceThreshold) : 10,
        countPrecision: ingredient.countPrecision || 'whole',
      },
    })
  } catch (error) {
    console.error('Error updating ingredient:', error)
    return NextResponse.json({ error: 'Failed to update ingredient' }, { status: 500 })
  }
}

// DELETE /api/ingredients/[id] - Soft delete or permanent delete an ingredient
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const cascadeChildren = searchParams.get('cascadeChildren') === 'true'
    const permanent = searchParams.get('permanent') === 'true' // Hard delete

    // Check if ingredient exists
    const existing = await db.ingredient.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            menuItemIngredients: {
              where: { deletedAt: null },
            },
            childIngredients: {
              where: { deletedAt: null },
            },
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Handle permanent deletion (from Deleted section)
    if (permanent) {
      // Only allow permanent delete if already soft-deleted
      if (!existing.deletedAt) {
        return NextResponse.json(
          { error: 'Item must be soft-deleted first before permanent deletion' },
          { status: 400 }
        )
      }

      // Hard delete - also remove menu item links
      await db.menuItemIngredient.deleteMany({
        where: { ingredientId: id },
      })

      // Hard delete children too
      await db.ingredient.deleteMany({
        where: { parentIngredientId: id },
      })

      // Hard delete the ingredient
      await db.ingredient.delete({
        where: { id },
      })

      return NextResponse.json({ data: { message: 'Ingredient permanently deleted' } })
    }

    // Regular soft delete - don't allow if already deleted
    if (existing.deletedAt) {
      return NextResponse.json({ error: 'Ingredient already deleted' }, { status: 404 })
    }

    // Check if ingredient has child preparations
    if (existing._count.childIngredients > 0) {
      if (cascadeChildren) {
        // Delete all children first
        await db.ingredient.updateMany({
          where: { parentIngredientId: id, deletedAt: null },
          data: { deletedAt: new Date(), isActive: false },
        })
      } else {
        return NextResponse.json(
          { error: `Cannot delete: ingredient has ${existing._count.childIngredients} child preparation(s). Use ?cascadeChildren=true to delete all.` },
          { status: 400 }
        )
      }
    }

    // Check if ingredient is used by any menu items
    if (existing._count.menuItemIngredients > 0) {
      // Soft delete and deactivate
      await db.ingredient.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      })
      return NextResponse.json({
        data: { message: `Ingredient deactivated (used by ${existing._count.menuItemIngredients} menu items)` },
      })
    }

    // Soft delete
    await db.ingredient.update({
      where: { id },
      data: { deletedAt: new Date() },
    })
    return NextResponse.json({ data: { message: 'Ingredient deleted' } })
  } catch (error) {
    console.error('Error deleting ingredient:', error)
    return NextResponse.json({ error: 'Failed to delete ingredient' }, { status: 500 })
  }
}

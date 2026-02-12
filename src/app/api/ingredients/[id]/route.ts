import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

// GET /api/ingredients/[id] - Get a single ingredient with full details
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId')

    const ingredient = await db.ingredient.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
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
        // Modifiers that link to this ingredient (via Modifier.ingredientId)
        linkedModifiers: {
          where: { deletedAt: null },
          select: {
            id: true,
            name: true,
            modifierGroup: {
              select: {
                id: true,
                name: true,
                // Item-owned groups: direct menuItemId relation
                menuItemId: true,
                menuItem: {
                  select: { id: true, name: true },
                },
                // Legacy shared groups: junction table relation
                menuItems: {
                  where: { deletedAt: null },
                  select: {
                    id: true,
                    menuItem: {
                      select: { id: true, name: true },
                    },
                  },
                },
              },
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
        // Input/Output transformation
        inputQuantity: ingredient.inputQuantity ? Number(ingredient.inputQuantity) : null,
        inputUnit: ingredient.inputUnit || null,
        outputQuantity: ingredient.outputQuantity ? Number(ingredient.outputQuantity) : null,
        outputUnit: ingredient.outputUnit || null,
        // Source type
        sourceType: ingredient.sourceType || 'delivered',
        showOnQuick86: ingredient.showOnQuick86 || false,
        currentPrepStock: ingredient.currentPrepStock ? Number(ingredient.currentPrepStock) : 0,
        lowStockThreshold: ingredient.lowStockThreshold ? Number(ingredient.lowStockThreshold) : null,
        criticalStockThreshold: ingredient.criticalStockThreshold ? Number(ingredient.criticalStockThreshold) : null,
        onlineStockThreshold: ingredient.onlineStockThreshold ? Number(ingredient.onlineStockThreshold) : null,
        resetDailyToZero: ingredient.resetDailyToZero,
        varianceHandling: ingredient.varianceHandling,
        varianceThreshold: ingredient.varianceThreshold ? Number(ingredient.varianceThreshold) : 10,
        countPrecision: ingredient.countPrecision || 'whole',
        needsVerification: ingredient.needsVerification,
        verifiedAt: ingredient.verifiedAt,
        verifiedBy: ingredient.verifiedBy,
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
        linkedModifiers: (ingredient.linkedModifiers || []).map(mod => {
          // Collect menu items from both sources:
          // 1. Item-owned groups: direct menuItem relation (via menuItemId)
          // 2. Legacy shared groups: junction table (MenuItemModifierGroup)
          const menuItemsMap = new Map<string, { id: string; name: string }>()

          // Source 1: Item-owned group (menuItemId → MenuItem)
          if (mod.modifierGroup.menuItem) {
            menuItemsMap.set(mod.modifierGroup.menuItem.id, {
              id: mod.modifierGroup.menuItem.id,
              name: mod.modifierGroup.menuItem.name,
            })
          }

          // Source 2: Legacy junction table (MenuItemModifierGroup)
          if (mod.modifierGroup.menuItems) {
            for (const mimg of mod.modifierGroup.menuItems as any[]) {
              if (mimg.menuItem && !menuItemsMap.has(mimg.menuItem.id)) {
                menuItemsMap.set(mimg.menuItem.id, {
                  id: mimg.menuItem.id,
                  name: mimg.menuItem.name,
                })
              }
            }
          }

          return {
            id: mod.id,
            name: mod.name,
            modifierGroup: {
              id: mod.modifierGroup.id,
              name: mod.modifierGroup.name,
            },
            menuItems: Array.from(menuItemsMap.values()),
          }
        }),
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
      // Verification
      needsVerification,
      verifiedAt,
      verifiedBy,
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
    // Verification
    if (needsVerification !== undefined) updateData.needsVerification = needsVerification
    if (verifiedAt !== undefined) updateData.verifiedAt = verifiedAt
    if (verifiedBy !== undefined) updateData.verifiedBy = verifiedBy

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
        // Input/Output transformation
        inputQuantity: ingredient.inputQuantity ? Number(ingredient.inputQuantity) : null,
        inputUnit: ingredient.inputUnit || null,
        outputQuantity: ingredient.outputQuantity ? Number(ingredient.outputQuantity) : null,
        outputUnit: ingredient.outputUnit || null,
        // Source type
        sourceType: ingredient.sourceType || 'delivered',
        showOnQuick86: ingredient.showOnQuick86 || false,
        currentPrepStock: ingredient.currentPrepStock ? Number(ingredient.currentPrepStock) : 0,
        lowStockThreshold: ingredient.lowStockThreshold ? Number(ingredient.lowStockThreshold) : null,
        criticalStockThreshold: ingredient.criticalStockThreshold ? Number(ingredient.criticalStockThreshold) : null,
        onlineStockThreshold: ingredient.onlineStockThreshold ? Number(ingredient.onlineStockThreshold) : null,
        resetDailyToZero: ingredient.resetDailyToZero,
        varianceHandling: ingredient.varianceHandling,
        varianceThreshold: ingredient.varianceThreshold ? Number(ingredient.varianceThreshold) : 10,
        countPrecision: ingredient.countPrecision || 'whole',
        needsVerification: ingredient.needsVerification,
        verifiedAt: ingredient.verifiedAt,
        verifiedBy: ingredient.verifiedBy,
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
    const locationId = searchParams.get('locationId')

    // Check if ingredient exists
    const existing = await db.ingredient.findFirst({
      where: { id, ...(locationId ? { locationId } : {}) },
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

      // Soft delete menu item links
      await db.menuItemIngredient.updateMany({
        where: { ingredientId: id },
        data: { deletedAt: new Date() },
      })

      // Soft delete children too
      await db.ingredient.updateMany({
        where: { parentIngredientId: id },
        data: { deletedAt: new Date() },
      })

      // Soft delete the ingredient
      await db.ingredient.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

      return NextResponse.json({ data: { message: 'Ingredient permanently deleted' } })
    }

    // Soft delete for production (cloud sync needs them)

    // Check if ingredient has child preparations
    if (existing._count.childIngredients > 0) {
      if (cascadeChildren) {
        // Soft delete all children first — soft delete their menu item links too
        const children = await db.ingredient.findMany({
          where: { parentIngredientId: id, deletedAt: null },
          select: { id: true },
        })
        const childIds = children.map(c => c.id)
        if (childIds.length > 0) {
          await db.menuItemIngredient.updateMany({
            where: { ingredientId: { in: childIds } },
            data: { deletedAt: new Date() },
          })
          await db.ingredient.updateMany({
            where: { parentIngredientId: id },
            data: { deletedAt: new Date() },
          })
        }
      } else {
        return NextResponse.json(
          { error: `Cannot delete: ingredient has ${existing._count.childIngredients} child preparation(s). Use ?cascadeChildren=true to delete all.` },
          { status: 400 }
        )
      }
    }

    // Soft delete menu item links
    await db.menuItemIngredient.updateMany({
      where: { ingredientId: id },
      data: { deletedAt: new Date() },
    })

    // Soft delete the ingredient
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

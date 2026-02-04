import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchInventoryAdjustment, dispatchStockLevelChange } from '@/lib/socket-dispatch'

/**
 * Calculate cost per unit from ingredient data
 */
function calculateCostPerUnit(ingredient: {
  purchaseCost: number | null
  unitsPerPurchase: number | null
}): number | null {
  if (ingredient.purchaseCost && ingredient.unitsPerPurchase && ingredient.unitsPerPurchase > 0) {
    return Number(ingredient.purchaseCost) / Number(ingredient.unitsPerPurchase)
  }
  return null
}

/**
 * Determine stock level based on thresholds
 */
function getStockLevel(
  stock: number,
  lowThreshold: number | null,
  criticalThreshold: number | null
): 'critical' | 'low' | 'ok' | 'good' {
  if (criticalThreshold !== null && stock <= criticalThreshold) return 'critical'
  if (lowThreshold !== null && stock <= lowThreshold) return 'low'
  if (lowThreshold !== null && stock > lowThreshold * 2) return 'good'
  return 'ok'
}

/**
 * GET /api/inventory/stock-adjust
 *
 * Returns all daily count items with their current stock levels.
 * Used by the Quick Stock Adjustment page.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Get all ingredients marked as daily count items
    const items = await db.ingredient.findMany({
      where: {
        locationId,
        deletedAt: null,
        isActive: true,
        isDailyCountItem: true,
      },
      include: {
        categoryRelation: {
          select: { id: true, name: true, icon: true, color: true }
        },
        parentIngredient: {
          select: { id: true, name: true }
        },
      },
      orderBy: [
        { categoryRelation: { name: 'asc' } },
        { name: 'asc' }
      ]
    })

    // Format response
    const formattedItems = items.map(item => ({
      id: item.id,
      name: item.name,
      category: item.categoryRelation?.name || 'Uncategorized',
      categoryIcon: item.categoryRelation?.icon,
      categoryColor: item.categoryRelation?.color,
      parentName: item.parentIngredient?.name,
      currentStock: Number(item.currentPrepStock) || 0,
      unit: item.outputUnit || item.standardUnit || 'each',
      countPrecision: item.countPrecision || 'whole',
      lowStockThreshold: item.lowStockThreshold ? Number(item.lowStockThreshold) : null,
      criticalStockThreshold: item.criticalStockThreshold ? Number(item.criticalStockThreshold) : null,
      lastCountedAt: item.lastCountedAt,
    }))

    // Group by category
    const byCategory: Record<string, typeof formattedItems> = {}
    formattedItems.forEach(item => {
      const cat = item.category
      if (!byCategory[cat]) {
        byCategory[cat] = []
      }
      byCategory[cat].push(item)
    })

    return NextResponse.json({
      data: {
        items: formattedItems,
        byCategory,
        totalItems: formattedItems.length,
      }
    })
  } catch (error) {
    console.error('Error fetching stock items:', error)
    return NextResponse.json({ error: 'Failed to fetch stock items' }, { status: 500 })
  }
}

/**
 * POST /api/inventory/stock-adjust
 *
 * Adjust the stock level of a single ingredient.
 * Supports: set (absolute), add, subtract operations.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ingredientId, operation, quantity, reason, employeeId } = body

    if (!ingredientId || operation === undefined || quantity === undefined) {
      return NextResponse.json(
        { error: 'ingredientId, operation, and quantity are required' },
        { status: 400 }
      )
    }

    // Get current ingredient with cost data
    const ingredient = await db.ingredient.findUnique({
      where: { id: ingredientId },
      select: {
        id: true,
        locationId: true,
        name: true,
        currentPrepStock: true,
        countPrecision: true,
        outputUnit: true,
        standardUnit: true,
        purchaseCost: true,
        unitsPerPurchase: true,
        lowStockThreshold: true,
        criticalStockThreshold: true,
      }
    })

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    const currentStock = Number(ingredient.currentPrepStock) || 0
    let newStock: number

    // Calculate new stock based on operation
    switch (operation) {
      case 'set':
        newStock = quantity
        break
      case 'add':
        newStock = currentStock + quantity
        break
      case 'subtract':
        newStock = currentStock - quantity
        break
      default:
        return NextResponse.json(
          { error: 'Invalid operation. Use: set, add, or subtract' },
          { status: 400 }
        )
    }

    // Don't allow negative stock
    if (newStock < 0) {
      newStock = 0
    }

    // Round based on precision
    if (ingredient.countPrecision === 'whole') {
      newStock = Math.round(newStock)
    } else {
      newStock = Math.round(newStock * 100) / 100
    }

    const quantityChange = newStock - currentStock
    const unit = ingredient.outputUnit || ingredient.standardUnit || 'unit'

    // Calculate cost impact
    const costPerUnit = calculateCostPerUnit({
      purchaseCost: ingredient.purchaseCost ? Number(ingredient.purchaseCost) : null,
      unitsPerPurchase: ingredient.unitsPerPurchase ? Number(ingredient.unitsPerPurchase) : null,
    })
    const totalCostImpact = costPerUnit ? quantityChange * costPerUnit : null

    // Update the stock
    const updated = await db.ingredient.update({
      where: { id: ingredientId },
      data: {
        currentPrepStock: newStock,
        lastCountedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        currentPrepStock: true,
        lastCountedAt: true,
      }
    })

    // Create stock adjustment record for cost tracking
    await db.ingredientStockAdjustment.create({
      data: {
        locationId: ingredient.locationId,
        ingredientId,
        type: 'manual',
        quantityBefore: currentStock,
        quantityChange,
        quantityAfter: newStock,
        unit,
        unitCost: costPerUnit,
        totalCostImpact,
        employeeId: employeeId || null,
        reason: reason || 'Quick stock adjustment',
      },
    })

    // Dispatch real-time update
    const stockLevel = getStockLevel(
      newStock,
      ingredient.lowStockThreshold ? Number(ingredient.lowStockThreshold) : null,
      ingredient.criticalStockThreshold ? Number(ingredient.criticalStockThreshold) : null
    )

    dispatchStockLevelChange(ingredient.locationId, {
      ingredientId,
      name: ingredient.name,
      currentStock: newStock,
      previousStock: currentStock,
      unit,
      stockLevel,
    }, { async: true }).catch(err => console.error('Stock dispatch failed:', err))

    // Build response message
    let message: string
    if (operation === 'set') {
      message = `${ingredient.name} set to ${newStock} ${unit}`
    } else if (quantityChange > 0) {
      message = `Added ${quantityChange} ${unit} to ${ingredient.name} (now ${newStock})`
    } else if (quantityChange < 0) {
      message = `Removed ${Math.abs(quantityChange)} ${unit} from ${ingredient.name} (now ${newStock})`
    } else {
      message = `${ingredient.name} unchanged at ${newStock} ${unit}`
    }

    return NextResponse.json({
      data: {
        ingredient: {
          id: updated.id,
          name: updated.name,
          currentStock: Number(updated.currentPrepStock),
          previousStock: currentStock,
          change: quantityChange,
          lastCountedAt: updated.lastCountedAt,
          costImpact: totalCostImpact,
        },
        message,
      }
    })
  } catch (error) {
    console.error('Error adjusting stock:', error)
    return NextResponse.json({ error: 'Failed to adjust stock' }, { status: 500 })
  }
}

/**
 * PATCH /api/inventory/stock-adjust
 *
 * Bulk update stock levels for multiple items at once.
 * Used by Quick Stock Adjust page with verification.
 * Creates audit trail and cost tracking records.
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { adjustments, employeeId } = body

    if (!adjustments || !Array.isArray(adjustments)) {
      return NextResponse.json(
        { error: 'adjustments array is required' },
        { status: 400 }
      )
    }

    if (!employeeId) {
      return NextResponse.json(
        { error: 'employeeId is required for stock adjustments' },
        { status: 400 }
      )
    }

    // Get employee info for audit trail
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, firstName: true, lastName: true }
    })

    const employeeName = employee
      ? `${employee.firstName} ${employee.lastName}`
      : 'Unknown'

    const results: Array<{
      id: string
      name: string
      previousStock: number
      newStock: number
      change: number
      unit: string
      costImpact: number | null
      success: boolean
      error?: string
    }> = []

    let locationId: string | null = null
    let totalCostImpact = 0

    // Process each adjustment
    for (const adj of adjustments) {
      const { ingredientId, quantity, operation = 'set' } = adj

      try {
        // Get ingredient with cost data
        const ingredient = await db.ingredient.findUnique({
          where: { id: ingredientId },
          select: {
            id: true,
            locationId: true,
            name: true,
            currentPrepStock: true,
            countPrecision: true,
            outputUnit: true,
            standardUnit: true,
            purchaseCost: true,
            unitsPerPurchase: true,
            lowStockThreshold: true,
            criticalStockThreshold: true,
          }
        })

        if (!ingredient) {
          results.push({
            id: ingredientId,
            name: 'Unknown',
            previousStock: 0,
            newStock: 0,
            change: 0,
            unit: 'unit',
            costImpact: null,
            success: false,
            error: 'Not found'
          })
          continue
        }

        locationId = ingredient.locationId
        const currentStock = Number(ingredient.currentPrepStock) || 0
        let newStock: number

        switch (operation) {
          case 'set':
            newStock = quantity
            break
          case 'add':
            newStock = currentStock + quantity
            break
          case 'subtract':
            newStock = currentStock - quantity
            break
          default:
            newStock = quantity
        }

        if (newStock < 0) newStock = 0
        if (ingredient.countPrecision === 'whole') {
          newStock = Math.round(newStock)
        } else {
          newStock = Math.round(newStock * 100) / 100
        }

        const quantityChange = newStock - currentStock
        const unit = ingredient.outputUnit || ingredient.standardUnit || 'unit'

        // Calculate cost
        const costPerUnit = calculateCostPerUnit({
          purchaseCost: ingredient.purchaseCost ? Number(ingredient.purchaseCost) : null,
          unitsPerPurchase: ingredient.unitsPerPurchase ? Number(ingredient.unitsPerPurchase) : null,
        })
        const itemCostImpact = costPerUnit ? quantityChange * costPerUnit : null

        if (itemCostImpact !== null) {
          totalCostImpact += itemCostImpact
        }

        // Update ingredient stock
        await db.ingredient.update({
          where: { id: ingredientId },
          data: {
            currentPrepStock: newStock,
            lastCountedAt: new Date(),
          }
        })

        // Create stock adjustment record
        await db.ingredientStockAdjustment.create({
          data: {
            locationId: ingredient.locationId,
            ingredientId,
            type: 'manual',
            quantityBefore: currentStock,
            quantityChange,
            quantityAfter: newStock,
            unit,
            unitCost: costPerUnit,
            totalCostImpact: itemCostImpact,
            employeeId,
            reason: 'Quick stock adjustment (bulk)',
          },
        })

        // Create audit log entry
        await db.auditLog.create({
          data: {
            locationId: ingredient.locationId,
            employeeId,
            action: 'stock_adjust',
            entityType: 'ingredient',
            entityId: ingredientId,
            details: {
              name: ingredient.name,
              previousStock: currentStock,
              newStock,
              change: quantityChange,
              unit,
              costPerUnit,
              costImpact: itemCostImpact,
            },
          },
        })

        results.push({
          id: ingredientId,
          name: ingredient.name,
          previousStock: currentStock,
          newStock,
          change: quantityChange,
          unit,
          costImpact: itemCostImpact,
          success: true,
        })
      } catch (err) {
        console.error(`Error adjusting ${ingredientId}:`, err)
        results.push({
          id: ingredientId,
          name: 'Unknown',
          previousStock: 0,
          newStock: 0,
          change: 0,
          unit: 'unit',
          costImpact: null,
          success: false,
          error: 'Update failed'
        })
      }
    }

    const successCount = results.filter(r => r.success).length
    const failCount = results.filter(r => !r.success).length

    // Dispatch real-time update for all changes
    if (locationId && successCount > 0) {
      dispatchInventoryAdjustment(locationId, {
        adjustments: results
          .filter(r => r.success)
          .map(r => ({
            ingredientId: r.id,
            name: r.name,
            previousStock: r.previousStock,
            newStock: r.newStock,
            change: r.change,
            unit: r.unit,
          })),
        adjustedById: employeeId,
        adjustedByName: employeeName,
        totalItems: successCount,
      }, { async: true }).catch(err => console.error('Inventory dispatch failed:', err))
    }

    return NextResponse.json({
      data: {
        results,
        summary: {
          total: adjustments.length,
          success: successCount,
          failed: failCount,
          totalCostImpact: Math.round(totalCostImpact * 100) / 100,
        },
        adjustedBy: {
          id: employeeId,
          name: employeeName,
        },
        message: `Updated ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}`
      }
    })
  } catch (error) {
    console.error('Error bulk adjusting stock:', error)
    return NextResponse.json({ error: 'Failed to bulk adjust stock' }, { status: 500 })
  }
}

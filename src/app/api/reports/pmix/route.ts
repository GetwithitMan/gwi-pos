import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getEffectiveCost, toNumber } from '@/lib/inventory-calculations'
import { pmixQuerySchema, validateRequest } from '@/lib/validations'
import { getLocationSettings } from '@/lib/location-cache'
import { parseSettings } from '@/lib/settings'

interface PMixItem {
  menuItemId: string
  name: string
  category: string
  department: string
  quantitySold: number
  grossSales: number
  discounts: number
  netSales: number
  foodCost: number
  foodCostPercent: number
  grossProfit: number
  grossProfitPercent: number
  mixPercent: number
}

// GET - Product Mix (P-Mix) report
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse and validate query parameters
    const queryParams = {
      locationId: searchParams.get('locationId'),
      startDate: searchParams.get('startDate'),
      endDate: searchParams.get('endDate'),
      department: searchParams.get('department') || undefined,
      categoryId: searchParams.get('categoryId') || undefined,
    }

    const validation = validateRequest(pmixQuerySchema, queryParams)
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { locationId, startDate, endDate, department, categoryId } = validation.data

    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_PRODUCT_MIX, { soft: true })
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Parse dates
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    // Get all completed order items in the date range
    const orderItems = await db.orderItem.findMany({
      where: {
        order: {
          locationId,
          status: { in: ['completed', 'paid'] },
          createdAt: { gte: start, lte: end },
        },
        deletedAt: null,
      },
      include: {
        order: {
          include: {
            discounts: true,
          },
        },
        menuItem: {
          include: {
            category: true,
            recipe: {
              include: {
                ingredients: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                      },
                    },
                    prepItem: {
                      include: {
                        ingredients: {
                          include: {
                            inventoryItem: {
                              select: {
                                id: true,
                                costPerUnit: true,
                                yieldCostPerUnit: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        modifiers: {
          include: {
            modifier: {
              include: {
                inventoryLink: {
                  include: {
                    inventoryItem: {
                      select: {
                        id: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                      },
                    },
                  },
                },
                // Fallback: Modifier.ingredientId → Ingredient → InventoryItem
                ingredient: {
                  select: {
                    id: true,
                    standardQuantity: true,
                    inventoryItem: {
                      select: {
                        id: true,
                        costPerUnit: true,
                        yieldCostPerUnit: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Track order totals for discount allocation
    const orderTotals = new Map<string, { subtotal: number; discountTotal: number }>()

    // First pass: calculate order subtotals and discount totals
    for (const orderItem of orderItems) {
      const orderId = orderItem.orderId
      const existing = orderTotals.get(orderId)

      const itemTotal = toNumber(orderItem.price) * orderItem.quantity
      const modifierTotal = orderItem.modifiers.reduce(
        (sum, m) => sum + toNumber(m.price) * (m.quantity || 1),
        0
      ) * orderItem.quantity
      const lineTotal = itemTotal + modifierTotal

      if (existing) {
        existing.subtotal += lineTotal
      } else {
        // Calculate order discount total
        const discountTotal = orderItem.order.discounts.reduce(
          (sum, d) => sum + toNumber(d.amount),
          0
        )
        orderTotals.set(orderId, {
          subtotal: lineTotal,
          discountTotal,
        })
      }
    }

    // Second pass: re-iterate to accumulate all item subtotals (first pass doesn't handle multiple items)
    // Actually let's fix the first pass to accumulate properly
    orderTotals.clear()
    for (const orderItem of orderItems) {
      const orderId = orderItem.orderId
      const itemTotal = toNumber(orderItem.price) * orderItem.quantity
      const modifierTotal = orderItem.modifiers.reduce(
        (sum, m) => sum + toNumber(m.price) * (m.quantity || 1),
        0
      ) * orderItem.quantity
      const lineTotal = itemTotal + modifierTotal

      const existing = orderTotals.get(orderId)
      if (existing) {
        existing.subtotal += lineTotal
      } else {
        const discountTotal = orderItem.order.discounts.reduce(
          (sum, d) => sum + toNumber(d.amount),
          0
        )
        orderTotals.set(orderId, {
          subtotal: lineTotal,
          discountTotal,
        })
      }
    }

    // Get tax rate for backing out inclusive tax
    const locationSettings = await getLocationSettings(locationId)
    const parsedSettings = locationSettings ? parseSettings(locationSettings) : null
    const taxRate = ((parsedSettings as any)?.tax?.defaultRate || 8) / 100

    // Aggregate by menu item
    const itemMap = new Map<string, {
      menuItem: NonNullable<typeof orderItems[0]['menuItem']>
      quantitySold: number
      grossSales: number
      discounts: number
      foodCost: number
      isTaxInclusive: boolean
    }>()

    for (const orderItem of orderItems) {
      if (!orderItem.menuItem) continue

      // Filter by department (case-insensitive comparison)
      const itemDepartment = orderItem.menuItem.category?.categoryType || ''
      if (department && itemDepartment.toLowerCase() !== department.toLowerCase()) continue
      if (categoryId && orderItem.menuItem.categoryId !== categoryId) continue

      const existing = itemMap.get(orderItem.menuItemId)
      const itemTotal = toNumber(orderItem.price) * orderItem.quantity
      const modifierTotal = orderItem.modifiers.reduce(
        (sum, m) => sum + toNumber(m.price) * (m.quantity || 1),
        0
      ) * orderItem.quantity
      const lineTotal = itemTotal + modifierTotal

      // Calculate proportional discount allocation
      let itemDiscount = 0
      const orderData = orderTotals.get(orderItem.orderId)
      if (orderData && orderData.subtotal > 0 && orderData.discountTotal > 0) {
        // Allocate discount proportionally based on line total / order subtotal
        const discountRatio = lineTotal / orderData.subtotal
        itemDiscount = orderData.discountTotal * discountRatio
      }

      // Calculate food cost for this item
      let itemFoodCost = 0

      // Recipe ingredients
      if (orderItem.menuItem.recipe) {
        for (const ing of orderItem.menuItem.recipe.ingredients) {
          const ingQty = toNumber(ing.quantity) * orderItem.quantity

          if (ing.inventoryItem) {
            const cost = getEffectiveCost(ing.inventoryItem)
            itemFoodCost += ingQty * cost
          } else if (ing.prepItem) {
            // Calculate prep item cost from its ingredients
            let prepCost = 0
            const batchYield = toNumber(ing.prepItem.batchYield) || 1

            for (const prepIng of ing.prepItem.ingredients) {
              if (prepIng.inventoryItem) {
                const rawCost = getEffectiveCost(prepIng.inventoryItem)
                prepCost += toNumber(prepIng.quantity) * rawCost
              }
            }

            // Cost per unit of prep item = total ingredient cost / batch yield
            const prepCostPerUnit = batchYield > 0 ? prepCost / batchYield : 0
            itemFoodCost += ingQty * prepCostPerUnit
          }
        }
      }

      // Modifier ingredients
      for (const mod of orderItem.modifiers) {
        const modQty = (mod.quantity || 1) * orderItem.quantity

        // Path A: ModifierInventoryLink (takes precedence)
        if (mod.modifier?.inventoryLink?.inventoryItem) {
          const linkQty = toNumber(mod.modifier.inventoryLink.usageQuantity) * modQty
          const cost = getEffectiveCost(mod.modifier.inventoryLink.inventoryItem)
          itemFoodCost += linkQty * cost
          continue  // inventoryLink found — skip fallback
        }

        // Path B: Modifier.ingredientId → Ingredient → InventoryItem (fallback)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ingredient = (mod.modifier as any)?.ingredient
        if (ingredient?.inventoryItem) {
          const stdQty = toNumber(ingredient.standardQuantity) || 1
          const ingQty = stdQty * modQty
          const cost = getEffectiveCost(ingredient.inventoryItem)
          itemFoodCost += ingQty * cost
        }
      }

      if (existing) {
        existing.quantitySold += orderItem.quantity
        existing.grossSales += lineTotal
        existing.discounts += itemDiscount
        existing.foodCost += itemFoodCost
      } else {
        itemMap.set(orderItem.menuItemId, {
          menuItem: orderItem.menuItem,
          quantitySold: orderItem.quantity,
          grossSales: lineTotal,
          discounts: itemDiscount,
          foodCost: itemFoodCost,
          isTaxInclusive: (orderItem as any).isTaxInclusive ?? false,
        })
      }
    }

    // Calculate totals for mix percentage
    const totalQuantity = Array.from(itemMap.values()).reduce((sum, item) => sum + item.quantitySold, 0)
    const totalGrossSales = Array.from(itemMap.values()).reduce((sum, item) => sum + item.grossSales, 0)

    // Build report items
    const pmixItems: PMixItem[] = Array.from(itemMap.entries()).map(([menuItemId, data]) => {
      // For tax-inclusive items, back out hidden tax for accurate revenue/profit
      const preTaxGross = data.isTaxInclusive
        ? data.grossSales / (1 + taxRate)
        : data.grossSales
      const netSales = preTaxGross - data.discounts
      const grossProfit = netSales - data.foodCost

      return {
        menuItemId,
        name: data.menuItem.name,
        category: data.menuItem.category?.name || 'Uncategorized',
        department: data.menuItem.category?.categoryType || 'other',
        quantitySold: data.quantitySold,
        grossSales: Math.round(preTaxGross * 100) / 100,
        discounts: data.discounts,
        netSales: Math.round(netSales * 100) / 100,
        foodCost: data.foodCost,
        foodCostPercent: netSales > 0 ? (data.foodCost / netSales) * 100 : 0,
        grossProfit: Math.round(grossProfit * 100) / 100,
        grossProfitPercent: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
        mixPercent: totalQuantity > 0 ? (data.quantitySold / totalQuantity) * 100 : 0,
      }
    })

    // Sort by quantity sold (most popular first)
    pmixItems.sort((a, b) => b.quantitySold - a.quantitySold)

    // Calculate summary
    const totalFoodCost = pmixItems.reduce((sum, item) => sum + item.foodCost, 0)
    const totalDiscounts = pmixItems.reduce((sum, item) => sum + item.discounts, 0)
    const totalNetSales = totalGrossSales - totalDiscounts
    const totalGrossProfit = totalNetSales - totalFoodCost

    return NextResponse.json({
      report: {
        locationId,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        department: department || 'All',
        category: categoryId || 'All',
        items: pmixItems,
        summary: {
          totalItems: pmixItems.length,
          totalQuantitySold: totalQuantity,
          totalGrossSales,
          totalDiscounts,
          totalNetSales,
          totalFoodCost,
          overallFoodCostPercent: totalNetSales > 0 ? (totalFoodCost / totalNetSales) * 100 : 0,
          totalGrossProfit,
          overallGrossProfitPercent: totalNetSales > 0 ? (totalGrossProfit / totalNetSales) * 100 : 0,
        },
      },
    })
  } catch (error) {
    console.error('P-Mix report error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

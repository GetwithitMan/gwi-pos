import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { toNumber } from '@/lib/inventory-calculations'
import { err, ok } from '@/lib/api-response'

/**
 * PAR (Periodic Automatic Replenishment) Inventory Report
 *
 * Returns all tracked InventoryItems with their current stock vs PAR levels,
 * average daily usage rate (from recent transactions), and projected
 * days until reorder point.
 *
 * GET /api/reports/inventory/par
 *   ?locationId=...
 *   &employeeId=...
 *   &department=...       (optional filter)
 *   &category=...         (optional filter)
 *   &belowParOnly=true    (optional — only items below PAR)
 *   &belowReorderOnly=true (optional — only items below reorder point)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const department = searchParams.get('department') || undefined
    const category = searchParams.get('category') || undefined
    const belowParOnly = searchParams.get('belowParOnly') === 'true'
    const belowReorderOnly = searchParams.get('belowReorderOnly') === 'true'

    if (!locationId) {
      return err('Location ID is required')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Build filter for inventory items
    const itemWhere: Record<string, unknown> = {
      locationId,
      trackInventory: true,
      isActive: true,
      deletedAt: null,
    }
    if (department) itemWhere.department = department
    if (category) itemWhere.category = category

    // Fetch all tracked inventory items
    const items = await db.inventoryItem.findMany({
      where: itemWhere,
      select: {
        id: true,
        name: true,
        sku: true,
        department: true,
        category: true,
        storageUnit: true,
        currentStock: true,
        parLevel: true,
        reorderPoint: true,
        reorderQty: true,
        costPerUnit: true,
        purchaseUnit: true,
      },
      orderBy: [{ department: 'asc' }, { category: 'asc' }, { name: 'asc' }],
    })

    if (items.length === 0) {
      return ok({
          items: [],
          summary: { totalItems: 0, belowPar: 0, belowReorder: 0, criticalItems: 0 },
        })
    }

    // Calculate usage rate from last 14 days of consumption transactions
    const usageLookbackDays = 14
    const lookbackDate = new Date()
    lookbackDate.setDate(lookbackDate.getDate() - usageLookbackDays)

    const transactions = await db.inventoryItemTransaction.findMany({
      where: {
        inventoryItemId: { in: items.map(i => i.id) },
        // Consumption types: sale deductions, waste, adjustments down
        type: { in: ['sale', 'waste', 'adjustment'] },
        quantityChange: { lt: 0 }, // Only deductions
        createdAt: { gte: lookbackDate },
      },
      select: {
        inventoryItemId: true,
        quantityChange: true,
      },
    })

    // Also get the last inventory count date for each item
    const lastCounts = await db.inventoryCountEntry.findMany({
      where: {
        locationId,
        inventoryItemId: { in: items.map(i => i.id) },
      },
      orderBy: { createdAt: 'desc' },
      distinct: ['inventoryItemId'],
      select: {
        inventoryItemId: true,
        createdAt: true,
      },
    })

    // Build usage rate map: total consumption / days
    const usageMap = new Map<string, number>()
    for (const tx of transactions) {
      const current = usageMap.get(tx.inventoryItemId) || 0
      // quantityChange is negative for consumption, so negate it
      usageMap.set(tx.inventoryItemId, current + Math.abs(toNumber(tx.quantityChange)))
    }

    // Build last count date map
    const lastCountMap = new Map<string, Date>()
    for (const count of lastCounts) {
      lastCountMap.set(count.inventoryItemId, count.createdAt)
    }

    // Build PAR report items
    const parItems = items.map(item => {
      const currentStock = toNumber(item.currentStock)
      const parLevel = item.parLevel !== null ? toNumber(item.parLevel) : null
      const reorderPoint = item.reorderPoint !== null ? toNumber(item.reorderPoint) : null
      const reorderQty = item.reorderQty !== null ? toNumber(item.reorderQty) : null
      const costPerUnit = toNumber(item.costPerUnit)

      // Average daily usage over lookback period
      const totalUsage = usageMap.get(item.id) || 0
      const usageRate = totalUsage / usageLookbackDays

      // Status flags
      const belowPar = parLevel !== null && currentStock < parLevel
      const belowReorder = reorderPoint !== null && currentStock < reorderPoint

      // Suggested order: how much to bring back to PAR level
      const suggestedOrder = parLevel !== null && currentStock < parLevel
        ? Math.max(0, parLevel - currentStock)
        : 0

      // Days until reorder point is reached (based on usage rate)
      let daysUntilReorder: number | null = null
      if (reorderPoint !== null && usageRate > 0 && currentStock > reorderPoint) {
        daysUntilReorder = Math.round(((currentStock - reorderPoint) / usageRate) * 10) / 10
      } else if (reorderPoint !== null && currentStock <= reorderPoint) {
        daysUntilReorder = 0
      }

      const lastCountDate = lastCountMap.get(item.id) || null

      return {
        id: item.id,
        name: item.name,
        sku: item.sku,
        department: item.department,
        category: item.category,
        unit: item.storageUnit,
        purchaseUnit: item.purchaseUnit,
        currentStock: Math.round(currentStock * 100) / 100,
        parLevel,
        reorderPoint,
        reorderQty,
        belowPar,
        belowReorder,
        suggestedOrder: Math.round(suggestedOrder * 100) / 100,
        usageRate: Math.round(usageRate * 100) / 100,
        daysUntilReorder,
        lastCountDate: lastCountDate ? lastCountDate.toISOString().split('T')[0] : null,
        costPerUnit,
        suggestedOrderCost: Math.round(suggestedOrder * costPerUnit * 100) / 100,
      }
    })

    // Apply optional filters
    let filteredItems = parItems
    if (belowParOnly) {
      filteredItems = filteredItems.filter(i => i.belowPar)
    }
    if (belowReorderOnly) {
      filteredItems = filteredItems.filter(i => i.belowReorder)
    }

    // Calculate summary
    const belowParCount = parItems.filter(i => i.belowPar).length
    const belowReorderCount = parItems.filter(i => i.belowReorder).length
    // Critical: below reorder AND usage rate means they'll run out soon
    const criticalItems = parItems.filter(i =>
      i.belowReorder && i.daysUntilReorder !== null && i.daysUntilReorder <= 1
    ).length

    return ok({
        items: filteredItems,
        summary: {
          totalItems: parItems.length,
          belowPar: belowParCount,
          belowReorder: belowReorderCount,
          criticalItems,
          totalSuggestedOrderCost: Math.round(
            parItems.reduce((sum, i) => sum + i.suggestedOrderCost, 0) * 100
          ) / 100,
        },
      })
  } catch (error) {
    console.error('PAR report error:', error)
    return err('Failed to generate PAR report', 500)
  }
})

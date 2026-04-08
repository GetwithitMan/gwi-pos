import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { toNumber } from '@/lib/inventory-calculations'
import { err, ok } from '@/lib/api-response'

interface VarianceReportItem {
  id: string
  inventoryItemId: string
  itemName: string
  itemSku: string | null
  itemCategory: string
  itemUnit: string
  expectedQty: number
  countedQty: number | null
  variance: number | null
  variancePct: number | null
  varianceValue: number | null
  costPerUnit: number
  isAboveThreshold: boolean
  countDate: string
  countId: string
}

interface VarianceReportSummary {
  totalItemsCounted: number
  itemsWithVariance: number
  itemsAboveThreshold: number
  avgVariancePercent: number
  totalVarianceValue: number
  dateRange: {
    from: string
    to: string
  }
  varianceAlertThreshold: number
}

/**
 * Inventory Count Variance Report
 *
 * Queries actual InventoryCountItem records (completed counts) and returns:
 * - Items with their expected vs counted quantities
 * - Stored variance and variance percent
 * - Flags items exceeding the varianceAlertPct threshold
 * - Summarized by count date and location
 *
 * GET /api/inventory/counts/variance
 *   ?locationId=...
 *   &startDate=YYYY-MM-DD
 *   &endDate=YYYY-MM-DD
 *   &categoryId=...            (optional)
 *   &employeeId=...            (optional)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // Parse query parameters
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const categoryId = searchParams.get('categoryId') || undefined
    const requestingEmployeeId = searchParams.get('employeeId') || searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return err('Location ID is required')
    }

    if (!startDate || !endDate) {
      return err('Start date and end date are required')
    }

    // Validate permission
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Parse and validate dates
    const start = new Date(startDate)
    const end = new Date(endDate)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return err('Invalid date format. Use YYYY-MM-DD')
    }

    // Set end date to end of day
    end.setHours(23, 59, 59, 999)

    // Get location settings for variance alert threshold
    const settings = await db.inventorySettings.findFirst({
      where: { locationId },
      select: { varianceAlertPct: true },
    })

    const varianceAlertPct = settings ? toNumber(settings.varianceAlertPct) : 5

    // Build query filter for counts
    const countWhere: Record<string, unknown> = {
      locationId,
      countDate: {
        gte: start,
        lte: end,
      },
      status: 'reviewed', // Only completed/reviewed counts
      deletedAt: null,
    }

    // Query counts with their items
    const counts = await db.inventoryCount.findMany({
      where: countWhere,
      select: {
        id: true,
        countDate: true,
        items: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            inventoryItemId: true,
            expectedQty: true,
            countedQty: true,
            variance: true,
            variancePct: true,
            varianceValue: true,
            inventoryItem: {
              select: {
                id: true,
                name: true,
                sku: true,
                category: true,
                storageUnit: true,
                costPerUnit: true,
              },
            },
          },
        },
      },
      orderBy: { countDate: 'desc' },
    })

    // Build detailed variance report
    const reportItems: VarianceReportItem[] = []
    let itemsAboveThreshold = 0
    let totalVarianceValue = 0
    let sumVariancePercent = 0
    let countItemsWithVariance = 0

    for (const count of counts) {
      for (const item of count.items) {
        // Skip items not counted
        if (item.countedQty === null) {
          continue
        }

        const variance = toNumber(item.variance)
        const variancePct = toNumber(item.variancePct)
        const varianceValue = toNumber(item.varianceValue)
        const costPerUnit = toNumber(item.inventoryItem.costPerUnit)
        const isAboveThreshold = Math.abs(variancePct) > varianceAlertPct

        if (isAboveThreshold) {
          itemsAboveThreshold++
        }

        if (variance !== 0) {
          countItemsWithVariance++
          sumVariancePercent += Math.abs(variancePct)
          totalVarianceValue += varianceValue
        }

        reportItems.push({
          id: item.id,
          inventoryItemId: item.inventoryItemId,
          itemName: item.inventoryItem.name,
          itemSku: item.inventoryItem.sku,
          itemCategory: item.inventoryItem.category,
          itemUnit: item.inventoryItem.storageUnit,
          expectedQty: toNumber(item.expectedQty),
          countedQty: item.countedQty ? toNumber(item.countedQty) : null,
          variance,
          variancePct,
          varianceValue,
          costPerUnit,
          isAboveThreshold,
          countDate: count.countDate.toISOString().split('T')[0],
          countId: count.id,
        })
      }
    }

    // Sort by absolute variance descending (worst variance first)
    reportItems.sort(
      (a, b) =>
        (Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0)) ||
        (Math.abs(b.variancePct ?? 0) - Math.abs(a.variancePct ?? 0))
    )

    // Build summary
    const avgVariancePercent = countItemsWithVariance > 0 ? sumVariancePercent / countItemsWithVariance : 0
    const summary: VarianceReportSummary = {
      totalItemsCounted: reportItems.length,
      itemsWithVariance: countItemsWithVariance,
      itemsAboveThreshold,
      avgVariancePercent: Math.round(avgVariancePercent * 100) / 100,
      totalVarianceValue: Math.round(totalVarianceValue * 100) / 100,
      dateRange: {
        from: startDate,
        to: endDate,
      },
      varianceAlertThreshold: varianceAlertPct,
    }

    return ok({
      items: reportItems,
      summary,
    })
  } catch (error) {
    console.error('Inventory count variance report error:', error)
    return err('Failed to generate variance report', 500)
  }
})

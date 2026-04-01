import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'
import { calculateTheoreticalUsage, toNumber } from '@/lib/inventory-calculations'
import { err, ok } from '@/lib/api-response'

/**
 * Inventory Variance Report — Expected vs Actual Usage
 *
 * Compares theoretical usage (from recipes x items sold) against
 * actual usage (from inventory transactions / count deltas).
 *
 * GET /api/reports/inventory/variance
 *   ?locationId=...
 *   &employeeId=...
 *   &days=7|14|30          (lookback period, default 7)
 *   &department=...        (optional filter)
 *   &category=...          (optional filter)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')
    const days = parseInt(searchParams.get('days') || '7', 10) || 7
    const department = searchParams.get('department') || undefined
    const category = searchParams.get('category') || undefined

    if (!locationId) {
      return err('Location ID is required')
    }

    if (![7, 14, 30].includes(days)) {
      return err('Days must be 7, 14, or 30')
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    startDate.setHours(0, 0, 0, 0)

    // Build inventory item filter
    const itemWhere: Record<string, unknown> = {
      locationId,
      trackInventory: true,
      isActive: true,
      deletedAt: null,
    }
    if (department) itemWhere.department = department
    if (category) itemWhere.category = category

    // Run theoretical usage calculation and fetch items + transactions in parallel
    const [theoreticalResult, items, transactions] = await Promise.all([
      calculateTheoreticalUsage({
        locationId,
        startDate,
        endDate,
        department,
      }),
      db.inventoryItem.findMany({
        where: itemWhere,
        select: {
          id: true,
          name: true,
          sku: true,
          department: true,
          category: true,
          storageUnit: true,
          costPerUnit: true,
        },
      }),
      db.inventoryItemTransaction.findMany({
        where: {
          locationId,
          // Actual consumption: sales + waste
          type: { in: ['sale', 'waste'] },
          quantityChange: { lt: 0 },
          createdAt: { gte: startDate, lte: endDate },
        },
        select: {
          inventoryItemId: true,
          quantityChange: true,
        },
      }),
    ])

    // Build theoretical usage map
    const theoreticalMap = new Map<string, number>()
    for (const item of theoreticalResult.usage) {
      theoreticalMap.set(item.inventoryItemId, item.theoreticalUsage)
    }

    // Build actual usage map from transactions (deductions are negative, so negate)
    const actualMap = new Map<string, number>()
    for (const tx of transactions) {
      const current = actualMap.get(tx.inventoryItemId) || 0
      actualMap.set(tx.inventoryItemId, current + Math.abs(toNumber(tx.quantityChange)))
    }

    // Build variance items
    const varianceItems = items
      .map(item => {
        const expectedUsage = theoreticalMap.get(item.id) || 0
        const actualUsage = actualMap.get(item.id) || 0

        // Skip items with zero usage in both columns
        if (expectedUsage === 0 && actualUsage === 0) return null

        const variance = expectedUsage - actualUsage // Positive = used less than expected, Negative = used more
        const variancePercent = expectedUsage > 0
          ? Math.round((variance / expectedUsage) * -100 * 10) / 10 // Negative % = over-usage
          : actualUsage > 0 ? -100 : 0

        const absPercent = Math.abs(variancePercent)
        let status: 'ok' | 'warning' | 'high_variance'
        if (absPercent > 25) {
          status = 'high_variance'
        } else if (absPercent > 10) {
          status = 'warning'
        } else {
          status = 'ok'
        }

        const costPerUnit = toNumber(item.costPerUnit)

        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          department: item.department,
          category: item.category,
          unit: item.storageUnit,
          expectedUsage: Math.round(expectedUsage * 100) / 100,
          actualUsage: Math.round(actualUsage * 100) / 100,
          variance: Math.round(variance * 100) / 100,
          variancePercent,
          varianceCost: Math.round((actualUsage - expectedUsage) * costPerUnit * 100) / 100,
          status,
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => Math.abs(b.variancePercent) - Math.abs(a.variancePercent))

    // Summary
    const okCount = varianceItems.filter(i => i.status === 'ok').length
    const warningCount = varianceItems.filter(i => i.status === 'warning').length
    const highVarianceCount = varianceItems.filter(i => i.status === 'high_variance').length
    const totalVarianceCost = varianceItems.reduce((sum, i) => sum + i.varianceCost, 0)

    return ok({
        items: varianceItems,
        period: {
          from: startDate.toISOString().split('T')[0],
          to: endDate.toISOString().split('T')[0],
          days,
        },
        summary: {
          totalItems: varianceItems.length,
          ok: okCount,
          warning: warningCount,
          highVariance: highVarianceCount,
          totalVarianceCost: Math.round(totalVarianceCost * 100) / 100,
        },
      })
  } catch (error) {
    console.error('Inventory variance report error:', error)
    return err('Failed to generate variance report', 500)
  }
})

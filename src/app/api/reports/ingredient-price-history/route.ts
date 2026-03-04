import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const inventoryItemId = searchParams.get('inventoryItemId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '50')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const range = dateRangeToUTC(startDate || defaultStart, endDate || defaultEnd, timezone)

    const where: Record<string, unknown> = {
      locationId,
      effectiveDate: { gte: range.start, lte: range.end },
    }
    if (inventoryItemId) {
      where.inventoryItemId = inventoryItemId
    }

    const records = await db.ingredientCostHistory.findMany({
      where,
      include: {
        inventoryItem: {
          select: { id: true, name: true, costPerUnit: true, storageUnit: true },
        },
      },
      orderBy: [
        { effectiveDate: 'desc' },
      ],
      take: limit,
    })

    // Group by inventoryItemId
    const grouped = new Map<string, {
      inventoryItemId: string, name: string, currentCost: number, unit: string,
      changes: Array<{
        id: string, oldCost: number, newCost: number, changePercent: number,
        source: string, invoiceNumber: string | null, vendorName: string | null,
        effectiveDate: Date,
      }>
    }>()

    for (const r of records) {
      const key = r.inventoryItemId
      const change = {
        id: r.id,
        oldCost: Number(r.oldCostPerUnit),
        newCost: Number(r.newCostPerUnit),
        changePercent: Number(r.changePercent),
        source: r.source,
        invoiceNumber: r.invoiceNumber,
        vendorName: r.vendorName,
        effectiveDate: r.effectiveDate,
      }

      if (grouped.has(key)) {
        grouped.get(key)!.changes.push(change)
      } else {
        grouped.set(key, {
          inventoryItemId: r.inventoryItem.id,
          name: r.inventoryItem.name,
          currentCost: Number(r.inventoryItem.costPerUnit),
          unit: r.inventoryItem.storageUnit,
          changes: [change],
        })
      }
    }

    // Sort groups by largest absolute change percent of most recent change
    const items = Array.from(grouped.values()).sort((a, b) => {
      const aMax = Math.max(...a.changes.map(c => Math.abs(c.changePercent)))
      const bMax = Math.max(...b.changes.map(c => Math.abs(c.changePercent)))
      return bMax - aMax
    })

    return NextResponse.json({
      data: {
        items,
        totalChanges: records.length,
        dateRange: { start: range.start, end: range.end },
      },
    })
  } catch (error) {
    console.error('Failed to generate ingredient price history report:', error)
    return NextResponse.json({ error: 'Failed to generate ingredient price history report' }, { status: 500 })
  }
})

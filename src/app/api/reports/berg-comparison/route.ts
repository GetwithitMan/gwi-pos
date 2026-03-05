import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/reports/berg-comparison
 * Returns POS pour data per PLU mapping in Berg-compatible column format.
 * Supports ?format=csv for CSV export.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const format = searchParams.get('format') || 'json'
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId') || ''

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter (matches liquor report pattern)
    const orderDateFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      const dateRange: { gte?: Date; lte?: Date } = {}
      if (startDate) dateRange.gte = new Date(startDate)
      if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')
      orderDateFilter.OR = [
        { businessDayDate: dateRange },
        { businessDayDate: null, createdAt: dateRange },
      ]
    }

    // Load all active location-scoped PLU mappings (deviceId=null for Tier 1)
    const mappings = await db.bergPluMapping.findMany({
      where: { locationId, isActive: true },
      orderBy: { pluNumber: 'asc' },
    })

    // For each mapping with a menuItemId, query sales
    const mappingResults = await Promise.all(
      mappings.map(async (mapping) => {
        const pourSizeOz = mapping.pourSizeOzOverride
          ? Number(mapping.pourSizeOzOverride)
          : 1.5 // default pour size

        let pourCount = 0
        let totalOz = 0
        let totalRevenue = 0
        let totalCost = 0
        let menuItemName = mapping.description || `PLU ${mapping.pluNumber}`

        if (mapping.menuItemId) {
          // Query OrderItems by menuItemId using nested order filter (matches liquor report pattern)
          const orderItems = await db.orderItem.findMany({
            where: {
              locationId,
              menuItemId: mapping.menuItemId,
              status: 'active',
              order: {
                locationId,
                status: { in: ['paid', 'completed'] },
                ...orderDateFilter,
              },
            },
            include: { menuItem: true },
          })

          for (const item of orderItems) {
            const qty = item.quantity || 1
            pourCount += qty
            totalOz += qty * pourSizeOz
            totalRevenue += qty * Number(item.price || 0)
            totalCost += qty * Number(item.menuItem?.cost || 0)
            if (item.menuItem?.name) menuItemName = item.menuItem.name
          }
        }

        const pluStr = String(mapping.pluNumber).padStart(3, '0')
        const descPadded = (mapping.description || menuItemName).toUpperCase().padEnd(20, ' ').slice(0, 20)
        const bergFormatRow = `${pluStr}  ${descPadded}  ${pourCount.toString().padStart(4, ' ')}  ${totalOz.toFixed(1).padStart(7, ' ')}oz  $${totalRevenue.toFixed(2).padStart(8, ' ')}`

        return {
          pluNumber: mapping.pluNumber,
          description: mapping.description,
          bottleProductId: mapping.bottleProductId,
          menuItemId: mapping.menuItemId,
          menuItemName,
          pourCount,
          totalOz: Math.round(totalOz * 10) / 10,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          avgPourOz: pourCount > 0 ? Math.round((totalOz / pourCount) * 100) / 100 : pourSizeOz,
          bergFormatRow,
        }
      })
    )

    const totals = mappingResults.reduce(
      (acc, r) => ({
        pourCount: acc.pourCount + r.pourCount,
        totalOz: Math.round((acc.totalOz + r.totalOz) * 10) / 10,
        totalRevenue: Math.round((acc.totalRevenue + r.totalRevenue) * 100) / 100,
        totalCost: Math.round((acc.totalCost + r.totalCost) * 100) / 100,
      }),
      { pourCount: 0, totalOz: 0, totalRevenue: 0, totalCost: 0 }
    )

    const unmappedPluCount = mappings.filter((m) => !m.menuItemId && !m.bottleProductId).length

    if (format === 'csv') {
      const header = 'PLU#,Description,Mapped Item,Pour Count,Total Oz,Revenue,Cost,Avg Pour Oz'
      const rows = mappingResults.map((r) =>
        [
          r.pluNumber,
          `"${(r.description || '').replace(/"/g, '""')}"`,
          `"${r.menuItemName.replace(/"/g, '""')}"`,
          r.pourCount,
          r.totalOz,
          r.totalRevenue.toFixed(2),
          r.totalCost.toFixed(2),
          r.avgPourOz,
        ].join(',')
      )
      const csv = [header, ...rows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-comparison-${startDate || 'all'}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      mappings: mappingResults,
      totals,
      unmappedPluCount,
    })
  } catch (err) {
    console.error('[berg-comparison GET]', err)
    return NextResponse.json({ error: 'Failed to generate Berg comparison report' }, { status: 500 })
  }
})

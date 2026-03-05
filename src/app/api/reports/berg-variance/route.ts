import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/reports/berg-variance
 * POS order rings vs Berg actual pours per PLU/bottle.
 * Period: startDate-endDate. Excludes BAD_LRC events from Berg side.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const format = searchParams.get('format') || 'json'
    const requestingEmployeeId = searchParams.get('employeeId') || ''
    const alertThresholdPct = parseFloat(searchParams.get('alertThreshold') || '5')

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (startDate) dateFilter.gte = new Date(startDate)
    if (endDate) dateFilter.lte = new Date(endDate + 'T23:59:59')

    // Load all active PLU mappings
    const mappings = await db.bergPluMapping.findMany({
      where: { locationId, isActive: true },
      orderBy: { pluNumber: 'asc' },
    })

    // Count unknown PLU dispense events (not in any mapping)
    const unknownPluCount = await db.bergDispenseEvent.count({
      where: {
        locationId,
        lrcValid: true,
        pluMappingId: null,
        ...(Object.keys(dateFilter).length > 0 ? { receivedAt: dateFilter } : {}),
      },
    })

    const rows = await Promise.all(
      mappings.map(async (mapping) => {
        const pourSizeOz = mapping.pourSizeOzOverride ? Number(mapping.pourSizeOzOverride) : 1.5

        // Berg side: count valid ACK'd dispense events for this PLU mapping
        const bergEvents = await db.bergDispenseEvent.findMany({
          where: {
            locationId,
            pluMappingId: mapping.id,
            lrcValid: true,
            status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'] },
            ...(Object.keys(dateFilter).length > 0 ? { receivedAt: dateFilter } : {}),
          },
        })
        const bergPourCount = bergEvents.length
        const bergTotalOz = Math.round(bergPourCount * pourSizeOz * 10) / 10

        // POS side: count order items for the mapped menu item
        let posPourCount = 0
        let posTotalOz = 0
        let posRevenue = 0

        if (mapping.menuItemId) {
          const orderItems = await db.orderItem.findMany({
            where: {
              locationId,
              menuItemId: mapping.menuItemId,
              status: 'active',
              order: {
                locationId,
                status: { in: ['paid', 'closed', 'completed'] },
                ...(Object.keys(dateFilter).length > 0 ? {
                  OR: [
                    { businessDayDate: dateFilter },
                    { businessDayDate: null, createdAt: dateFilter },
                  ],
                } : {}),
              },
            },
          })
          posPourCount = orderItems.reduce((s, i) => s + (i.quantity || 1), 0)
          posTotalOz = Math.round(posPourCount * pourSizeOz * 10) / 10
          posRevenue = Math.round(orderItems.reduce((s, i) => s + (i.quantity || 1) * Number(i.price || 0), 0) * 100) / 100
        }

        const varCount = posPourCount - bergPourCount
        const varOz = Math.round((posTotalOz - bergTotalOz) * 10) / 10
        const varPct = bergPourCount > 0 ? Math.round(((posPourCount - bergPourCount) / bergPourCount) * 100 * 10) / 10 : null
        const alert = varPct !== null && Math.abs(varPct) >= alertThresholdPct

        return {
          pluNumber: mapping.pluNumber,
          description: mapping.description || `PLU ${mapping.pluNumber}`,
          menuItemId: mapping.menuItemId,
          posRings: posPourCount,
          bergPours: bergPourCount,
          posOz: posTotalOz,
          bergOz: bergTotalOz,
          varCount,
          varOz,
          varPct,
          posRevenue,
          alert,
        }
      })
    )

    const totals = rows.reduce((acc, r) => ({
      posRings: acc.posRings + r.posRings,
      bergPours: acc.bergPours + r.bergPours,
      posOz: Math.round((acc.posOz + r.posOz) * 10) / 10,
      bergOz: Math.round((acc.bergOz + r.bergOz) * 10) / 10,
    }), { posRings: 0, bergPours: 0, posOz: 0, bergOz: 0 })

    const alertCount = rows.filter(r => r.alert).length

    if (format === 'csv') {
      const header = 'PLU#,Description,POS Rings,Berg Pours,Var Count,POS Oz,Berg Oz,Var Oz,Var %,Revenue,Alert'
      const csvRows = rows.map(r =>
        [r.pluNumber, `"${(r.description || '').replace(/"/g, '""')}"`, r.posRings, r.bergPours,
          r.varCount, r.posOz, r.bergOz, r.varOz, r.varPct ?? '', r.posRevenue, r.alert ? 'YES' : ''].join(',')
      )
      const csv = [header, ...csvRows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-variance-${startDate || 'all'}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { startDate, endDate },
      rows,
      totals,
      alertCount,
      alertThresholdPct,
      unknownPluCount,
      dataQualityNote: unknownPluCount > 0
        ? `${unknownPluCount} pours with unknown PLU excluded from variance`
        : null,
    })
  } catch (err) {
    console.error('[reports/berg-variance]', err)
    return NextResponse.json({ error: 'Failed to load variance report' }, { status: 500 })
  }
})

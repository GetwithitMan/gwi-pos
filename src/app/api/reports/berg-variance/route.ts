import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

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

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return err(auth.error, auth.status)

    const dateFilter: { gte?: Date; lte?: Date } = {}
    if (startDate) dateFilter.gte = new Date(startDate)
    if (endDate) dateFilter.lte = new Date(endDate + 'T23:59:59')

    // FIX 2: Use businessDate for Berg event filter (not receivedAt)
    const bergDateFilter: Record<string, unknown> = {}
    if (startDate || endDate) {
      const dateRange: { gte?: Date; lte?: Date } = {}
      if (startDate) dateRange.gte = new Date(startDate)
      if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')
      bergDateFilter.OR = [
        { businessDate: dateRange },
        { businessDate: null, receivedAt: dateRange },
      ]
    }

    const alertThreshold = alertThresholdPct

    // FIX 4: Load ALL PLU mappings (not just active)
    const mappings = await db.bergPluMapping.findMany({
      where: { locationId },
      orderBy: { pluNumber: 'asc' },
    })

    // FIX 5: Filter out mappings from inactive devices
    const deviceIds = [...new Set(mappings.map(m => m.deviceId).filter(Boolean))] as string[]
    const activeDevices = deviceIds.length > 0
      ? await db.bergDevice.findMany({ where: { id: { in: deviceIds }, isActive: true }, select: { id: true } })
      : []
    const activeDeviceIds = new Set(activeDevices.map(d => d.id))
    const filteredMappings = mappings.filter(m => m.deviceId === null || activeDeviceIds.has(m.deviceId))

    const mappingResults = await Promise.all(
      filteredMappings.map(async (mapping) => {
        const pourSizeOz = mapping.pourSizeOzOverride ? Number(mapping.pourSizeOzOverride) : 1.5

        // FIX 3: Use event's stored pourSizeOz for Berg oz calculation
        const bergEvents = await db.bergDispenseEvent.findMany({
          where: {
            locationId,
            pluMappingId: mapping.id,
            lrcValid: true,
            status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'] },
            ...(Object.keys(bergDateFilter).length > 0 ? bergDateFilter : {}),
          },
          select: { pourSizeOz: true },
        })
        const bergPourCount = bergEvents.length
        const bergTotalOz = Math.round(
          bergEvents.reduce((s, e) => s + Number(e.pourSizeOz ?? pourSizeOz), 0) * 10
        ) / 10

        // POS side: count order items for the mapped menu item
        let posPourCount = 0
        let posTotalOz = 0
        let posRevenue = 0

        if (mapping.menuItemId) {
          // FIX 6: Include open orders in POS count
          const orderItems = await db.orderItem.findMany({
            where: {
              locationId,
              menuItemId: mapping.menuItemId,
              status: 'active',
              order: {
                locationId,
                status: { in: ['paid', 'closed', 'completed', 'open', 'in_progress'] },
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
        const variancePct = bergPourCount > 0 ? Math.round(((posPourCount - bergPourCount) / bergPourCount) * 100 * 10) / 10 : null
        const alert = variancePct !== null && Math.abs(variancePct) >= alertThreshold

        return {
          pluNumber: mapping.pluNumber,
          description: mapping.description || `PLU ${mapping.pluNumber}`,
          menuItemId: mapping.menuItemId,
          menuItemName: null as string | null,
          mappingStatus: 'mapped' as const,
          isActive: mapping.isActive,
          posRings: posPourCount,
          bergPours: bergPourCount,
          posOz: posTotalOz,
          bergOz: bergTotalOz,
          varCount,
          varOz,
          variancePct,
          posRevenue,
          alert,
        }
      })
    )

    // FIX 4: Include unknown PLU rows
    const unknownEvents = await db.bergDispenseEvent.findMany({
      where: {
        locationId,
        pluMappingId: null,
        lrcValid: true,
        ...(Object.keys(bergDateFilter).length > 0 ? bergDateFilter : {}),
      },
      select: { pluNumber: true, pourSizeOz: true },
    })
    const unknownByPlu = new Map<number, { count: number; oz: number }>()
    for (const ev of unknownEvents) {
      const existing = unknownByPlu.get(ev.pluNumber) ?? { count: 0, oz: 0 }
      unknownByPlu.set(ev.pluNumber, {
        count: existing.count + 1,
        oz: existing.oz + Number(ev.pourSizeOz ?? 1.5),
      })
    }
    const unknownRows = Array.from(unknownByPlu.entries()).map(([plu, data]) => ({
      pluNumber: plu,
      description: `Unknown PLU ${plu}`,
      menuItemId: null as string | null,
      menuItemName: null as string | null,
      mappingStatus: 'unknown' as const,
      isActive: false,
      posRings: 0,
      bergPours: data.count,
      posOz: 0,
      bergOz: Math.round(data.oz * 10) / 10,
      varCount: 0 - data.count,
      varOz: 0 - Math.round(data.oz * 10) / 10,
      variancePct: null as number | null,
      posRevenue: 0,
      alert: false,
    }))

    const allRows = [...mappingResults, ...unknownRows]
    const unknownPluCount = unknownEvents.length

    const totals = mappingResults.reduce((acc, r) => ({
      posRings: acc.posRings + r.posRings,
      bergPours: acc.bergPours + r.bergPours,
      posOz: Math.round((acc.posOz + r.posOz) * 10) / 10,
      bergOz: Math.round((acc.bergOz + r.bergOz) * 10) / 10,
    }), { posRings: 0, bergPours: 0, posOz: 0, bergOz: 0 })

    if (format === 'csv') {
      const header = 'PLU#,Description,Status,POS Rings,Berg Pours,Var Count,POS Oz,Berg Oz,Var Oz,Var %,Revenue,Alert'
      const csvRows = allRows.map(r =>
        [r.pluNumber, `"${(r.description || '').replace(/"/g, '""')}"`, r.mappingStatus, r.posRings, r.bergPours,
          r.varCount, r.posOz, r.bergOz, r.varOz, r.variancePct ?? '', r.posRevenue, r.alert ? 'YES' : ''].join(',')
      )
      const csv = [header, ...csvRows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-variance-${startDate || 'all'}.csv"`,
        },
      })
    }

    // FIX 1: Response structure matches UI expectations (summary key)
    return ok({
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      rows: allRows,
      summary: {
        totalPosRings: totals.posRings,
        totalBergPours: totals.bergPours,
        totalPosOz: totals.posOz,
        totalBergOz: totals.bergOz,
        itemsOverThreshold: mappingResults.filter(r => Math.abs(r.variancePct ?? 0) > alertThreshold).length,
        unknownPluCount,
        dataQualityNote: unknownPluCount > 0
          ? `${unknownPluCount} pour(s) with unknown PLU excluded from variance`
          : null,
      },
      alertCount: mappingResults.filter(r => Math.abs(r.variancePct ?? 0) > alertThreshold).length,
    })
  } catch (caughtErr) {
    console.error('[reports/berg-variance]', err)
    return err('Failed to load variance report', 500)
  }
})

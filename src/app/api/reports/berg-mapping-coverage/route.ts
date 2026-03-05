import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

const DEFAULT_COST_PER_OZ = 10

/**
 * GET /api/reports/berg-mapping-coverage
 * Shows which PLUs are mapped vs unmapped, and estimated daily $ exposure from unmapped pours.
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Date filter using businessDate with receivedAt fallback (same pattern as berg-variance)
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

    // Load all active PLU mappings for this location
    const activeMappings = await db.bergPluMapping.findMany({
      where: { locationId, isActive: true },
      orderBy: { pluNumber: 'asc' },
    })

    const mappedPluNumbers = new Set(activeMappings.map(m => m.pluNumber))

    // Load all dispense events for the period, grouped by PLU
    const allEvents = await db.bergDispenseEvent.findMany({
      where: {
        locationId,
        lrcValid: true,
        status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'] },
        ...(Object.keys(bergDateFilter).length > 0 ? bergDateFilter : {}),
      },
      select: { pluNumber: true, pourSizeOz: true, pluMappingId: true },
    })

    // Group events by PLU number
    const eventsByPlu = new Map<number, { count: number; oz: number; mappingId: string | null }>()
    for (const ev of allEvents) {
      const existing = eventsByPlu.get(ev.pluNumber) ?? { count: 0, oz: 0, mappingId: ev.pluMappingId }
      eventsByPlu.set(ev.pluNumber, {
        count: existing.count + 1,
        oz: existing.oz + Number(ev.pourSizeOz ?? 1.5),
        mappingId: existing.mappingId ?? ev.pluMappingId,
      })
    }

    // Build mapping lookup by PLU number
    const mappingByPlu = new Map(activeMappings.map(m => [m.pluNumber, m]))

    // Build PLU rows for all unique PLUs seen in events
    const plus: Array<{
      pluNumber: number
      description: string | null
      isMapped: boolean
      menuItemId: string | null
      pourCount: number
      totalOz: number
      estimatedExposure: number | null
    }> = []

    for (const [pluNumber, data] of eventsByPlu) {
      const mapping = mappingByPlu.get(pluNumber)
      const totalOz = Math.round(data.oz * 10) / 10

      if (mapping) {
        plus.push({
          pluNumber,
          description: mapping.description || `PLU ${pluNumber}`,
          isMapped: true,
          menuItemId: mapping.menuItemId,
          pourCount: data.count,
          totalOz,
          estimatedExposure: null,
        })
      } else {
        const estimatedExposure = Math.round(data.count * 1.5 * DEFAULT_COST_PER_OZ * 100) / 100
        plus.push({
          pluNumber,
          description: null,
          isMapped: false,
          menuItemId: null,
          pourCount: data.count,
          totalOz,
          estimatedExposure,
        })
      }
    }

    // Also include mapped PLUs with zero pours (so operator sees them)
    for (const mapping of activeMappings) {
      if (!eventsByPlu.has(mapping.pluNumber)) {
        plus.push({
          pluNumber: mapping.pluNumber,
          description: mapping.description || `PLU ${mapping.pluNumber}`,
          isMapped: true,
          menuItemId: mapping.menuItemId,
          pourCount: 0,
          totalOz: 0,
          estimatedExposure: null,
        })
      }
    }

    // Sort: unmapped first (by pour count desc), then mapped (by PLU asc)
    plus.sort((a, b) => {
      if (a.isMapped !== b.isMapped) return a.isMapped ? 1 : -1
      if (!a.isMapped && !b.isMapped) return b.pourCount - a.pourCount
      return a.pluNumber - b.pluNumber
    })

    // Calculate coverage
    const uniquePlusSeen = eventsByPlu.size
    const mappedPlusSeen = [...eventsByPlu.keys()].filter(plu => mappedPluNumbers.has(plu)).length
    const unmappedPlusSeen = uniquePlusSeen - mappedPlusSeen
    const coveragePct = uniquePlusSeen > 0
      ? Math.round((mappedPlusSeen / uniquePlusSeen) * 100 * 10) / 10
      : 100

    const unmappedPours = plus.filter(p => !p.isMapped).reduce((s, p) => s + p.pourCount, 0)
    const unmappedExposure = Math.round(plus.filter(p => !p.isMapped).reduce((s, p) => s + (p.estimatedExposure ?? 0), 0) * 100) / 100
    const totalPours = plus.reduce((s, p) => s + p.pourCount, 0)

    return NextResponse.json({
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      coveragePct,
      mappedCount: mappedPlusSeen,
      unmappedCount: unmappedPlusSeen,
      totalActiveMappings: activeMappings.length,
      plus,
      summary: {
        totalPours,
        unmappedPours,
        unmappedExposure,
      },
    })
  } catch (err) {
    console.error('[reports/berg-mapping-coverage]', err)
    return NextResponse.json({ error: 'Failed to load mapping coverage report' }, { status: 500 })
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

const UNMATCHED_TYPE_LABELS: Record<string, string> = {
  NO_ORDER_ACKED: "ACK'd — No Open Ticket",
  NO_ORDER_NAKED: "NAK'd — No Open Ticket",
  UNKNOWN_PLU_ACKED: "ACK'd — Unmapped PLU",
  UNKNOWN_PLU_NAKED: "NAK'd — Unmapped PLU",
  LOG_ONLY: 'Log Only Mode',
}

/**
 * GET /api/reports/berg-unmatched
 * Pours with no linked order — dollar exposure.
 * Excludes BAD_LRC events (tracked in health report instead).
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const format = searchParams.get('format') || 'json'
    const requestingEmployeeId = searchParams.get('employeeId') || ''

    if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const dateRange: { gte?: Date; lte?: Date } = {}
    if (startDate) dateRange.gte = new Date(startDate)
    if (endDate) dateRange.lte = new Date(endDate + 'T23:59:59')

    const events = await db.bergDispenseEvent.findMany({
      where: {
        locationId,
        orderId: null,
        lrcValid: true,
        status: { in: ['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT', 'NAK', 'NAK_TIMEOUT'] },
        unmatchedType: { not: null },
        ...(Object.keys(dateRange).length > 0 ? { receivedAt: dateRange } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      include: {
        device: { select: { name: true } },
        pluMapping: { select: { description: true } },
      },
    })

    const totalExposure = events.reduce((s, e) => s + Number(e.pourCost || 0), 0)

    const byType = events.reduce<Record<string, { count: number; exposure: number }>>((acc, e) => {
      const key = e.unmatchedType || 'UNKNOWN'
      if (!acc[key]) acc[key] = { count: 0, exposure: 0 }
      acc[key].count++
      acc[key].exposure = Math.round((acc[key].exposure + Number(e.pourCost || 0)) * 100) / 100
      return acc
    }, {})

    const summary = Object.entries(byType).map(([type, data]) => ({
      type,
      label: UNMATCHED_TYPE_LABELS[type] || type,
      count: data.count,
      exposure: data.exposure,
    }))

    if (format === 'csv') {
      const header = 'Time,Device,PLU,Description,Pour Size (oz),Cost,Status,Unmatched Type,Resolve Action'
      const rows = events.map(e =>
        [
          e.receivedAt.toISOString(),
          e.device?.name || '',
          e.pluNumber,
          e.pluMapping?.description || 'Unknown PLU',
          e.pourSizeOz ? Number(e.pourSizeOz).toFixed(2) : '',
          e.pourCost ? Number(e.pourCost).toFixed(2) : '',
          e.status,
          UNMATCHED_TYPE_LABELS[e.unmatchedType || ''] || e.unmatchedType || '',
          e.unmatchedType?.includes('UNKNOWN_PLU') ? 'Map PLU in Settings' : '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
      )
      const csv = [header, ...rows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-unmatched-${startDate || 'all'}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { startDate, endDate },
      events,
      totalExposure: Math.round(totalExposure * 100) / 100,
      totalCount: events.length,
      summary,
      unmatchedTypeLabels: UNMATCHED_TYPE_LABELS,
    })
  } catch (err) {
    console.error('[reports/berg-unmatched]', err)
    return NextResponse.json({ error: 'Failed to load unmatched report' }, { status: 500 })
  }
})

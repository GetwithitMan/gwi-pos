import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

/**
 * GET /api/reports/berg-dispense
 * Full Berg dispense event audit log.
 * Filters: date range, deviceId, pluNumber, status, lrcValid, employeeId, format=csv
 * Includes rawPacket hex in CSV when includeRaw=true
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const deviceId = searchParams.get('deviceId')
    const pluNumber = searchParams.get('pluNumber')
    const status = searchParams.get('status')
    const lrcValid = searchParams.get('lrcValid')
    const employeeFilter = searchParams.get('employeeFilter')
    const format = searchParams.get('format') || 'json'
    const includeRaw = searchParams.get('includeRaw') === 'true'
    const requestingEmployeeId = searchParams.get('employeeId') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '100', 10) || 100, 500))

    if (!locationId) return err('locationId required')

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_INVENTORY)
    if (!auth.authorized) return err(auth.error, auth.status)

    const where: Record<string, unknown> = { locationId }
    if (deviceId) where.deviceId = deviceId
    if (pluNumber) where.pluNumber = parseInt(pluNumber, 10)
    if (status) where.status = status
    if (lrcValid !== null && lrcValid !== '') where.lrcValid = lrcValid === 'true'
    if (employeeFilter) where.employeeId = employeeFilter
    if (startDate || endDate) {
      const range: { gte?: Date; lte?: Date } = {}
      if (startDate) range.gte = new Date(startDate)
      if (endDate) range.lte = new Date(endDate + 'T23:59:59')
      where.receivedAt = range
    }

    const [events, total] = await Promise.all([
      db.bergDispenseEvent.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: format === 'csv' ? undefined : limit,
        skip: format === 'csv' ? undefined : (page - 1) * limit,
        include: {
          device: { select: { name: true, model: true } },
          pluMapping: { select: { description: true } },
          order: { select: { id: true } },
        },
      }),
      db.bergDispenseEvent.count({ where }),
    ])

    if (format === 'csv') {
      const headers = [
        'Time','Device','PLU','Description','Pour Size (oz)','Cost','Status','LRC Valid',
        'Latency (ms)','Order ID','Unmatched Type','Error',
        ...(includeRaw ? ['Raw Packet'] : []),
      ]
      const rows = events.map(e => [
        e.receivedAt.toISOString(),
        e.device?.name || '',
        e.pluNumber,
        e.pluMapping?.description || '',
        e.pourSizeOz ? Number(e.pourSizeOz).toFixed(2) : '',
        e.pourCost ? Number(e.pourCost).toFixed(2) : '',
        e.status,
        e.lrcValid ? 'YES' : 'NO',
        e.ackLatencyMs ?? '',
        e.orderId || '',
        e.unmatchedType || '',
        e.errorReason || '',
        ...(includeRaw ? [e.rawPacket] : []),
      // Sanitize: escape quotes and strip newlines (rawPacket may contain binary with \r\n)
      ].map(v => `"${String(v).replace(/[\r\n]/g, ' ').replace(/"/g, '""')}"`).join(','))
      const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-dispense-log-${startDate || 'all'}.csv"`,
        },
      })
    }

    return ok({ events, total, page, limit, pages: Math.ceil(total / limit) })
  } catch (caughtErr) {
    console.error('[reports/berg-dispense]', err)
    return err('Failed to load dispense log', 500)
  }
})

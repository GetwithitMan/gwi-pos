import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

/**
 * GET /api/reports/berg-employee
 * Per-bartender accountability: pour count, volume, $ exposure from unmatched pours, NAK rate.
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

    // Date filter: prefer businessDate, fallback to receivedAt
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

    // Fetch all valid dispense events for the period
    const events = await db.bergDispenseEvent.findMany({
      where: {
        locationId,
        lrcValid: true,
        ...(Object.keys(bergDateFilter).length > 0 ? bergDateFilter : {}),
      },
      select: {
        employeeId: true,
        status: true,
        orderId: true,
        unmatchedType: true,
        pourSizeOz: true,
        pourCost: true,
      },
    })

    // Group by employeeId (null = "No Employee Assigned")
    const buckets = new Map<string | null, {
      totalPours: number
      ackCount: number
      nakCount: number
      unmatchedCount: number
      unmatchedExposure: number
      totalOz: number
      totalCost: number
    }>()

    for (const ev of events) {
      const key = ev.employeeId
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { totalPours: 0, ackCount: 0, nakCount: 0, unmatchedCount: 0, unmatchedExposure: 0, totalOz: 0, totalCost: 0 }
        buckets.set(key, bucket)
      }
      bucket.totalPours++
      if (['ACK', 'ACK_BEST_EFFORT', 'ACK_TIMEOUT'].includes(ev.status)) bucket.ackCount++
      if (['NAK', 'NAK_TIMEOUT'].includes(ev.status)) bucket.nakCount++
      if (ev.unmatchedType) {
        bucket.unmatchedCount++
        bucket.unmatchedExposure = Math.round((bucket.unmatchedExposure + Number(ev.pourCost || 0)) * 100) / 100
      }
      bucket.totalOz = Math.round((bucket.totalOz + Number(ev.pourSizeOz || 0)) * 10) / 10
      bucket.totalCost = Math.round((bucket.totalCost + Number(ev.pourCost || 0)) * 100) / 100
    }

    // Look up employee names
    const employeeIds = [...buckets.keys()].filter((id): id is string => id !== null)
    const employees = employeeIds.length > 0
      ? await db.employee.findMany({
          where: { id: { in: employeeIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const empMap = new Map(employees.map(e => [e.id, `${e.firstName} ${e.lastName?.charAt(0) || ''}.`.trim()]))

    // Build response rows
    const employeeRows = [...buckets.entries()].map(([empId, b]) => ({
      employeeId: empId,
      employeeName: empId ? (empMap.get(empId) || 'Unknown Employee') : 'No Employee Assigned',
      totalPours: b.totalPours,
      ackCount: b.ackCount,
      nakCount: b.nakCount,
      unmatchedCount: b.unmatchedCount,
      unmatchedExposure: b.unmatchedExposure,
      nakRate: b.totalPours > 0 ? Math.round((b.nakCount / b.totalPours) * 1000) / 10 : 0,
      totalOz: b.totalOz,
      totalCost: b.totalCost,
    }))

    // Sort by unmatched exposure descending
    employeeRows.sort((a, b) => b.unmatchedExposure - a.unmatchedExposure)

    const summary = {
      totalPours: events.length,
      totalUnmatched: employeeRows.reduce((s, r) => s + r.unmatchedCount, 0),
      totalExposure: Math.round(employeeRows.reduce((s, r) => s + r.unmatchedExposure, 0) * 100) / 100,
    }

    if (format === 'csv') {
      const header = 'Employee,Total Pours,ACK,NAK,NAK Rate %,Volume (oz),Total Cost,Unmatched,Unmatched Exposure'
      const csvRows = employeeRows.map(r =>
        [
          `"${r.employeeName.replace(/"/g, '""')}"`,
          r.totalPours,
          r.ackCount,
          r.nakCount,
          r.nakRate,
          r.totalOz,
          r.totalCost,
          r.unmatchedCount,
          r.unmatchedExposure,
        ].join(',')
      )
      const csv = [header, ...csvRows].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="berg-employee-${startDate || 'all'}.csv"`,
        },
      })
    }

    return NextResponse.json({
      period: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      employees: employeeRows,
      summary,
    })
  } catch (err) {
    console.error('[reports/berg-employee]', err)
    return NextResponse.json({ error: 'Failed to load employee accountability report' }, { status: 500 })
  }
})

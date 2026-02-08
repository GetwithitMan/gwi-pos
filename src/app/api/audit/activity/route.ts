import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// GET /api/audit/activity - Global audit log with filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const actionType = searchParams.get('actionType')
    const filterEmployeeId = searchParams.get('filterEmployeeId')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!employeeId || !locationId) {
      return NextResponse.json(
        { error: 'employeeId and locationId query params are required' },
        { status: 401 }
      )
    }

    // Auth: require manager permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build where clause
    const where: Record<string, unknown> = {
      locationId,
      entityType: { in: ['order', 'payment'] },
      deletedAt: null,
    }

    // Date range: default to last 7 days, max 31-day span
    let rangeStart = startDate ? new Date(startDate) : null
    let rangeEnd = endDate ? new Date(endDate) : null

    if (!rangeStart && !rangeEnd) {
      rangeEnd = new Date()
      rangeStart = new Date(rangeEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    if (rangeStart && rangeEnd) {
      const spanMs = rangeEnd.getTime() - rangeStart.getTime()
      if (spanMs > 31 * 24 * 60 * 60 * 1000) {
        return NextResponse.json(
          { error: 'Date range cannot exceed 31 days' },
          { status: 400 }
        )
      }
    }

    where.createdAt = {
      ...(rangeStart ? { gte: rangeStart } : {}),
      ...(rangeEnd ? { lte: rangeEnd } : {}),
    }

    if (actionType) {
      where.action = actionType
    }

    if (filterEmployeeId) {
      where.employeeId = filterEmployeeId
    }

    const [entries, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.auditLog.count({ where }),
    ])

    return NextResponse.json({
      entries: entries.map(entry => ({
        id: entry.id,
        timestamp: entry.createdAt.toISOString(),
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        employeeId: entry.employeeId,
        employeeName: entry.employee
          ? entry.employee.displayName || `${entry.employee.firstName} ${entry.employee.lastName}`
          : null,
        details: entry.details,
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to fetch audit activity log:', error)
    return NextResponse.json(
      { error: 'Failed to fetch audit activity log' },
      { status: 500 }
    )
  }
}

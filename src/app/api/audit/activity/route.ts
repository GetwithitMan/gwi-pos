import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { Prisma } from '@/generated/prisma/client'
import { err, ok, unauthorized } from '@/lib/api-response'

// GET /api/audit/activity - Global audit log with filters
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const actionType = searchParams.get('actionType')
    const filterEmployeeId = searchParams.get('filterEmployeeId')
    const search = searchParams.get('search')?.trim() || ''
    const limit = Math.max(1, Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

    if (!employeeId || !locationId) {
      return unauthorized('employeeId and locationId query params are required')
    }

    // Auth: require manager permission
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Build where clause — no entityType filter so all action types surface
    const where: Record<string, unknown> = {
      locationId,
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
        return err('Date range cannot exceed 31 days')
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

    // Text search: search action, entityType, entityId, and details JSON
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
        { entityType: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
        { entityId: { contains: search, mode: 'insensitive' as Prisma.QueryMode } },
        // Search within the details JSON by casting to string
        { details: { string_contains: search } },
      ]
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

    return ok({
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
        ipAddress: entry.ipAddress,
      })),
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Failed to fetch audit activity log:', error)
    return err('Failed to fetch audit activity log', 500)
  }
})

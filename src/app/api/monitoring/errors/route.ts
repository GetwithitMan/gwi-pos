/**
 * GET /api/monitoring/errors
 *
 * List and filter error logs with pagination and aggregation.
 * Powers the monitoring dashboard.
 *
 * Query params:
 * - locationId: Filter by location
 * - severity: Filter by severity (CRITICAL, HIGH, MEDIUM, LOW)
 * - errorType: Filter by type (PAYMENT, ORDER, API, etc.)
 * - status: Filter by status (NEW, INVESTIGATING, RESOLVED, IGNORED)
 * - search: Search in message
 * - startDate: Filter from date
 * - endDate: Filter to date
 * - groupId: Filter by specific group
 * - limit: Results per page (default 50)
 * - offset: Pagination offset
 * - sortBy: Sort field (createdAt, severity, occurrenceCount)
 * - sortOrder: asc or desc
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { withVenue } from '@/lib/with-venue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ============================================
// GET - List Errors
// ============================================

export const GET = withVenue(async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)

    // Filters
    const locationId = searchParams.get('locationId')
    const severity = searchParams.get('severity')
    const errorType = searchParams.get('errorType')
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const groupId = searchParams.get('groupId')

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Sorting
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    // Build where clause
    const where: Prisma.ErrorLogWhereInput = {}

    if (locationId) where.locationId = locationId
    if (severity) where.severity = severity
    if (errorType) where.errorType = errorType
    if (status) where.status = status
    if (groupId) where.groupId = groupId

    if (search) {
      where.OR = [
        { message: { contains: search } },
        { category: { contains: search } },
        { action: { contains: search } },
      ]
    }

    if (startDate || endDate) {
      where.createdAt = {}
      if (startDate) where.createdAt.gte = new Date(startDate)
      if (endDate) where.createdAt.lte = new Date(endDate)
    }

    // Get errors with pagination
    const [errors, total] = await Promise.all([
      db.errorLog.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: {
          [sortBy]: sortOrder,
        },
        include: {
          location: {
            select: {
              id: true,
              name: true,
            },
          },
          employee: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
      db.errorLog.count({ where }),
    ])

    // Format response
    const formattedErrors = errors.map((error) => ({
      id: error.id,
      severity: error.severity,
      errorType: error.errorType,
      category: error.category,
      message: error.message,
      status: error.status,
      occurrenceCount: error.occurrenceCount,
      groupId: error.groupId,

      // Context
      location: error.location,
      employee: error.employee ? {
        id: error.employee.id,
        name: error.employee.displayName || `${error.employee.firstName} ${error.employee.lastName}`,
      } : null,
      path: error.path,
      action: error.action,

      // Business context
      orderId: error.orderId,
      tableId: error.tableId,
      paymentId: error.paymentId,

      // Timestamps
      firstOccurred: error.firstOccurred,
      lastOccurred: error.lastOccurred,
      resolvedAt: error.resolvedAt,
      createdAt: error.createdAt,

      // Alerting
      alertSent: error.alertSent,
      alertSentAt: error.alertSentAt,
    }))

    return NextResponse.json({
      success: true,
      errors: formattedErrors,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })

  } catch (error) {
    console.error('[Monitoring API] Failed to fetch errors:', error)

    return NextResponse.json(
      { error: 'Failed to fetch errors' },
      { status: 500 }
    )
  }
})

// ============================================
// GET - Error Statistics
// ============================================

/**
 * Get error statistics and aggregations
 * GET /api/monitoring/errors?stats=true
 */
export async function getErrorStats(locationId?: string) {
  const where: Prisma.ErrorLogWhereInput = locationId ? { locationId } : {}

  // Get counts by severity
  const bySeverity = await db.errorLog.groupBy({
    by: ['severity'],
    where,
    _count: true,
  })

  // Get counts by error type
  const byErrorType = await db.errorLog.groupBy({
    by: ['errorType'],
    where,
    _count: true,
  })

  // Get counts by status
  const byStatus = await db.errorLog.groupBy({
    by: ['status'],
    where,
    _count: true,
  })

  // Get recent errors (last 24 hours)
  const last24h = new Date()
  last24h.setHours(last24h.getHours() - 24)

  const recentCount = await db.errorLog.count({
    where: {
      ...where,
      createdAt: { gte: last24h },
    },
  })

  // Get critical errors count
  const criticalCount = await db.errorLog.count({
    where: {
      ...where,
      severity: 'CRITICAL',
      status: { in: ['NEW', 'INVESTIGATING'] },
    },
  })

  return {
    bySeverity: bySeverity.map(s => ({ severity: s.severity, count: s._count })),
    byErrorType: byErrorType.map(t => ({ errorType: t.errorType, count: t._count })),
    byStatus: byStatus.map(s => ({ status: s.status, count: s._count })),
    recentCount,
    criticalCount,
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { dateRangeToUTC } from '@/lib/timezone'
import { checkReportRateLimit } from '@/lib/report-rate-limiter'

/**
 * GET /api/reports/tax-exempt
 *
 * Returns all tax-exempt orders for a date range with exemption details.
 * Important for tax authority compliance — shows who approved each exemption,
 * the reason, tax ID, and how much tax was saved.
 *
 * Query params:
 *   - locationId (required)
 *   - startDate / endDate (YYYY-MM-DD, defaults to current month)
 *   - requestingEmployeeId (for auth + rate-limiting)
 */
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId') || searchParams.get('employeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID is required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const rateCheck = checkReportRateLimit(requestingEmployeeId || 'anonymous')
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Rate limited', retryAfter: rateCheck.retryAfterSeconds }, { status: 429 })
    }

    // Resolve timezone for date range conversion
    const loc = await db.location.findFirst({
      where: { id: locationId },
      select: { timezone: true },
    })
    const timezone = loc?.timezone || 'America/New_York'

    // Default to current month
    const now = new Date()
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const defaultEnd = now.toISOString().split('T')[0]

    const { start, end } = dateRangeToUTC(
      startDate || defaultStart,
      endDate || defaultEnd,
      timezone,
    )

    // Fetch all tax-exempt orders in the date range
    const orders = await db.order.findMany({
      where: {
        locationId,
        isTaxExempt: true,
        createdAt: { gte: start, lte: end },
        deletedAt: null,
        status: { in: ['paid', 'closed', 'open', 'in_progress'] },
      },
      select: {
        id: true,
        orderNumber: true,
        displayNumber: true,
        createdAt: true,
        paidAt: true,
        subtotal: true,
        total: true,
        taxExemptReason: true,
        taxExemptId: true,
        taxExemptApprovedBy: true,
        taxExemptSavedAmount: true,
        status: true,
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        customer: {
          select: { id: true, firstName: true, lastName: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Resolve approvedBy employee names (batch fetch)
    const approverIds = [...new Set(orders.map(o => o.taxExemptApprovedBy).filter(Boolean))] as string[]
    const approvers = approverIds.length > 0
      ? await db.employee.findMany({
          where: { id: { in: approverIds } },
          select: { id: true, displayName: true, firstName: true, lastName: true },
        })
      : []
    const approverMap = new Map(approvers.map(a => [
      a.id,
      a.displayName || `${a.firstName} ${a.lastName}`,
    ]))

    // Calculate aggregates
    let totalSaved = 0
    let totalOrderAmount = 0

    const exemptOrders = orders.map(order => {
      const saved = Number(order.taxExemptSavedAmount ?? 0)
      totalSaved += saved
      totalOrderAmount += Number(order.total ?? 0)

      const serverName = order.employee
        ? (order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`)
        : 'Unknown'

      const customerName = order.customer
        ? (order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`)
        : null

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber,
        date: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() || null,
        status: order.status,
        subtotal: Number(order.subtotal ?? 0),
        total: Number(order.total ?? 0),
        taxExemptReason: order.taxExemptReason || 'Not specified',
        taxExemptId: order.taxExemptId || null,
        taxSaved: saved,
        approvedBy: order.taxExemptApprovedBy
          ? approverMap.get(order.taxExemptApprovedBy) || 'Unknown'
          : 'Unknown',
        approvedByEmployeeId: order.taxExemptApprovedBy,
        serverName,
        customerName,
      }
    })

    return NextResponse.json({
      data: {
        orders: exemptOrders,
        summary: {
          totalExemptOrders: exemptOrders.length,
          totalTaxSaved: Math.round(totalSaved * 100) / 100,
          totalOrderAmount: Math.round(totalOrderAmount * 100) / 100,
          dateRange: {
            start: startDate || defaultStart,
            end: endDate || defaultEnd,
          },
        },
      },
    })
  } catch (error) {
    console.error('Tax exempt report error:', error)
    return NextResponse.json({ error: 'Failed to generate tax exempt report' }, { status: 500 })
  }
})

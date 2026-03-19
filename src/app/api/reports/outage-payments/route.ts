import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

// GET /api/reports/outage-payments
// Returns payments flagged for reconciliation (processed during outage or offline capture).
// Used by managers to verify payments that went through while Neon was unreachable.
export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const requestingEmployeeId = searchParams.get('requestingEmployeeId')

    if (!locationId) {
      return NextResponse.json({ error: 'Location ID required' }, { status: 400 })
    }

    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.REPORTS_SALES)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Build date filter
    const dateFilter: Record<string, unknown> = {}
    if (startDate) dateFilter.gte = new Date(`${startDate}T00:00:00`)
    if (endDate) dateFilter.lte = new Date(`${endDate}T23:59:59.999`)
    const hasDateFilter = Object.keys(dateFilter).length > 0

    // Query payments needing reconciliation (outage or offline captures)
    const payments = await db.payment.findMany({
      where: {
        locationId,
        deletedAt: null,
        needsReconciliation: true,
        ...(hasDateFilter ? { createdAt: dateFilter } : {}),
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            tabName: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })

    const summary = {
      totalCount: payments.length,
      totalAmount: payments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      reconciledCount: payments.filter(p => p.reconciledAt).length,
      unreconciledCount: payments.filter(p => !p.reconciledAt).length,
      byMethod: {} as Record<string, { count: number; amount: number }>,
      byStatus: {} as Record<string, { count: number; amount: number }>,
    }

    for (const p of payments) {
      const method = p.paymentMethod || 'unknown'
      if (!summary.byMethod[method]) summary.byMethod[method] = { count: 0, amount: 0 }
      summary.byMethod[method].count++
      summary.byMethod[method].amount += Number(p.amount || 0)

      const status = p.status || 'unknown'
      if (!summary.byStatus[status]) summary.byStatus[status] = { count: 0, amount: 0 }
      summary.byStatus[status].count++
      summary.byStatus[status].amount += Number(p.amount || 0)
    }

    return NextResponse.json({
      success: true,
      data: {
        summary,
        payments: payments.map(p => ({
          id: p.id,
          orderId: p.orderId,
          orderNumber: p.order?.orderNumber ?? null,
          tabName: p.order?.tabName ?? null,
          orderStatus: p.order?.status ?? null,
          paymentMethod: p.paymentMethod,
          amount: Number(p.amount || 0),
          tipAmount: Number(p.tipAmount || 0),
          totalAmount: Number(p.totalAmount || 0),
          status: p.status,
          isOfflineCapture: p.isOfflineCapture,
          offlineCapturedAt: p.offlineCapturedAt?.toISOString() ?? null,
          safStatus: p.safStatus ?? null,
          cardBrand: p.cardBrand ?? null,
          cardLast4: p.cardLast4 ?? null,
          reconciledAt: p.reconciledAt?.toISOString() ?? null,
          reconciledBy: p.reconciledBy ?? null,
          createdAt: p.createdAt?.toISOString() ?? null,
        })),
      },
    })
  } catch (error) {
    console.error('[OutagePayments] Report error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch outage payments' },
      { status: 500 }
    )
  }
})

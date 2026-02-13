import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'

interface TimelineEntry {
  id: string
  timestamp: string
  action: string
  source: 'audit' | 'void' | 'payment' | 'order'
  employeeId: string | null
  employeeName: string | null
  details: Record<string, unknown> | null
}

// GET /api/orders/[id]/timeline - Full order activity timeline
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const { searchParams } = new URL(request.url)
    const employeeId = searchParams.get('employeeId')

    // Fetch order to get locationId
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        orderNumber: true,
        status: true,
        createdAt: true,
        paidAt: true,
        closedAt: true,
        employeeId: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, displayName: true },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Auth: require manager permission
    if (!employeeId) {
      return NextResponse.json({ error: 'employeeId query param is required' }, { status: 401 })
    }
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.MGR_SHIFT_REVIEW)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Gather all timeline sources in parallel
    const [auditLogs, voidLogs, payments] = await Promise.all([
      // AuditLog entries for this order
      db.auditLog.findMany({
        where: {
          entityType: 'order',
          entityId: orderId,
          deletedAt: null,
        },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // VoidLog entries for this order
      db.voidLog.findMany({
        where: {
          orderId,
          deletedAt: null,
        },
        include: {
          employee: {
            select: { id: true, firstName: true, lastName: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      // Payment records for this order
      db.payment.findMany({
        where: {
          orderId,
          deletedAt: null,
        },
        orderBy: { processedAt: 'asc' },
      }),
    ])

    // Also get payment audit logs (entityType = 'payment')
    const paymentIds = payments.map(p => p.id)
    const paymentAuditLogs = paymentIds.length > 0
      ? await db.auditLog.findMany({
          where: {
            entityType: 'payment',
            entityId: { in: paymentIds },
            deletedAt: null,
          },
          include: {
            employee: {
              select: { id: true, firstName: true, lastName: true, displayName: true },
            },
          },
        })
      : []

    const formatName = (emp: { displayName: string | null; firstName: string; lastName: string } | null) => {
      if (!emp) return null
      return emp.displayName || `${emp.firstName} ${emp.lastName}`
    }

    // Build timeline entries
    const timeline: TimelineEntry[] = []

    // Order creation
    timeline.push({
      id: `order-created-${order.id}`,
      timestamp: order.createdAt.toISOString(),
      action: 'order_created',
      source: 'order',
      employeeId: order.employeeId,
      employeeName: formatName(order.employee),
      details: { orderNumber: order.orderNumber },
    })

    // Audit log entries
    for (const log of auditLogs) {
      timeline.push({
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        action: log.action,
        source: 'audit',
        employeeId: log.employeeId,
        employeeName: formatName(log.employee),
        details: log.details as Record<string, unknown> | null,
      })
    }

    // Payment audit logs
    for (const log of paymentAuditLogs) {
      timeline.push({
        id: log.id,
        timestamp: log.createdAt.toISOString(),
        action: log.action,
        source: 'audit',
        employeeId: log.employeeId,
        employeeName: formatName(log.employee),
        details: log.details as Record<string, unknown> | null,
      })
    }

    // Void logs
    for (const voidLog of voidLogs) {
      timeline.push({
        id: voidLog.id,
        timestamp: voidLog.createdAt.toISOString(),
        action: voidLog.voidType === 'item' ? 'item_voided' : 'order_voided',
        source: 'void',
        employeeId: voidLog.employeeId,
        employeeName: formatName(voidLog.employee),
        details: {
          voidType: voidLog.voidType,
          itemId: voidLog.itemId,
          amount: Number(voidLog.amount),
          reason: voidLog.reason,
          wasMade: voidLog.wasMade,
          approvedById: voidLog.approvedById,
        },
      })
    }

    // Payment records (only if not already captured by audit logs)
    const auditedPaymentIds = new Set(paymentAuditLogs.map(l => l.entityId))
    for (const payment of payments) {
      if (auditedPaymentIds.has(payment.id)) continue
      timeline.push({
        id: payment.id,
        timestamp: payment.processedAt.toISOString(),
        action: payment.status === 'voided' ? 'payment_voided' : 'payment_processed',
        source: 'payment',
        employeeId: payment.employeeId,
        employeeName: null,
        details: {
          paymentMethod: payment.paymentMethod,
          amount: Number(payment.amount),
          tipAmount: Number(payment.tipAmount),
          totalAmount: Number(payment.totalAmount),
          status: payment.status,
        },
      })
    }

    // Order paid/closed timestamps
    if (order.paidAt) {
      timeline.push({
        id: `order-paid-${order.id}`,
        timestamp: order.paidAt.toISOString(),
        action: 'order_paid',
        source: 'order',
        employeeId: order.employeeId,
        employeeName: formatName(order.employee),
        details: { status: order.status },
      })
    }

    // Sort chronologically
    timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // Deduplicate: remove synthetic entries when richer audit versions exist
    const hasAuditCreated = timeline.some(e => e.source === 'audit' && e.action === 'order_created')
    const hasAuditClosed = timeline.some(e => e.source === 'audit' && e.action === 'order_closed')
    const deduped = timeline.filter(e => {
      if (e.source === 'order' && e.action === 'order_created' && hasAuditCreated) return false
      if (e.source === 'order' && e.action === 'order_paid' && hasAuditClosed) return false
      return true
    })

    return NextResponse.json({
      orderId,
      orderNumber: order.orderNumber,
      timeline: deduped,
    })
  } catch (error) {
    console.error('Failed to fetch order timeline:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order timeline' },
      { status: 500 }
    )
  }
})

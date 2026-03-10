import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/internal/payment-reconciliation?locationId=xxx
 *
 * Returns orders that may have missing offline payments (stale open/sent orders
 * idle for >30 minutes). Cross-reference with Datacap batch settlement report
 * to detect orphaned card charges from Android PaymentReconciliationWorker exhaustion.
 *
 * POST /api/internal/payment-reconciliation
 *
 * Manually record an orphaned offline payment confirmed via Datacap batch report.
 * Creates a payment record and marks the order paid if fully covered.
 */

function authorize(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  if (!apiKey || apiKey !== process.env.INTERNAL_API_SECRET) {
    // Allow localhost for backward compatibility
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
    return ['127.0.0.1', '::1', 'localhost'].includes(ip)
  }
  return true
}

export async function GET(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const locationId = request.nextUrl.searchParams.get('locationId')
  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  try {
    // Find orders that are still open/sent but have been idle for >30 minutes.
    // These may have had offline payments that never synced from Android devices.
    const suspectOrders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['open', 'sent', 'in_progress'] },
        updatedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        deletedAt: null,
      },
      select: {
        id: true,
        orderNumber: true,
        total: true,
        status: true,
        updatedAt: true,
        tabName: true,
        payments: {
          select: {
            id: true,
            amount: true,
            totalAmount: true,
            status: true,
            datacapRecordNo: true,
            datacapRefNumber: true,
            paymentMethod: true,
          },
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 50,
    })

    return NextResponse.json({
      suspectOrders,
      count: suspectOrders.length,
      message: 'Orders that may have missing offline payments. Cross-reference with Datacap batch settlement report.',
    })
  } catch (error) {
    console.error('[Payment Reconciliation] GET failed:', error)
    return NextResponse.json(
      { error: 'Failed to fetch suspect orders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { orderId, amount, datacapRecordNo, datacapRefNumber, method, locationId, employeeId } = body

    if (!orderId || !amount || !locationId) {
      return NextResponse.json(
        { error: 'orderId, amount, and locationId required' },
        { status: 400 }
      )
    }

    // Verify order exists and belongs to the location
    const order = await db.order.findFirst({
      where: { id: orderId, locationId, deletedAt: null },
      include: { payments: { where: { status: 'completed', deletedAt: null } } },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found or does not belong to this location' },
        { status: 404 }
      )
    }

    // Create a reconciliation payment record
    const payment = await db.payment.create({
      data: {
        orderId,
        amount,
        totalAmount: amount,
        tipAmount: 0,
        paymentMethod: method || 'credit',
        status: 'completed',
        datacapRecordNo: datacapRecordNo || null,
        datacapRefNumber: datacapRefNumber || null,
        locationId,
        employeeId: employeeId || null,
        idempotencyKey: `reconciliation-${datacapRecordNo || orderId}-${Date.now()}`,
        isOfflineCapture: true,
        needsReconciliation: true,
      },
    })

    // Check if order should be marked paid
    const totalPaid = order.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0) + Number(amount)
    if (totalPaid >= Number(order.total)) {
      await db.order.update({
        where: { id: orderId },
        data: { status: 'paid' },
      })
    }

    // Audit log
    await db.auditLog.create({
      data: {
        locationId,
        employeeId: employeeId || null,
        action: 'manual_payment_reconciliation',
        entityType: 'payment',
        entityId: payment.id,
        details: {
          orderId,
          amount,
          datacapRecordNo: datacapRecordNo || null,
          datacapRefNumber: datacapRefNumber || null,
          source: 'manual_reconciliation',
          reconciledAt: new Date().toISOString(),
        },
      },
    })

    console.warn(`[RECONCILIATION] Manual payment recorded: order=${orderId}, amount=${amount}, recordNo=${datacapRecordNo || 'none'}`)

    return NextResponse.json({ success: true, paymentId: payment.id })
  } catch (error) {
    console.error('[Payment Reconciliation] POST failed:', error)
    return NextResponse.json(
      { error: 'Failed to record reconciliation payment' },
      { status: 500 }
    )
  }
}

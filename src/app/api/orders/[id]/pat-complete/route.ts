import { NextRequest, NextResponse } from 'next/server'
import { OrderStatus, TabStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import {
  dispatchOpenOrdersChanged,
  dispatchTabUpdated,
  dispatchFloorPlanUpdate,
} from '@/lib/socket-dispatch'

// POST /api/orders/[id]/pat-complete
// Called by pay-at-table after all datacap payments complete.
// Body: { employeeId, totalPaid, tipAmount, splits?: [{ amount, tipAmount, authCode, readerId }] }
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json().catch(() => ({}))
    const {
      employeeId,
      totalPaid,
      tipAmount = 0,
      splits,
    } = body as {
      employeeId?: string
      totalPaid?: number
      tipAmount?: number
      splits?: Array<{ amount: number; tipAmount?: number; authCode?: string; readerId?: string }>
    }

    // Validate required fields
    if (!employeeId) {
      return NextResponse.json(
        { error: 'Missing required field: employeeId' },
        { status: 400 }
      )
    }
    if (totalPaid === undefined || totalPaid === null) {
      return NextResponse.json(
        { error: 'Missing required field: totalPaid' },
        { status: 400 }
      )
    }

    // Fetch the order
    const order = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        locationId: true,
        status: true,
        orderType: true,
        tableId: true,
        tipTotal: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const locationId = order.locationId

    // Idempotent: if order already paid, return success silently
    if (order.status === 'paid') {
      return NextResponse.json({ data: { success: true } })
    }

    // Calculate totals from splits if provided, otherwise use body values
    const effectiveTip = splits
      ? splits.reduce((sum, s) => sum + (s.tipAmount ?? 0), 0)
      : (tipAmount ?? 0)

    // Update the order: mark as paid, close tab if applicable
    const updateData: {
      status: OrderStatus
      paidAt: Date
      tipTotal: number
      tabStatus?: TabStatus
    } = {
      status: 'paid' as OrderStatus,
      paidAt: new Date(),
      tipTotal: Number(order.tipTotal) + effectiveTip,
    }

    if (order.orderType === 'bar_tab') {
      updateData.tabStatus = 'closed' as TabStatus
    }

    await db.order.update({
      where: { id: orderId },
      data: updateData,
    })

    // Create Payment records
    if (splits && splits.length > 0) {
      // One Payment per split
      for (const split of splits) {
        await db.payment.create({
          data: {
            locationId,
            orderId,
            employeeId,
            paymentMethod: 'card',
            amount: split.amount,
            tipAmount: split.tipAmount ?? 0,
            totalAmount: split.amount + (split.tipAmount ?? 0),
            status: 'completed',
            settledAt: new Date(),
            ...(split.authCode ? { authCode: split.authCode } : {}),
            ...(split.readerId ? { paymentReaderId: split.readerId } : {}),
          },
        })
      }
    } else {
      // Single Payment for the full amount
      const baseAmount = totalPaid - (tipAmount ?? 0)
      await db.payment.create({
        data: {
          locationId,
          orderId,
          employeeId,
          paymentMethod: 'card',
          amount: baseAmount,
          tipAmount: tipAmount ?? 0,
          totalAmount: totalPaid,
          status: 'completed',
          settledAt: new Date(),
        },
      })
    }

    // Fire-and-forget socket dispatches to sync all terminals
    dispatchOpenOrdersChanged(
      locationId,
      { trigger: 'paid', orderId, tableId: order.tableId || undefined },
      { async: true }
    ).catch(() => {})

    dispatchTabUpdated(locationId, { orderId, status: 'closed' }).catch(() => {})

    if (order.tableId) {
      dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[pat-complete] Failed to complete pay-at-table payment:', error)
    return NextResponse.json(
      { error: 'Failed to complete pay-at-table payment' },
      { status: 500 }
    )
  }
})

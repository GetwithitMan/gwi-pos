import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate, dispatchOrderSummaryUpdated } from '@/lib/socket-dispatch'

// POST - Set donation amount on order
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { amount } = body as { amount: number }

    if (typeof amount !== 'number' || amount < 0) {
      return NextResponse.json(
        { error: 'amount must be a non-negative number' },
        { status: 400 }
      )
    }
    if (amount > 9999) {
      return NextResponse.json(
        { error: 'Donation amount exceeds maximum of $9,999' },
        { status: 400 }
      )
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        total: true,
        donationAmount: true,
        orderNumber: true,
        status: true,
        tableId: true,
        tabName: true,
        guestCount: true,
        employeeId: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        tipTotal: true,
        itemCount: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    const roundedAmount = Math.round(amount * 100) / 100

    // Wrap in transaction with FOR UPDATE to prevent concurrent donation + discount
    // from drifting the total (read-then-increment race on stale donationAmount).
    const updated = await db.$transaction(async (tx) => {
      // Lock the Order row to serialize concurrent total mutations
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE "id" = $1 FOR UPDATE', orderId)

      // Re-read locked values for accurate delta calculation
      const locked = await tx.order.findUnique({
        where: { id: orderId },
        select: { total: true, donationAmount: true },
      })
      if (!locked) throw new Error('Order not found under lock')

      const previousDonation = Number(locked.donationAmount ?? 0)
      const totalAdjustment = roundedAmount - previousDonation

      return tx.order.update({
        where: { id: orderId },
        data: {
          donationAmount: roundedAmount,
          total: { increment: totalAdjustment },
          lastMutatedBy: 'local',
        },
        select: {
          id: true,
          donationAmount: true,
          total: true,
        },
      })
    }, { timeout: 10000 })

    // Emit order event (mandatory for every Order mutation)
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      donationAmount: roundedAmount,
      total: Number(updated.total),
    }).catch(console.error)

    // Socket dispatch for cross-terminal awareness
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'updated',
      orderId,
    }).catch(console.error)
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      discountTotal: Number(order.discountTotal),
      total: Number(updated.total),
      commissionTotal: 0,
    }, { async: true }).catch(console.error)
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(Number(order.subtotal) * 100),
      taxTotalCents: Math.round(Number(order.taxTotal) * 100),
      discountTotalCents: Math.round(Number(order.discountTotal) * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(Number(updated.total) * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(console.error)

    // Sync
    pushUpstream()
    void notifyDataChanged({ locationId: order.locationId, domain: 'orders', action: 'updated', entityId: orderId })

    return NextResponse.json({
      data: {
        orderId: updated.id,
        donationAmount: Number(updated.donationAmount),
        total: Number(updated.total),
      },
    })
  } catch (error) {
    console.error('Failed to set donation:', error)
    return NextResponse.json(
      { error: 'Failed to set donation' },
      { status: 500 }
    )
  }
})

// DELETE - Remove donation from order
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        total: true,
        donationAmount: true,
        orderNumber: true,
        status: true,
        tableId: true,
        tabName: true,
        guestCount: true,
        employeeId: true,
        subtotal: true,
        taxTotal: true,
        discountTotal: true,
        tipTotal: true,
        itemCount: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const deleteEmployeeId = actor.employeeId || request.nextUrl.searchParams.get('employeeId')
    const deleteAuth = await requirePermission(deleteEmployeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!deleteAuth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: deleteAuth.error },
        { status: deleteAuth.status },
      )
    }

    // Wrap in transaction with FOR UPDATE to prevent concurrent donation + discount
    // from drifting the total (read-then-decrement race on stale donationAmount).
    const txResult = await db.$transaction(async (tx) => {
      // Lock the Order row to serialize concurrent total mutations
      await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE "id" = $1 FOR UPDATE', orderId)

      // Re-read locked values for accurate delta calculation
      const locked = await tx.order.findUnique({
        where: { id: orderId },
        select: { total: true, donationAmount: true },
      })
      if (!locked) throw new Error('Order not found under lock')

      const previousDonation = Number(locked.donationAmount ?? 0)
      if (previousDonation === 0) {
        return { noop: true, orderId: order.id, total: Number(locked.total) } as const
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          donationAmount: null,
          total: { decrement: previousDonation },
          lastMutatedBy: 'local',
        },
        select: {
          id: true,
          donationAmount: true,
          total: true,
        },
      })
      return { noop: false, ...updated } as const
    }, { timeout: 10000 })

    if (txResult.noop) {
      return NextResponse.json({
        data: {
          orderId: txResult.orderId,
          donationAmount: 0,
          total: txResult.total,
        },
      })
    }

    const updated = txResult

    // Emit order event (mandatory for every Order mutation)
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      donationAmount: null,
      total: Number(updated.total),
    }).catch(console.error)

    // Socket dispatch for cross-terminal awareness
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'updated',
      orderId,
    }).catch(console.error)
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: Number(order.subtotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      discountTotal: Number(order.discountTotal),
      total: Number(updated.total),
      commissionTotal: 0,
    }, { async: true }).catch(console.error)
    void dispatchOrderSummaryUpdated(order.locationId, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableId: order.tableId || null,
      tableName: null,
      tabName: order.tabName || null,
      guestCount: order.guestCount ?? 0,
      employeeId: order.employeeId || null,
      subtotalCents: Math.round(Number(order.subtotal) * 100),
      taxTotalCents: Math.round(Number(order.taxTotal) * 100),
      discountTotalCents: Math.round(Number(order.discountTotal) * 100),
      tipTotalCents: Math.round(Number(order.tipTotal) * 100),
      totalCents: Math.round(Number(updated.total) * 100),
      itemCount: order.itemCount ?? 0,
      updatedAt: new Date().toISOString(),
      locationId: order.locationId,
    }, { async: true }).catch(console.error)

    // Sync
    pushUpstream()
    void notifyDataChanged({ locationId: order.locationId, domain: 'orders', action: 'updated', entityId: orderId })

    return NextResponse.json({
      data: {
        orderId: updated.id,
        donationAmount: 0,
        total: Number(updated.total),
      },
    })
  } catch (error) {
    console.error('Failed to remove donation:', error)
    return NextResponse.json(
      { error: 'Failed to remove donation' },
      { status: 500 }
    )
  }
})

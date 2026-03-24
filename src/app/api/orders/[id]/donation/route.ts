import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'

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

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, locationId: true, total: true, donationAmount: true },
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
    const previousDonation = Number(order.donationAmount ?? 0)
    const totalAdjustment = roundedAmount - previousDonation

    const updated = await db.order.update({
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

    // Emit socket events for cross-terminal awareness
    void emitToLocation(order.locationId, 'orders:list-changed', { orderId }).catch(console.error)
    void emitToLocation(order.locationId, 'order:totals-updated', {
      orderId,
      total: Number(updated.total),
      donationAmount: Number(updated.donationAmount),
    }).catch(console.error)

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
      select: { id: true, locationId: true, total: true, donationAmount: true },
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

    const previousDonation = Number(order.donationAmount ?? 0)
    if (previousDonation === 0) {
      return NextResponse.json({
        data: {
          orderId: order.id,
          donationAmount: 0,
          total: Number(order.total),
        },
      })
    }

    const updated = await db.order.update({
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

    // Emit socket events for cross-terminal awareness
    void emitToLocation(order.locationId, 'orders:list-changed', { orderId }).catch(console.error)
    void emitToLocation(order.locationId, 'order:totals-updated', {
      orderId,
      total: Number(updated.total),
      donationAmount: 0,
    }).catch(console.error)

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

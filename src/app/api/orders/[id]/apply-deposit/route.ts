import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { roundToCents } from '@/lib/pricing'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'

interface ApplyDepositRequest {
  reservationId: string
  employeeId?: string
}

/**
 * POST /api/orders/[id]/apply-deposit
 *
 * Apply a reservation deposit as a credit/discount on the order.
 * The deposit amount is applied as an OrderDiscount (type: fixed, name: "Reservation Deposit").
 * If the deposit exceeds the order total, only the order total is applied (remaining credit noted).
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json() as ApplyDepositRequest

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellularDeposit = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellularDeposit ? 'cloud' : 'local'
    const { reservationId } = body

    if (!reservationId) {
      return NextResponse.json(
        { error: 'reservationId is required' },
        { status: 400 }
      )
    }

    // Resolve actor
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId

    // Verify order exists and get locationId
    const orderCheck = await db.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { locationId: true, status: true },
    })
    if (!orderCheck) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Permission check
    const auth = await requirePermission(employeeId, orderCheck.locationId, PERMISSIONS.MGR_DISCOUNTS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (orderCheck.status !== 'open' && orderCheck.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot apply deposit to a closed or paid order' },
        { status: 400 }
      )
    }

    // Track locationId for socket flush
    let outboxLocationId: string | null = null

    const result = await db.$transaction(async (tx) => {
      // Lock the order row
      await tx.$queryRawUnsafe(
        'SELECT id FROM "Order" WHERE id = $1 FOR UPDATE',
        orderId
      )

      // Get full order with items and discounts
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          location: true,
          discounts: { where: { deletedAt: null } },
          items: {
            where: { status: { not: 'voided' }, deletedAt: null },
            include: { modifiers: true },
          },
        },
      })

      if (!order) {
        throw Object.assign(new Error('Order not found'), { statusCode: 404 })
      }

      // Validate reservation exists, matches this location, and is linked to this order
      const reservation = await tx.$queryRawUnsafe<Array<{
        id: string
        locationId: string
        guestName: string
        orderId: string | null
        tableId: string | null
        customerId: string | null
        depositStatus: string | null
      }>>(
        `SELECT id, "locationId", "guestName", "orderId", "tableId", "customerId", "depositStatus"
         FROM "Reservation"
         WHERE id = $1 AND "locationId" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        reservationId, order.locationId
      )

      if (!reservation.length) {
        throw Object.assign(new Error('Reservation not found at this location'), { statusCode: 404 })
      }

      const res = reservation[0]

      // Validate reservation is connected to this order (either directly or via same table)
      if (res.orderId && res.orderId !== orderId) {
        throw Object.assign(
          new Error('This reservation is linked to a different order'),
          { statusCode: 400 }
        )
      }

      // Check deposit status
      if (res.depositStatus !== 'paid') {
        throw Object.assign(
          new Error(`Reservation deposit status is "${res.depositStatus ?? 'not_required'}" -- must be "paid" to apply`),
          { statusCode: 400 }
        )
      }

      // Get total paid deposit amount (completed, not yet fully refunded)
      const depositRows = await tx.$queryRawUnsafe<Array<{
        id: string
        amount: string
        refundedAmount: string
        status: string
      }>>(
        `SELECT id, amount, COALESCE("refundedAmount", 0) as "refundedAmount", status
         FROM "ReservationDeposit"
         WHERE "reservationId" = $1 AND status = 'completed' AND "deletedAt" IS NULL`,
        reservationId
      )

      const totalDepositPaid = depositRows.reduce(
        (sum, d) => sum + Number(d.amount) - Number(d.refundedAmount), 0
      )

      if (totalDepositPaid <= 0) {
        throw Object.assign(new Error('No deposit amount available to apply'), { statusCode: 400 })
      }

      // Check if deposit was already applied (look for existing deposit discount on this order)
      const existingDepositDiscount = order.discounts.find(
        d => d.reason === `reservation_deposit:${reservationId}`
      )
      if (existingDepositDiscount) {
        throw Object.assign(
          new Error('Deposit has already been applied to this order'),
          { statusCode: 409 }
        )
      }

      // Calculate current order total to cap deposit application
      const settings = parseSettings(await getLocationSettings(order.locationId))
      const itemsForCalc: OrderItemForCalculation[] = order.items.map((item) => ({
        price: Number(item.price),
        quantity: item.quantity,
        status: (item as Record<string, unknown>).status as string | undefined,
        categoryType: (item as Record<string, unknown>).categoryType as string | null ?? null,
        modifiers: item.modifiers.map((m) => ({
          price: Number(m.price),
          quantity: m.quantity ?? 1,
        })),
      }))

      const currentTotals = calculateOrderTotals(
        itemsForCalc,
        { tax: { defaultRate: settings.tax?.defaultRate ?? 0 } },
        Number(order.discountTotal),
      )

      // Cap the deposit amount at the order's remaining balance (total - existing discounts)
      const orderBalance = Math.max(0, currentTotals.total)
      const depositToApply = roundToCents(Math.min(totalDepositPaid, orderBalance))

      if (depositToApply <= 0) {
        throw Object.assign(
          new Error('Order balance is zero -- no deposit credit needed'),
          { statusCode: 400 }
        )
      }

      const remainingCredit = roundToCents(totalDepositPaid - depositToApply)

      // Create the deposit discount
      const { randomUUID } = await import('crypto')
      const discountId = randomUUID()

      await tx.orderDiscount.create({
        data: {
          id: discountId,
          locationId: order.locationId,
          orderId,
          name: `Reservation Deposit — ${res.guestName}`,
          amount: depositToApply,
          appliedBy: employeeId || null,
          isAutomatic: false,
          reason: `reservation_deposit:${reservationId}`,
        },
      })

      // Recalculate order totals with the new discount
      const newDiscountTotal = roundToCents(Number(order.discountTotal) + depositToApply)
      const newTotals = calculateOrderTotals(
        itemsForCalc,
        { tax: { defaultRate: settings.tax?.defaultRate ?? 0 } },
        newDiscountTotal,
      )

      // Update order totals
      await tx.order.update({
        where: { id: orderId },
        data: {
          discountTotal: newDiscountTotal,
          total: newTotals.total,
          taxTotal: newTotals.taxTotal,
          version: { increment: 1 },
          lastMutatedBy: mutationOrigin,
        },
      })

      // Mark deposit as applied on the reservation
      await tx.$executeRawUnsafe(
        `UPDATE "Reservation" SET "depositStatus" = 'applied', "updatedAt" = NOW() WHERE id = $1`,
        reservationId
      )

      // Link reservation to order if not already linked
      if (!res.orderId) {
        await tx.$executeRawUnsafe(
          `UPDATE "Reservation" SET "orderId" = $1, "updatedAt" = NOW() WHERE id = $2`,
          orderId, reservationId
        )
      }

      outboxLocationId = order.locationId

      // Queue socket events for real-time UI updates (inside transaction)
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, {
        orderId,
        totals: {
          subtotal: newTotals.subtotal,
          discountTotal: newDiscountTotal,
          taxTotal: newTotals.taxTotal,
          total: newTotals.total,
          tipTotal: Number(order.tipTotal),
        },
        timestamp: new Date().toISOString(),
      })

      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, {
        trigger: 'updated',
        orderId,
      })

      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, {
        orderId,
        status: order.status,
        total: newTotals.total,
        itemCount: order.itemCount,
      })

      return {
        orderId,
        reservationId,
        depositApplied: depositToApply,
        remainingCredit,
        guestName: res.guestName,
        discountId,
        newTotals: {
          subtotal: newTotals.subtotal,
          discountTotal: newDiscountTotal,
          taxTotal: newTotals.taxTotal,
          total: newTotals.total,
        },
      }
    })

    // Flush socket events after transaction commits
    if (outboxLocationId) {
      flushOutboxSafe(outboxLocationId)
    }

    // Emit order event for event sourcing (fire-and-forget, post-transaction)
    void emitOrderEvent(
      outboxLocationId!,
      result.orderId,
      'deposit_applied' as any,
      {
        reservationId: result.reservationId,
        depositAmount: result.depositApplied,
        guestName: result.guestName,
        remainingCredit: result.remainingCredit,
        discountId: result.discountId,
      },
    ).catch(console.error)

    // Notify cloud for upstream sync (fire-and-forget)
    if (outboxLocationId) {
      void notifyDataChanged({ locationId: outboxLocationId, domain: 'reservations', action: 'updated' })
    }

    // Trigger upstream sync (fire-and-forget)
    pushUpstream()

    return NextResponse.json({ data: result })
  } catch (error: unknown) {
    const err = error as { statusCode?: number; message?: string }
    if (err.statusCode) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode })
    }
    console.error('Failed to apply deposit:', error)
    return NextResponse.json(
      { error: 'Failed to apply deposit' },
      { status: 500 }
    )
  }
})

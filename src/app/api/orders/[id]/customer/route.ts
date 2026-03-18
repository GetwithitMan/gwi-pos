import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushSocketOutbox } from '@/lib/socket-outbox'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'

// PUT - Link or unlink customer to/from order
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { customerId } = body as { customerId: string | null }

    // Resolve employeeId from body or session
    const employeeId = (body as any).employeeId || (await getActorFromRequest(request)).employeeId

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let orderLocationId1 = getRequestLocationId()
    if (!orderLocationId1) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await adminDb.order.findFirst({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      orderLocationId1 = orderCheck.locationId
    }

    // Get the order with location settings
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, orderLocationId1, {
      location: true,
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Auth check
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Verify customer exists if linking
    let customer = null
    if (customerId) {
      customer = await db.customer.findUnique({
        where: { id: customerId },
      })

      if (!customer) {
        return NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        )
      }

      // Ensure customer belongs to same location
      if (customer.locationId !== order.locationId) {
        return NextResponse.json(
          { error: 'Customer does not belong to this location' },
          { status: 400 }
        )
      }
    }

    // Update order + queue socket event atomically
    await db.$transaction(async (tx) => {
      await OrderRepository.updateOrder(orderId, order.locationId, { customerId: customerId || null }, tx)

      // Queue order:updated inside transaction for crash safety
      const updatedPayload: OrderUpdatedPayload = {
        orderId,
        changes: ['customer'],
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_UPDATED, updatedPayload)
    })

    // Flush outbox after commit
    void flushSocketOutbox(order.locationId).catch((err) => {
      console.warn('[customer] Outbox flush failed, catch-up will deliver:', err)
    })

    // Fire-and-forget event emission
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      customerId: customerId || null,
    }).catch(console.error)

    // Get loyalty settings
    const settings = parseSettings(order.location.settings)

    const customerTags = customer ? ((customer.tags ?? []) as string[]) : []

    return NextResponse.json({ data: {
      success: true,
      customerId: customerId || null,
      customer: customer ? {
        id: customer.id,
        name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
        firstName: customer.firstName,
        lastName: customer.lastName,
        loyaltyPoints: customer.loyaltyPoints,
        totalSpent: Number(customer.totalSpent),
        totalOrders: customer.totalOrders,
        tags: customerTags,
        isBanned: customerTags.includes('banned'),
        notes: customer.notes,
        birthday: customer.birthday?.toISOString() || null,
      } : null,
      loyaltyEnabled: settings.loyalty.enabled,
      loyaltySettings: settings.loyalty.enabled ? {
        pointsPerDollar: settings.loyalty.pointsPerDollar,
        redemptionEnabled: settings.loyalty.redemptionEnabled,
        pointsPerDollarRedemption: settings.loyalty.pointsPerDollarRedemption,
        minimumRedemptionPoints: settings.loyalty.minimumRedemptionPoints,
        maximumRedemptionPercent: settings.loyalty.maximumRedemptionPercent,
      } : null,
    } })
  } catch (error) {
    console.error('Failed to link customer:', error)
    return NextResponse.json(
      { error: 'Failed to link customer' },
      { status: 500 }
    )
  }
})

// GET - Get customer linked to order with loyalty info
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Resolve employeeId from session
    const { employeeId } = await getActorFromRequest(request)

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let orderLocationId = getRequestLocationId()
    if (!orderLocationId) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await adminDb.order.findFirst({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return NextResponse.json(
          { error: 'Order not found' },
          { status: 404 }
        )
      }
      orderLocationId = orderCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, orderLocationId!, {
      customer: true,
      location: true,
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Auth check
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    const settings = parseSettings(order.location.settings)

    const orderCustomerTags = order.customer ? ((order.customer.tags ?? []) as string[]) : []

    return NextResponse.json({ data: {
      customerId: order.customerId,
      isTaxExempt: order.isTaxExempt,
      customer: order.customer ? {
        id: order.customer.id,
        name: order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        loyaltyPoints: order.customer.loyaltyPoints,
        totalSpent: Number(order.customer.totalSpent),
        totalOrders: order.customer.totalOrders,
        tags: orderCustomerTags,
        isBanned: orderCustomerTags.includes('banned'),
        notes: order.customer.notes,
        birthday: order.customer.birthday?.toISOString() || null,
      } : null,
      loyaltyEnabled: settings.loyalty.enabled,
      loyaltySettings: settings.loyalty.enabled ? {
        pointsPerDollar: settings.loyalty.pointsPerDollar,
        redemptionEnabled: settings.loyalty.redemptionEnabled,
        pointsPerDollarRedemption: settings.loyalty.pointsPerDollarRedemption,
        minimumRedemptionPoints: settings.loyalty.minimumRedemptionPoints,
        maximumRedemptionPercent: settings.loyalty.maximumRedemptionPercent,
      } : null,
    } })
  } catch (error) {
    console.error('Failed to get customer:', error)
    return NextResponse.json(
      { error: 'Failed to get customer' },
      { status: 500 }
    )
  }
})

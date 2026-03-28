import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-customer')

// PUT - Link or unlink customer to/from order
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { customerId } = body as { customerId: string | null }

    // Resolve employeeId from body, query param, or session
    const employeeId = (body as any).employeeId
      || request.nextUrl.searchParams.get('requestingEmployeeId')
      || (await getActorFromRequest(request)).employeeId

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let postLocationId = getRequestLocationId()
    if (!postLocationId) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await db.order.findFirst({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return notFound('Order not found')
      }
      postLocationId = orderCheck.locationId
    }

    // Get the order with location settings
    const order = await OrderRepository.getOrderByIdWithInclude(orderId, postLocationId, {
      location: true,
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Auth check
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // Verify customer exists if linking
    let customer = null
    if (customerId) {
      customer = await db.customer.findUnique({
        where: { id: customerId },
      })

      if (!customer) {
        return notFound('Customer not found')
      }

      // Ensure customer belongs to same location
      if (customer.locationId !== order.locationId) {
        return err('Customer does not belong to this location')
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
    flushOutboxSafe(order.locationId)

    pushUpstream()

    // Fire-and-forget event emission
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      customerId: customerId || null,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // Get loyalty settings
    const settings = parseSettings(order.location.settings)

    const customerTags = customer ? ((customer.tags ?? []) as string[]) : []

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to link customer:', error)
    return err('Failed to link customer', 500)
  }
})

// GET - Get customer linked to order with loyalty info
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    // Resolve employeeId from query param or session
    const requestingEmployeeId = request.nextUrl.searchParams.get('requestingEmployeeId')
    const { employeeId: sessionEmployeeId } = await getActorFromRequest(request)
    const employeeId = requestingEmployeeId || sessionEmployeeId

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let orderLocationId = getRequestLocationId()
    if (!orderLocationId) {
      // Bootstrap: lightweight fetch for locationId, then tenant-safe fetch with include
      const orderCheck = await db.order.findFirst({
        where: { id: orderId },
        select: { id: true, locationId: true },
      })

      if (!orderCheck) {
        return notFound('Order not found')
      }
      orderLocationId = orderCheck.locationId
    }

    const order = await OrderRepository.getOrderByIdWithInclude(orderId, orderLocationId!, {
      customer: true,
      location: true,
    })

    if (!order) {
      return notFound('Order not found')
    }

    // Auth check
    const auth = await requirePermission(employeeId, order.locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    const settings = parseSettings(order.location.settings)

    const orderCustomerTags = order.customer ? ((order.customer.tags ?? []) as string[]) : []

    return ok({
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
    })
  } catch (error) {
    console.error('Failed to get customer:', error)
    return err('Failed to get customer', 500)
  }
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
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

    // Track discounts removed during unlink for event emission
    let removedDiscountIds: string[] = []

    // Update order + queue socket event atomically
    await db.$transaction(async (tx) => {
      // When UNLINKING a customer, remove any auto-applied discounts (loyalty/tier rewards)
      // to prevent the "orphaned reward" loophole where a discount persists after the
      // customer who earned it is removed from the order.
      if (!customerId && order.customerId) {
        const autoDiscounts = await tx.orderDiscount.findMany({
          where: {
            orderId,
            locationId: order.locationId,
            isAutomatic: true,
            deletedAt: null,
          },
          select: { id: true, name: true, amount: true },
        })

        if (autoDiscounts.length > 0) {
          removedDiscountIds = autoDiscounts.map(d => d.id)
          log.info(
            { orderId, discountCount: autoDiscounts.length, discountIds: removedDiscountIds },
            'Removing auto-applied discounts on customer unlink',
          )

          // Soft-delete the auto discounts
          await tx.orderDiscount.updateMany({
            where: { id: { in: removedDiscountIds } },
            data: { deletedAt: new Date() },
          })

          // Recalculate order totals after discount removal
          const orderWithItems = await tx.order.findFirst({
            where: { id: orderId, locationId: order.locationId },
            include: {
              items: { where: { deletedAt: null, status: 'active' } },
              discounts: { where: { deletedAt: null } },
              location: { select: { settings: true } },
            },
          })

          if (orderWithItems) {
            const settings = parseSettings(orderWithItems.location.settings)
            const itemsForCalc: OrderItemForCalculation[] = orderWithItems.items.map(i => ({
              price: Number(i.price),
              quantity: i.quantity,
              isTaxExempt: false,
              itemDiscounts: [],
            }))
            const remainingDiscounts = orderWithItems.discounts.reduce(
              (sum, d) => sum + Number(d.amount), 0
            )
            const totals = calculateOrderTotals(
              itemsForCalc,
              { tax: settings.tax ?? undefined },
              remainingDiscounts,
              Number(orderWithItems.tipTotal),
            )

            await tx.order.update({
              where: { id: orderId },
              data: {
                subtotal: totals.subtotal,
                taxTotal: totals.taxTotal,
                discountTotal: remainingDiscounts,
                total: totals.total,
                lastMutatedBy: 'local',
                version: { increment: 1 },
              },
            })
          }
        }
      }

      await OrderRepository.updateOrder(orderId, order.locationId, { customerId: customerId || null }, tx)

      // Queue order:updated inside transaction for crash safety
      const updatedPayload: OrderUpdatedPayload = {
        orderId,
        changes: removedDiscountIds.length > 0 ? ['customer', 'discounts', 'totals'] : ['customer'],
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

    // Emit DISCOUNT_REMOVED events for each removed auto-discount
    if (removedDiscountIds.length > 0) {
      const discountEvents = removedDiscountIds.map(discountId => ({
        type: 'DISCOUNT_REMOVED' as const,
        payload: { discountId, lineItemId: null, reason: 'Customer unlinked' },
      }))
      void emitOrderEvents(order.locationId, orderId, discountEvents)
        .catch(err => log.warn({ err }, 'Discount removal event emission failed'))
    }

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

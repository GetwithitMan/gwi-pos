import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { roundToCents } from '@/lib/pricing'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-transfer-items')

interface TransferItemsRequest {
  toOrderId: string
  itemIds: string[]
  employeeId: string
}

// POST - Transfer items from one order to another
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: fromOrderId } = await params
    const body = await request.json() as TransferItemsRequest

    const { toOrderId, itemIds, employeeId } = body

    if (!toOrderId || !itemIds || itemIds.length === 0) {
      return err('Destination order ID and item IDs are required')
    }

    if (fromOrderId === toOrderId) {
      return err('Cannot transfer items to the same order')
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let fromLocationId = getRequestLocationId()
    if (!fromLocationId) {
      // Bootstrap: lightweight fetch for locationId
      const fromCheck = await db.order.findFirst({
        where: { id: fromOrderId },
        select: { id: true, locationId: true },
      })

      if (!fromCheck) {
        return notFound('Source order not found')
      }
      fromLocationId = fromCheck.locationId
    }

    // Get source order with location for tax rate
    const fromOrder = await OrderRepository.getOrderByIdWithInclude(fromOrderId, fromLocationId, {
      location: true,
      items: {
        where: { id: { in: itemIds } },
        include: {
          modifiers: true,
        },
      },
    })

    if (!fromOrder) {
      return notFound('Source order not found')
    }

    // Server-side permission check — transfer items between orders requires pos.transfer_order
    // (manager.transfer_checks is for transferring check ownership between employees, not item moves)
    const auth = await requirePermission(employeeId, fromOrder.locationId, PERMISSIONS.POS_TRANSFER_ORDER)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    if (fromOrder.status !== 'open' && fromOrder.status !== 'in_progress') {
      return err('Cannot transfer items from a closed order')
    }

    // Block transfers from orders with existing payments (would create overpayment on source)
    const sourcePayments = await db.payment.count({
      where: { orderId: fromOrderId, status: 'completed', deletedAt: null },
    })
    if (sourcePayments > 0) {
      return err('Cannot transfer items from an order with existing payments. Void the payment first.')
    }

    // Block transfers from orders with active pre-auth card holds
    const activePreAuths = await db.orderCard.count({
      where: { orderId: fromOrderId, status: 'authorized', deletedAt: null },
    })
    if (activePreAuths > 0) {
      return err('Cannot transfer items from an order with active card pre-authorization. Close the tab first.')
    }

    // Get destination order (same location as source)
    const toOrder = await OrderRepository.getOrderByIdWithInclude(toOrderId, fromOrder.locationId, {
      location: true,
    })

    if (!toOrder) {
      return notFound('Destination order not found')
    }

    if (toOrder.status !== 'open' && toOrder.status !== 'in_progress') {
      return err('Cannot transfer items to a closed order')
    }

    // Block cross-location transfers
    if (fromOrder.locationId !== toOrder.locationId) {
      return err('Cannot transfer items between different locations')
    }

    // Verify all items exist in source order
    if (fromOrder.items.length !== itemIds.length) {
      return err('Some items not found in source order')
    }

    // Get location settings for tax calculation
    const settings = parseSettings(fromOrder.location.settings)

    // Calculate totals for transferred items
    let transferSubtotal = 0
    for (const item of fromOrder.items) {
      const itemPrice = Number(item.price) * item.quantity
      const modifiersPrice = item.modifiers.reduce(
        (sum, mod) => sum + Number(mod.price),
        0
      )
      transferSubtotal += itemPrice + modifiersPrice
    }

    // Transfer items in a transaction
    let sourceWasCancelled = false
    await db.$transaction(async (tx) => {
      // Row-level lock on BOTH orders in ID-sorted order to prevent deadlocks
      const [firstId, secondId] = [fromOrderId, toOrderId].sort()
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${firstId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${secondId} FOR UPDATE`

      // TX-KEEP: RELATION — move items to destination order; orderId is a relation FK not in OrderItemUpdateManyMutationInput
      await tx.orderItem.updateMany({
        where: {
          id: { in: itemIds },
          orderId: fromOrderId,
        },
        data: {
          orderId: toOrderId,
        },
      })

      // Update MenuItem.currentOrderId for transferred timed_rental items
      const transferredItems = await OrderItemRepository.getItemsByIdsWithInclude(itemIds, fromOrder.locationId, {
        menuItem: { select: { id: true, itemType: true } },
      }, tx)

      for (const item of transferredItems) {
        if (item.menuItem?.itemType === 'timed_rental') {
          await tx.menuItem.update({
            where: { id: item.menuItemId },
            data: { currentOrderId: toOrderId, currentOrderItemId: item.id },
          })
          await tx.floorPlanElement.updateMany({
            where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
            data: { currentOrderId: toOrderId },
          })
        }
      }

      // Update destination order totals
      const destItems = await OrderItemRepository.getItemsForOrderWithModifiers(toOrderId, fromOrder.locationId, tx)

      let newSubtotal = 0
      for (const item of destItems) {
        const itemPrice = Number(item.price) * item.quantity
        const modifiersPrice = item.modifiers.reduce(
          (sum, mod) => sum + Number(mod.price),
          0
        )
        newSubtotal += itemPrice + modifiersPrice
      }

      const destCalcItems: OrderItemForCalculation[] = destItems.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const destTotals = calculateOrderTotals(
        destCalcItems, fromOrder.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        Number(toOrder.discountTotal), Number(toOrder.tipTotal || 0), undefined, 'card', toOrder.isTaxExempt,
        Number(toOrder.inclusiveTaxRate) || undefined, 0,
        (toOrder as any).exclusiveTaxRate != null ? Number((toOrder as any).exclusiveTaxRate) : undefined
      )

      const destDonation = Number(toOrder.donationAmount || 0)
      const destConvFee = Number(toOrder.convenienceFee || 0)
      const destFinalTotal = destDonation > 0 || destConvFee > 0
        ? roundToCents(destTotals.total + destDonation + destConvFee)
        : destTotals.total

      await OrderRepository.updateOrder(toOrderId, fromOrder.locationId, {
        subtotal: destTotals.subtotal,
        taxTotal: destTotals.taxTotal,
        taxFromInclusive: destTotals.taxFromInclusive,
        taxFromExclusive: destTotals.taxFromExclusive,
        discountTotal: destTotals.discountTotal,
        total: destFinalTotal,
        itemCount: destItems.reduce((sum, i) => sum + i.quantity, 0),
        version: { increment: 1 },
      }, tx)

      // Update source order totals
      const sourceItems = await OrderItemRepository.getItemsForOrderWithModifiers(fromOrderId, fromOrder.locationId, tx)

      let sourceSubtotal = 0
      for (const item of sourceItems) {
        const itemPrice = Number(item.price) * item.quantity
        const modifiersPrice = item.modifiers.reduce(
          (sum, mod) => sum + Number(mod.price),
          0
        )
        sourceSubtotal += itemPrice + modifiersPrice
      }

      const sourceCalcItems: OrderItemForCalculation[] = sourceItems.map(i => ({
        price: Number(i.price), quantity: i.quantity, status: i.status,
        itemTotal: Number(i.itemTotal), isTaxInclusive: i.isTaxInclusive ?? false,
        modifiers: i.modifiers.map(m => ({ price: Number(m.price), quantity: m.quantity ?? 1 })),
      }))
      const sourceTotals = calculateOrderTotals(
        sourceCalcItems, fromOrder.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } },
        Number(fromOrder.discountTotal), Number(fromOrder.tipTotal || 0), undefined, 'card', fromOrder.isTaxExempt,
        Number(fromOrder.inclusiveTaxRate) || undefined, 0,
        (fromOrder as any).exclusiveTaxRate != null ? Number((fromOrder as any).exclusiveTaxRate) : undefined
      )

      const srcDonation = Number(fromOrder.donationAmount || 0)
      const srcConvFee = Number(fromOrder.convenienceFee || 0)
      const srcFinalTotal = srcDonation > 0 || srcConvFee > 0
        ? roundToCents(sourceTotals.total + srcDonation + srcConvFee)
        : sourceTotals.total

      await OrderRepository.updateOrder(fromOrderId, fromOrder.locationId, {
        subtotal: sourceTotals.subtotal,
        taxTotal: sourceTotals.taxTotal,
        taxFromInclusive: sourceTotals.taxFromInclusive,
        taxFromExclusive: sourceTotals.taxFromExclusive,
        discountTotal: sourceTotals.discountTotal,
        total: srcFinalTotal,
        itemCount: sourceItems.reduce((sum, i) => sum + i.quantity, 0),
        version: { increment: 1 },
      }, tx)

      // Auto-cancel source order if all items were transferred out
      if (sourceItems.length === 0) {
        await OrderRepository.updateOrder(fromOrderId, fromOrder.locationId, { status: 'cancelled', closedAt: new Date() }, tx)
        sourceWasCancelled = true
      }

      // Create audit log
      await tx.auditLog.create({
        data: {
          locationId: fromOrder.locationId,
          employeeId,
          action: 'items_transferred',
          entityType: 'order',
          entityId: fromOrderId,
          details: {
            fromOrderId,
            toOrderId,
            itemIds,
            itemCount: itemIds.length,
            transferAmount: transferSubtotal,
          },
        },
      })
    })

    // Dispatch socket events for both orders (fire-and-forget)
    void dispatchOrderUpdated(fromOrder.locationId, { orderId: fromOrderId, changes: ['items'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
    void dispatchOrderUpdated(fromOrder.locationId, { orderId: toOrderId, changes: ['items'] }).catch(err => log.warn({ err }, 'order updated dispatch failed'))
    void dispatchOpenOrdersChanged(fromOrder.locationId, {
      trigger: 'transferred',
      orderId: fromOrderId,
      tableId: fromOrder.tableId || undefined,
    }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.transfer-items'))

    if (sourceWasCancelled) {
      void emitOrderEvent(fromOrder.locationId, fromOrderId, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: 'All items transferred out',
      }).catch(err => log.warn({ err }, 'Background task failed'))
      void dispatchOpenOrdersChanged(fromOrder.locationId, {
        trigger: 'voided',
        orderId: fromOrderId,
        tableId: fromOrder.tableId || undefined,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.transfer-items'))
    }

    // Event emission: items removed from source order
    const sourceItemEvents = itemIds.map((lineItemId: string) => ({
      type: 'ITEM_REMOVED' as const,
      payload: { lineItemId, reason: `Transferred to order ${toOrderId}` },
    }))
    void emitOrderEvents(fromOrder.locationId, fromOrderId, sourceItemEvents).catch(err => log.warn({ err }, 'Background task failed'))

    // Event emission: ITEM_ADDED for each transferred item on the DESTINATION order.
    // This ensures KDS screens, Android event projectors, and all event consumers
    // see the transferred items — fixing the "vanishing food" bug where the
    // destination order's event stream was incomplete.
    try {
      const transferredItems = await OrderItemRepository.getItemsByIdsWithInclude(
        itemIds, fromOrder.locationId, { modifiers: true },
      )
      const destItemEvents = transferredItems.map(item => ({
        type: 'ITEM_ADDED' as const,
        payload: {
          lineItemId: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          priceCents: Math.round(Number(item.price) * 100),
          quantity: item.quantity,
          modifiers: item.modifiers.map(m => ({
            id: m.id,
            name: m.name,
            priceCents: Math.round(Number(m.price) * 100),
          })),
          specialNotes: item.specialNotes,
          seatNumber: item.seatNumber,
          courseNumber: item.courseNumber,
          isHeld: item.isHeld,
          transferredFrom: fromOrderId,
        },
      }))
      void emitOrderEvents(fromOrder.locationId, toOrderId, destItemEvents)
        .catch(err => log.warn({ err }, 'Destination ITEM_ADDED event emission failed'))
    } catch (err) {
      log.warn({ err, toOrderId, itemIds }, 'Failed to emit ITEM_ADDED events for transferred items')
    }

    pushUpstream()

    return ok({
      success: true,
      transferred: {
        itemCount: itemIds.length,
        amount: transferSubtotal,
        fromOrderId,
        toOrderId,
      },
    })
  } catch (error) {
    console.error('Failed to transfer items:', error)
    return err('Failed to transfer items', 500)
  }
})

// GET - Get available orders to transfer to (open orders at same location)
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: currentOrderId } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('Location ID is required')
    }

    // Get current order to exclude it
    const currentOrder = await OrderRepository.getOrderById(currentOrderId, locationId)

    if (!currentOrder) {
      return notFound('Order not found')
    }

    // Get open orders at this location (exclude current order)
    const orders = await db.order.findMany({
      where: {
        locationId,
        id: { not: currentOrderId },
        status: { in: ['open', 'in_progress'] },
      },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        table: {
          select: {
            name: true,
          },
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const formattedOrders = orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tabName: order.tabName,
      tableNumber: order.table?.name || null,
      status: order.status,
      total: Number(order.total),
      itemCount: order._count.items,
      employeeName: order.employee?.displayName ||
        `${order.employee?.firstName ?? ''} ${order.employee?.lastName ?? ''}`.trim() || 'Unknown',
      createdAt: order.createdAt.toISOString(),
    }))

    return ok({ orders: formattedOrders })
  } catch (error) {
    console.error('Failed to get transfer targets:', error)
    return err('Failed to get transfer targets', 500)
  }
})

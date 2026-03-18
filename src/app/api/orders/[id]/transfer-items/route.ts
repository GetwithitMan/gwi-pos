import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import * as OrderItemRepository from '@/lib/repositories/order-item-repository'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateOrderTotals } from '@/lib/order-calculations'
import type { OrderItemForCalculation } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { getRequestLocationId } from '@/lib/request-context'

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
      return NextResponse.json(
        { error: 'Destination order ID and item IDs are required' },
        { status: 400 }
      )
    }

    if (fromOrderId === toOrderId) {
      return NextResponse.json(
        { error: 'Cannot transfer items to the same order' },
        { status: 400 }
      )
    }

    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let fromLocationId = getRequestLocationId()
    if (!fromLocationId) {
      // Bootstrap: lightweight fetch for locationId
      const fromCheck = await adminDb.order.findFirst({
        where: { id: fromOrderId },
        select: { id: true, locationId: true },
      })

      if (!fromCheck) {
        return NextResponse.json(
          { error: 'Source order not found' },
          { status: 404 }
        )
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
      return NextResponse.json(
        { error: 'Source order not found' },
        { status: 404 }
      )
    }

    // Server-side permission check
    const auth = await requirePermission(employeeId, fromOrder.locationId, PERMISSIONS.MGR_TRANSFER_CHECKS)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (fromOrder.status !== 'open' && fromOrder.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot transfer items from a closed order' },
        { status: 400 }
      )
    }

    // Get destination order (same location as source)
    const toOrder = await OrderRepository.getOrderByIdWithInclude(toOrderId, fromOrder.locationId, {
      location: true,
    })

    if (!toOrder) {
      return NextResponse.json(
        { error: 'Destination order not found' },
        { status: 404 }
      )
    }

    if (toOrder.status !== 'open' && toOrder.status !== 'in_progress') {
      return NextResponse.json(
        { error: 'Cannot transfer items to a closed order' },
        { status: 400 }
      )
    }

    // Verify all items exist in source order
    if (fromOrder.items.length !== itemIds.length) {
      return NextResponse.json(
        { error: 'Some items not found in source order' },
        { status: 400 }
      )
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
        Number(toOrder.discountTotal), 0, undefined, 'card', toOrder.isTaxExempt,
        Number(toOrder.inclusiveTaxRate) || undefined
      )

      await OrderRepository.updateOrder(toOrderId, fromOrder.locationId, {
        subtotal: destTotals.subtotal,
        taxTotal: destTotals.taxTotal,
        taxFromInclusive: destTotals.taxFromInclusive,
        taxFromExclusive: destTotals.taxFromExclusive,
        discountTotal: destTotals.discountTotal,
        total: destTotals.total,
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
        Number(fromOrder.discountTotal), 0, undefined, 'card', fromOrder.isTaxExempt,
        Number(fromOrder.inclusiveTaxRate) || undefined
      )

      await OrderRepository.updateOrder(fromOrderId, fromOrder.locationId, {
        subtotal: sourceTotals.subtotal,
        taxTotal: sourceTotals.taxTotal,
        taxFromInclusive: sourceTotals.taxFromInclusive,
        taxFromExclusive: sourceTotals.taxFromExclusive,
        discountTotal: sourceTotals.discountTotal,
        total: sourceTotals.total,
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
    void dispatchOrderUpdated(fromOrder.locationId, { orderId: fromOrderId, changes: ['items'] }).catch(() => {})
    void dispatchOrderUpdated(fromOrder.locationId, { orderId: toOrderId, changes: ['items'] }).catch(() => {})
    void dispatchOpenOrdersChanged(fromOrder.locationId, {
      trigger: 'transferred',
      orderId: fromOrderId,
      tableId: fromOrder.tableId || undefined,
    }, { async: true }).catch(() => {})

    if (sourceWasCancelled) {
      void emitOrderEvent(fromOrder.locationId, fromOrderId, 'ORDER_CLOSED', {
        closedStatus: 'cancelled',
        reason: 'All items transferred out',
      }).catch(console.error)
      void dispatchOpenOrdersChanged(fromOrder.locationId, {
        trigger: 'voided',
        orderId: fromOrderId,
        tableId: fromOrder.tableId || undefined,
      }, { async: true }).catch(() => {})
    }

    // Event emission: items removed from source order
    const sourceItemEvents = itemIds.map((lineItemId: string) => ({
      type: 'ITEM_REMOVED' as const,
      payload: { lineItemId, reason: `Transferred to order ${toOrderId}` },
    }))
    void emitOrderEvents(fromOrder.locationId, fromOrderId, sourceItemEvents).catch(console.error)

    // Event emission: items added to target order (metadata-level — individual item payloads not available from updateMany)
    void emitOrderEvent(fromOrder.locationId, toOrderId, 'ORDER_METADATA_UPDATED', {
      reason: `Received ${itemIds.length} items transferred from order ${fromOrderId}`,
    }).catch(console.error)

    return NextResponse.json({ data: {
      success: true,
      transferred: {
        itemCount: itemIds.length,
        amount: transferSubtotal,
        fromOrderId,
        toOrderId,
      },
    } })
  } catch (error) {
    console.error('Failed to transfer items:', error)
    return NextResponse.json(
      { error: 'Failed to transfer items' },
      { status: 500 }
    )
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
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get current order to exclude it
    const currentOrder = await OrderRepository.getOrderById(currentOrderId, locationId)

    if (!currentOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Get open orders at this location (exclude current order)
    const orders = await adminDb.order.findMany({
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
      employeeName: order.employee.displayName ||
        `${order.employee.firstName} ${order.employee.lastName}`,
      createdAt: order.createdAt.toISOString(),
    }))

    return NextResponse.json({ data: { orders: formattedOrders } })
  } catch (error) {
    console.error('Failed to get transfer targets:', error)
    return NextResponse.json(
      { error: 'Failed to get transfer targets' },
      { status: 500 }
    )
  }
})

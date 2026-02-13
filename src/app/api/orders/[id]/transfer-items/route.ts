import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { calculateSimpleOrderTotals as calculateOrderTotals } from '@/lib/order-calculations'
import { withVenue } from '@/lib/with-venue'

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

    // Get source order with location for tax rate
    const fromOrder = await db.order.findUnique({
      where: { id: fromOrderId },
      include: {
        location: true,
        items: {
          where: { id: { in: itemIds } },
          include: {
            modifiers: true,
          },
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

    // Get destination order
    const toOrder = await db.order.findUnique({
      where: { id: toOrderId },
      include: { location: true },
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
    await db.$transaction(async (tx) => {
      // Move items to destination order
      await tx.orderItem.updateMany({
        where: {
          id: { in: itemIds },
          orderId: fromOrderId,
        },
        data: {
          orderId: toOrderId,
        },
      })

      // Update destination order totals
      const destItems = await tx.orderItem.findMany({
        where: { orderId: toOrderId },
        include: { modifiers: true },
      })

      let newSubtotal = 0
      for (const item of destItems) {
        const itemPrice = Number(item.price) * item.quantity
        const modifiersPrice = item.modifiers.reduce(
          (sum, mod) => sum + Number(mod.price),
          0
        )
        newSubtotal += itemPrice + modifiersPrice
      }

      const destTotals = calculateOrderTotals(newSubtotal, Number(toOrder.discountTotal), settings)

      await tx.order.update({
        where: { id: toOrderId },
        data: destTotals,
      })

      // Update source order totals
      const sourceItems = await tx.orderItem.findMany({
        where: { orderId: fromOrderId },
        include: { modifiers: true },
      })

      let sourceSubtotal = 0
      for (const item of sourceItems) {
        const itemPrice = Number(item.price) * item.quantity
        const modifiersPrice = item.modifiers.reduce(
          (sum, mod) => sum + Number(mod.price),
          0
        )
        sourceSubtotal += itemPrice + modifiersPrice
      }

      const sourceTotals = calculateOrderTotals(sourceSubtotal, Number(fromOrder.discountTotal), settings)

      await tx.order.update({
        where: { id: fromOrderId },
        data: sourceTotals,
      })

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

    return NextResponse.json({
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
    const currentOrder = await db.order.findUnique({
      where: { id: currentOrderId },
    })

    if (!currentOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
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
      employeeName: order.employee.displayName ||
        `${order.employee.firstName} ${order.employee.lastName}`,
      createdAt: order.createdAt.toISOString(),
    }))

    return NextResponse.json({ orders: formattedOrders })
  } catch (error) {
    console.error('Failed to get transfer targets:', error)
    return NextResponse.json(
      { error: 'Failed to get transfer targets' },
      { status: 500 }
    )
  }
})

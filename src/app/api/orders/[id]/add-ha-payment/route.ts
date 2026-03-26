import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { dispatchOpenOrdersChanged, dispatchOrderTotalsUpdate } from '@/lib/socket-dispatch'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-add-ha-payment')

// POST - Add a house account balance payment as an order line item
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params

  try {
    const body = await request.json()
    const { houseAccountId, amount, employeeId } = body as {
      houseAccountId?: string
      amount?: number
      employeeId?: string
    }

    // Auth check
    const actor = await getActorFromRequest(request)
    const resolvedEmployeeId = actor.employeeId ?? employeeId
    // Fast path: locationId from request context (JWT/cellular). Fallback: bootstrap from DB.
    let haLocationId = getRequestLocationId()
    if (!haLocationId) {
      const orderForAuth = await db.order.findFirst({
        where: { id: orderId },
        select: { locationId: true },
      })
      haLocationId = orderForAuth?.locationId ?? undefined
    }
    if (haLocationId) {
      const auth = await requirePermission(resolvedEmployeeId, haLocationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    if (!houseAccountId) {
      return NextResponse.json({ error: 'houseAccountId is required' }, { status: 400 })
    }

    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })
    }

    // Validate the order exists and fetch current totals
    const locationId = haLocationId
    const order = locationId
      ? await OrderRepository.getOrderByIdWithSelect(orderId, locationId, { id: true, locationId: true, status: true, taxTotal: true, discountTotal: true, tipTotal: true })
      : null

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot add items to an order with status: ${order.status}` },
        { status: 400 }
      )
    }

    // Validate the house account exists, is active, and has sufficient balance
    // TODO: Add HouseAccountRepository once that repository exists
    const houseAccount = await db.houseAccount.findUnique({
      where: { id: houseAccountId },
    })

    if (!houseAccount) {
      return NextResponse.json({ error: 'House account not found' }, { status: 404 })
    }

    if (houseAccount.status !== 'active') {
      return NextResponse.json(
        { error: `House account is ${houseAccount.status}` },
        { status: 400 }
      )
    }

    const currentBalance = Number(houseAccount.currentBalance)
    if (currentBalance < amount) {
      return NextResponse.json(
        {
          error: `Insufficient house account balance. Current balance: $${currentBalance.toFixed(2)}`,
          currentBalance,
        },
        { status: 400 }
      )
    }

    // Find or create a "System" category for the location
    // TODO: Add CategoryRepository once that repository exists
    let systemCategory = await db.category.findFirst({
      where: {
        locationId: order.locationId,
        name: 'System',
        categoryType: 'retail',
        deletedAt: null,
      },
      select: { id: true },
    })

    if (!systemCategory) {
      systemCategory = await db.category.create({
        data: {
          locationId: order.locationId,
          name: 'System',
          categoryType: 'retail',
          sortOrder: 9999,
          isActive: false, // Hidden from regular menu
        },
      })
    }

    // Find or create the "House Account Payment" system menu item
    // TODO: Add MenuItemRepository.findByNameAndCategory() once available
    // TODO: Add MenuItemRepository.findByNameAndCategory() once available
    let systemMenuItem = await db.menuItem.findFirst({
      where: {
        locationId: order.locationId,
        name: 'House Account Payment',
        categoryId: systemCategory.id,
        deletedAt: null,
      },
      select: { id: true },
    })

    if (!systemMenuItem) {
      systemMenuItem = await db.menuItem.create({
        data: {
          locationId: order.locationId,
          categoryId: systemCategory.id,
          name: 'House Account Payment',
          price: 0, // Price is set per-item on the order item
          isActive: false, // Hidden from regular menu
        },
      })
    }

    // Create the order item
    // TODO: Add OrderItemRepository.createItem() once that write method exists
    // TODO: Add OrderItemRepository.createItem() once that write method exists
    const orderItem = await db.orderItem.create({
      data: {
        locationId: order.locationId,
        orderId,
        menuItemId: systemMenuItem.id,
        name: `House Account Payment - ${houseAccount.name}`,
        price: amount,
        quantity: 1,
        specialNotes: `ha_payment:${houseAccountId}`,
        categoryType: 'retail',
        itemTotal: amount,
        status: 'active',
        isTaxInclusive: false, // House account payments are always tax-exclusive
        kitchenStatus: 'delivered', // No kitchen routing needed
      },
    })

    // Recalculate order totals
    const activeItems = await OrderItemRepository.getItemsForOrderWhere(
      orderId, order.locationId,
      { status: 'active', deletedAt: null },
    )
    // Re-fetch with modifiers for total calculation
    const activeItemsWithMods = activeItems.length > 0
      ? await OrderItemRepository.getItemsByIdsWithInclude(
          activeItems.map(i => i.id), order.locationId,
          { modifiers: { where: { deletedAt: null } } },
        )
      : []

    let newSubtotal = 0
    for (const item of activeItemsWithMods) {
      const modTotal = (item as any).modifiers.reduce((s: number, m: any) => s + Number(m.price), 0)
      newSubtotal += (Number(item.price) + modTotal) * item.quantity
    }

    const taxTotal = Number(order.taxTotal ?? 0)
    const discountTotal = Number(order.discountTotal ?? 0)
    const newTotal = newSubtotal + taxTotal - discountTotal

    await OrderRepository.updateOrder(orderId, order.locationId, {
      subtotal: newSubtotal,
      total: newTotal,
    })

    // Emit order events for event sourcing
    void emitOrderEvent(order.locationId, orderId, 'ITEM_ADDED', {
      lineItemId: orderItem.id,
      menuItemId: systemMenuItem.id,
      name: orderItem.name,
      priceCents: Math.round(amount * 100),
      quantity: 1,
      isHeld: false,
      soldByWeight: false,
      specialNotes: orderItem.specialNotes,
    }).catch(err => console.error('[add-ha-payment] Failed to emit ITEM_ADDED event:', err))

    // Emit socket events for real-time updates
    void dispatchOpenOrdersChanged(order.locationId, {
      trigger: 'item_updated',
      orderId,
    }).catch(err => log.warn({ err }, 'Background task failed'))
    void dispatchOrderTotalsUpdate(order.locationId, orderId, {
      subtotal: newSubtotal,
      taxTotal,
      tipTotal: Number(order.tipTotal ?? 0),
      discountTotal,
      total: newTotal,
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return NextResponse.json({
      success: true,
      orderItem: {
        id: orderItem.id,
        name: orderItem.name,
        price: Number(orderItem.price),
        quantity: orderItem.quantity,
        specialNotes: orderItem.specialNotes,
        categoryType: orderItem.categoryType,
      },
    })
  } catch (error) {
    console.error('[add-ha-payment] Error:', error)
    return NextResponse.json(
      { error: 'Failed to add house account payment item' },
      { status: 500 }
    )
  }
})

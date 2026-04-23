import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { OrderRepository } from '@/lib/repositories'
import { getRequestLocationId } from '@/lib/request-context'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { recalculateOrderTotals } from '@/lib/domain/order-items/order-totals'
import { getLocationSettings } from '@/lib/location-cache'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderTotalsUpdatedPayload, OrdersListChangedPayload, OrderSummaryUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { dispatchCFDOrderUpdated } from '@/lib/socket-dispatch/cfd-dispatch'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('orders-add-ha-payment')

// ── Zod schema for POST /api/orders/[id]/add-ha-payment ─────────────
const AddHaPaymentSchema = z.object({
  houseAccountId: z.string().min(1, 'houseAccountId is required'),
  amount: z.number().positive('amount must be a positive number'),
  employeeId: z.string().min(1).optional(),
}).passthrough()

// POST - Add a house account balance payment as an order line item
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params

  try {
    const rawBody = await request.json()
    const parseResult = AddHaPaymentSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data
    const { houseAccountId, amount, employeeId } = body

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
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    const locationId = haLocationId
    if (!locationId) {
      return notFound('Order not found')
    }

    // Track locationId for outbox flush after transaction commits
    let outboxLocationId: string | null = null

    const result = await db.$transaction(async (tx) => {
      // Lock the Order row FOR UPDATE to prevent concurrent modifications
      // (e.g., simultaneous HA payments or pay/close)
      const lockedOrderRows = await tx.$queryRaw<Array<{
        id: string; locationId: string; status: string;
        orderNumber: number; tableId: string | null; tabName: string | null;
        guestCount: number; employeeId: string | null; itemCount: number;
        tipTotal: string; discountTotal: string; isTaxExempt: boolean;
      }>>`SELECT id, "locationId", status, "orderNumber", "tableId", "tabName",
                "guestCount", "employeeId", "itemCount",
                "tipTotal"::numeric::text as "tipTotal",
                "discountTotal"::numeric::text as "discountTotal",
                "isTaxExempt"
         FROM "Order" WHERE id = ${orderId} AND "locationId" = ${locationId} AND "deletedAt" IS NULL FOR UPDATE`
      const order = lockedOrderRows[0]
        ? {
            id: lockedOrderRows[0].id,
            locationId: lockedOrderRows[0].locationId,
            status: lockedOrderRows[0].status,
            orderNumber: lockedOrderRows[0].orderNumber,
            tableId: lockedOrderRows[0].tableId,
            tabName: lockedOrderRows[0].tabName,
            guestCount: lockedOrderRows[0].guestCount ?? 0,
            employeeId: lockedOrderRows[0].employeeId,
            itemCount: lockedOrderRows[0].itemCount ?? 0,
            tipTotal: Number(lockedOrderRows[0].tipTotal),
            discountTotal: Number(lockedOrderRows[0].discountTotal),
            isTaxExempt: lockedOrderRows[0].isTaxExempt ?? false,
          }
        : null

      if (!order) {
        return notFound('Order not found')
      }

      if (['paid', 'closed', 'cancelled', 'voided'].includes(order.status)) {
        return err(`Cannot add items to an order with status: ${order.status}`)
      }

      // Capture locationId for outbox flush after commit
      outboxLocationId = order.locationId

      // Lock the HouseAccount row FOR UPDATE to prevent concurrent overdraft
      const lockedHaRows = await tx.$queryRaw<Array<{
        id: string; name: string; status: string; currentBalance: string;
      }>>`SELECT id, name, status, "currentBalance"::numeric::text as "currentBalance"
         FROM "HouseAccount" WHERE id = ${houseAccountId} FOR UPDATE`
      const houseAccount = lockedHaRows[0] ?? null

      if (!houseAccount) {
        return notFound('House account not found')
      }

      if (houseAccount.status !== 'active') {
        return err(`House account is ${houseAccount.status}`)
      }

      const currentBalance = Number(houseAccount.currentBalance)
      if (currentBalance < amount) {
        return err(`Insufficient house account balance. Current balance: $${currentBalance.toFixed(2)}`)
      }

      // Find or create a "System" category for the location
      let systemCategory = await tx.category.findFirst({
        where: {
          locationId: order.locationId,
          name: 'System',
          categoryType: 'retail',
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!systemCategory) {
        systemCategory = await tx.category.create({
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
      let systemMenuItem = await tx.menuItem.findFirst({
        where: {
          locationId: order.locationId,
          name: 'House Account Payment',
          categoryId: systemCategory.id,
          deletedAt: null,
        },
        select: { id: true },
      })

      if (!systemMenuItem) {
        systemMenuItem = await tx.menuItem.create({
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
      const orderItem = await tx.orderItem.create({
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

      // Recalculate order totals using shared utility (handles tax, discounts, rounding)
      const locationSettings = await getLocationSettings(order.locationId)
      const totals = await recalculateOrderTotals(
        tx,
        orderId,
        locationSettings,
        order.tipTotal,
        order.isTaxExempt,
      )

      await OrderRepository.updateOrder(orderId, order.locationId, {
        subtotal: totals.subtotal,
        taxTotal: totals.taxTotal,
        taxFromInclusive: totals.taxFromInclusive,
        taxFromExclusive: totals.taxFromExclusive,
        total: totals.total,
        commissionTotal: totals.commissionTotal,
        itemCount: totals.itemCount,
        version: { increment: 1 },
      }, tx)

      // Emit order event for event sourcing (fire-and-forget)
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

      // Queue critical socket events in the outbox (atomic with order mutation)
      const totalsPayload: OrderTotalsUpdatedPayload = {
        orderId,
        totals: {
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          tipTotal: order.tipTotal,
          discountTotal: order.discountTotal,
          total: totals.total,
          commissionTotal: totals.commissionTotal,
        },
        timestamp: new Date().toISOString(),
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, totalsPayload)

      const listPayload: OrdersListChangedPayload = {
        trigger: 'item_updated',
        orderId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listPayload)

      const summaryPayload: OrderSummaryUpdatedPayload = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        tableId: order.tableId || null,
        tableName: null,
        tabName: order.tabName || null,
        guestCount: order.guestCount,
        employeeId: order.employeeId || null,
        subtotalCents: Math.round(totals.subtotal * 100),
        taxTotalCents: Math.round(totals.taxTotal * 100),
        discountTotalCents: Math.round(order.discountTotal * 100),
        tipTotalCents: Math.round(order.tipTotal * 100),
        totalCents: Math.round(totals.total * 100),
        itemCount: totals.itemCount,
        updatedAt: new Date().toISOString(),
        locationId: order.locationId,
      }
      await queueSocketEvent(tx, order.locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, summaryPayload)

      return ok({
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
    })

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    if (outboxLocationId) {
      flushOutboxSafe(outboxLocationId)
    }

    const cfdOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
      items: { include: { modifiers: true } },
      discounts: true,
    })
    if (cfdOrder) {
      dispatchCFDOrderUpdated(locationId, {
        orderId: cfdOrder.id,
        orderNumber: cfdOrder.orderNumber,
        items: cfdOrder.items
          .filter(i => i.status === 'active')
          .map(i => ({
            name: i.name,
            quantity: i.quantity,
            price: Number(i.itemTotal),
            modifiers: i.modifiers.map(m => m.name),
            status: i.status,
          })),
        subtotal: Number(cfdOrder.subtotal),
        tax: Number(cfdOrder.taxTotal),
        total: Number(cfdOrder.total),
        discountTotal: Number(cfdOrder.discountTotal),
        taxFromInclusive: Number(cfdOrder.taxFromInclusive ?? 0),
        taxFromExclusive: Number(cfdOrder.taxFromExclusive ?? 0),
      })
    }

    pushUpstream()

    return result
  } catch (error) {
    console.error('[add-ha-payment] Error:', error)
    return err('Failed to add house account payment item', 500)
  }
})

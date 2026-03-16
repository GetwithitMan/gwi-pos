import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchSplitCreated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { checkOrderClaim } from '@/lib/order-claim'
import { SPLITTABLE_STATUSES } from '@/lib/domain/order-status'
import {
  type SplitRequest,
  type SplitSourceOrder,
  getSplitOrders,
  createEvenSplit,
  createItemSplit,
  createSeatSplit,
  createTableSplit,
  calculateCustomSplit,
} from '@/lib/domain/split-order'

// POST - Split an order into multiple trackable sub-orders
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json() as SplitRequest

    // Order claim check — block if another employee has an active claim
    if (body.employeeId) {
      const terminalId = request.headers.get('x-terminal-id')
      const claimBlock = await checkOrderClaim(db, id, body.employeeId, terminalId)
      if (claimBlock) {
        return NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        )
      }
    }

    // Get the original order with all details
    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: true,
        location: true,
        items: {
          where: { deletedAt: null },
          include: {
            modifiers: true,
            menuItem: { select: { id: true, itemType: true } },
            itemDiscounts: { where: { deletedAt: null } },
          },
        },
        discounts: {
          where: { deletedAt: null },
        },
        payments: {
          where: { status: 'completed' },
        },
        cards: true,
        splitOrders: {
          include: {
            payments: {
              where: { status: 'completed' },
            },
            items: true,
          },
          orderBy: { splitIndex: 'asc' as const },
        },
        parentOrder: {
          include: {
            splitOrders: {
              include: {
                payments: { where: { status: 'completed' } },
                items: true,
              },
              orderBy: { splitIndex: 'asc' as const },
            },
            payments: { where: { status: 'completed' } },
            items: true,
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Status guard: only splittable statuses allowed (from domain module)
    if (!SPLITTABLE_STATUSES.includes(order.status)) {
      return NextResponse.json(
        { error: `Cannot split order in '${order.status}' status` },
        { status: 400 }
      );
    }

    // Auth check — require pos.split_checks permission (skip for read-only get_splits)
    if (body.type !== 'get_splits') {
      const auth = await requirePermission(body.employeeId, order.locationId, PERMISSIONS.POS_SPLIT_CHECKS)
      if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Block splitting orders with active pre-auth holds
    if (body.type !== 'get_splits') {
      const activeCards = order.cards?.filter((c: any) => c.status === 'authorized') || []
      if (activeCards.length > 0) {
        return NextResponse.json(
          { error: 'Cannot split order with active pre-authorization. Close the tab or void the pre-auth first.' },
          { status: 400 }
        )
      }

      // Block splitting orders with partial payments (including gift cards)
      const completedPayments = order.payments?.filter((p: any) => p.status === 'completed') || []
      if (completedPayments.length > 0) {
        return NextResponse.json(
          { error: 'Cannot split order with existing payments. Void payments first or pay remaining balance.' },
          { status: 400 }
        )
      }
    }

    // If this is a split order, get the parent
    const isAlreadySplit = order.parentOrderId !== null || order.splitOrders.length > 0

    // Get tax rate from location settings
    const locSettings = order.location.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number } } | null
    const taxRate = getLocationTaxRate(locSettings)
    // Prefer order-level snapshot (survives setting changes); fall back to location setting with > 0 guard
    const orderInclRate = Number(order.inclusiveTaxRate) || undefined
    const inclusiveTaxRateRaw = locSettings?.tax?.inclusiveTaxRate
    const inclusiveTaxRate = orderInclRate
      ?? (inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw) && inclusiveTaxRateRaw > 0
        ? inclusiveTaxRateRaw / 100 : undefined)

    // Cast to domain type (Prisma result is structurally compatible)
    const splitOrder = order as unknown as SplitSourceOrder

    // Handle get_splits - return all split orders for navigation
    if (body.type === 'get_splits') {
      const result = getSplitOrders(splitOrder)
      return NextResponse.json({ data: { type: 'get_splits', ...result } })
    }

    if (order.status === 'paid' || order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot split a closed order' },
        { status: 400 }
      )
    }

    // Calculate what's already been paid on this order
    const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0)

    if (body.type === 'even') {
      const numWays = body.numWays || 2
      if (numWays < 2 || numWays > 10) {
        return NextResponse.json(
          { error: 'Must split between 2 and 10 ways' },
          { status: 400 }
        )
      }

      if (isAlreadySplit) {
        return NextResponse.json(
          { error: 'Order is already split. Navigate between existing splits.' },
          { status: 400 }
        )
      }

      const orderTotal = Number(order.total)

      // === TRANSACTION: create all split children + update parent atomically ===
      const { splitOrders } = await db.$transaction(async (tx) => {
        return createEvenSplit(tx, splitOrder, numWays)
      }, { timeout: 15000 })

      // Dispatch socket events for new split orders (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: order.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

      // Dispatch order:split-created so all devices instantly render the split
      const terminalId = request.headers.get('x-terminal-id')
      void dispatchSplitCreated(order.locationId, {
        parentOrderId: order.id,
        parentStatus: 'split',
        splits: splitOrders.map(s => ({
          id: s.id,
          orderNumber: s.orderNumber,
          splitIndex: s.splitIndex!,
          displayNumber: s.displayNumber || `${order.orderNumber}-${s.splitIndex}`,
          total: Number(s.total),
          itemCount: 0, // Even split doesn't copy items
          isPaid: false,
        })),
        sourceTerminalId: terminalId || undefined,
      }).catch(() => {})

      // Emit order events for each new split order (fire-and-forget)
      for (const s of splitOrders) {
        void emitOrderEvent(order.locationId, s.id, 'ORDER_CREATED', {
          locationId: order.locationId,
          employeeId: order.employeeId,
          orderType: order.orderType,
          tableId: order.tableId,
          guestCount: 1,
          orderNumber: s.orderNumber,
          displayNumber: s.displayNumber,
        })
      }

      console.log(`[AUDIT] ORDER_SPLIT: parentId=${id}, type=even, children=${splitOrders.length}, by employee ${body.employeeId}`)

      return NextResponse.json({ data: {
        type: 'even',
        parentOrder: {
          id: order.id,
          orderNumber: order.orderNumber,
          total: orderTotal,
        },
        splits: splitOrders.map(s => ({
          id: s.id,
          orderNumber: s.orderNumber,
          splitIndex: s.splitIndex,
          displayNumber: `${order.orderNumber}-${s.splitIndex}`,
          total: Number(s.total),
          paidAmount: 0,
          isPaid: false,
        })),
        numWays,
        message: `Order #${order.orderNumber} split into ${numWays} checks`,
      } })
    }

    if (body.type === 'by_item') {
      const itemIds = body.itemIds || []
      if (itemIds.length === 0) {
        return NextResponse.json(
          { error: 'No items selected' },
          { status: 400 }
        )
      }

      // Validate items belong to this order
      const itemsToMove = order.items.filter(item => itemIds.includes(item.id))
      if (itemsToMove.length !== itemIds.length) {
        return NextResponse.json(
          { error: 'Some items do not belong to this order' },
          { status: 400 }
        )
      }

      // Check that we're not moving all items
      if (itemsToMove.length === order.items.length) {
        return NextResponse.json(
          { error: 'Cannot move all items - at least one must remain' },
          { status: 400 }
        )
      }

      // === TRANSACTION: create child order + soft-delete items from parent + recalc parent atomically ===
      const { newOrder, remainingSubtotal, remainingTax, remainingTotal, remainingItems, baseOrderNumber, nextSplitIndex } = await db.$transaction(async (tx) => {
        return createItemSplit(tx, splitOrder, itemIds, taxRate, inclusiveTaxRate)
      }, { timeout: 15000 })

      // Dispatch socket events for split (fire-and-forget)
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId: newOrder.id,
        tableId: order.tableId || undefined,
      }, { async: true }).catch(() => {})

      // Dispatch order:split-created so all devices instantly render the split
      void dispatchSplitCreated(order.locationId, {
        parentOrderId: order.parentOrderId || order.id,
        parentStatus: 'split',
        splits: [{
          id: newOrder.id,
          orderNumber: newOrder.orderNumber,
          splitIndex: newOrder.splitIndex!,
          displayNumber: `${baseOrderNumber}-${nextSplitIndex}`,
          total: Number(newOrder.total),
          itemCount: newOrder.items.length,
          isPaid: false,
        }],
        sourceTerminalId: request.headers.get('x-terminal-id') || undefined,
      }).catch(() => {})

      // Emit order events for new split order (fire-and-forget)
      void emitOrderEvents(order.locationId, newOrder.id, [
        {
          type: 'ORDER_CREATED',
          payload: {
            locationId: order.locationId,
            employeeId: order.employeeId,
            orderType: order.orderType,
            tableId: order.tableId,
            guestCount: 1,
            orderNumber: newOrder.orderNumber,
            displayNumber: newOrder.displayNumber,
          },
        },
        ...newOrder.items.map(item => ({
          type: 'ITEM_ADDED' as const,
          payload: {
            lineItemId: item.id,
            menuItemId: item.menuItemId,
            name: item.name,
            priceCents: Math.round(Number(item.price) * 100),
            quantity: item.quantity,
            isHeld: false,
            soldByWeight: false,
            seatNumber: item.seatNumber,
            specialNotes: item.specialNotes,
            isTaxInclusive: item.isTaxInclusive ?? false,
          },
        })),
      ])

      // Emit ITEM_REMOVED on parent for each moved item (fire-and-forget)
      for (const itemId of itemIds) {
        void emitOrderEvent(order.locationId, order.id, 'ITEM_REMOVED', {
          lineItemId: itemId,
          reason: 'split_by_item',
        })
      }

      console.log(`[AUDIT] ORDER_SPLIT: parentId=${id}, type=by_item, children=1, by employee ${body.employeeId}`)

      return NextResponse.json({ data: {
        type: 'by_item',
        originalOrder: {
          id: order.id,
          orderNumber: order.orderNumber,
          displayNumber: order.displayNumber || String(order.orderNumber),
          newSubtotal: remainingSubtotal,
          newTax: remainingTax,
          newTotal: remainingTotal,
          itemCount: remainingItems.length,
        },
        newOrder: {
          id: newOrder.id,
          orderNumber: newOrder.orderNumber,
          splitIndex: newOrder.splitIndex,
          displayNumber: `${baseOrderNumber}-${nextSplitIndex}`,
          subtotal: Number(order.subtotal) - remainingSubtotal + Number(order.discountTotal),
          taxTotal: Number(newOrder.taxTotal),
          total: Number(newOrder.total),
          itemCount: newOrder.items.length,
          items: newOrder.items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
          })),
        },
      } })
    }

    if (body.type === 'by_seat') {
      // Group items by seat number for validation
      const itemsBySeat = new Map<number | null, typeof order.items>()
      for (const item of order.items) {
        const seat = item.seatNumber
        if (!itemsBySeat.has(seat)) {
          itemsBySeat.set(seat, [])
        }
        itemsBySeat.get(seat)!.push(item)
      }

      const seatsWithItems = Array.from(itemsBySeat.keys()).filter(s => s !== null)
      if (seatsWithItems.length < 2) {
        return NextResponse.json(
          { error: 'Need at least 2 seats with items to split by seat' },
          { status: 400 }
        )
      }

      if (isAlreadySplit) {
        return NextResponse.json(
          { error: 'Order is already split. Navigate between existing splits.' },
          { status: 400 }
        )
      }

      const sortedSeats = (seatsWithItems as number[]).sort((a, b) => a - b)

      // === TRANSACTION: create all seat children + soft-delete items + update parent atomically ===
      const { splitOrders, itemIdsToRemove, remainingItems, remainingTotal } = await db.$transaction(async (tx) => {
        return createSeatSplit(tx, splitOrder, taxRate, inclusiveTaxRate)
      }, { timeout: 20000 })

      // Dispatch socket events for seat splits (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: order.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

      // Dispatch order:split-created so all devices instantly render the split
      void dispatchSplitCreated(order.locationId, {
        parentOrderId: order.id,
        parentStatus: 'split',
        splits: splitOrders.map(s => ({
          id: s.id,
          orderNumber: s.orderNumber,
          splitIndex: s.splitIndex!,
          displayNumber: s.displayNumber,
          total: s.total,
          itemCount: s.itemCount,
          isPaid: false,
        })),
        sourceTerminalId: request.headers.get('x-terminal-id') || undefined,
      }).catch(() => {})

      // Emit order events for each seat split order (fire-and-forget)
      for (const seatNumber of sortedSeats) {
        const seatItems = itemsBySeat.get(seatNumber) || []
        const matchingSplit = splitOrders.find(s => s.seatNumber === seatNumber)
        if (!matchingSplit || seatItems.length === 0) continue

        void emitOrderEvents(order.locationId, matchingSplit.id, [
          {
            type: 'ORDER_CREATED',
            payload: {
              locationId: order.locationId,
              employeeId: order.employeeId,
              orderType: order.orderType,
              tableId: order.tableId,
              guestCount: 1,
              orderNumber: matchingSplit.orderNumber,
              displayNumber: matchingSplit.displayNumber,
            },
          },
          ...seatItems.map(item => ({
            type: 'ITEM_ADDED' as const,
            payload: {
              lineItemId: item.id,
              menuItemId: item.menuItemId,
              name: item.name,
              priceCents: Math.round(Number(item.price) * 100),
              quantity: item.quantity,
              isHeld: false,
              soldByWeight: false,
              seatNumber: item.seatNumber,
              specialNotes: item.specialNotes,
              isTaxInclusive: item.isTaxInclusive ?? false,
            },
          })),
        ])
      }

      // Emit ITEM_REMOVED on parent for each moved item (fire-and-forget)
      for (const itemId of itemIdsToRemove) {
        void emitOrderEvent(order.locationId, order.id, 'ITEM_REMOVED', {
          lineItemId: itemId,
          reason: 'split_by_seat',
        })
      }

      console.log(`[AUDIT] ORDER_SPLIT: parentId=${id}, type=by_seat, children=${splitOrders.length}, by employee ${body.employeeId}`)

      return NextResponse.json({ data: {
        type: 'by_seat',
        parentOrder: {
          id: order.id,
          orderNumber: order.orderNumber,
          total: remainingTotal,
          itemCount: remainingItems.length,
          hasUnassignedItems: remainingItems.length > 0,
        },
        splits: splitOrders,
        seatCount: sortedSeats.length,
        message: `Order #${order.orderNumber} split into ${sortedSeats.length} checks by seat`,
      } })
    }

    if (body.type === 'by_table') {
      // Group items by sourceTableId for validation
      const itemsByTable = new Map<string | null, typeof order.items>()
      for (const item of order.items) {
        const tableId = item.sourceTableId
        if (!itemsByTable.has(tableId)) {
          itemsByTable.set(tableId, [])
        }
        itemsByTable.get(tableId)!.push(item)
      }

      const tablesWithItems = Array.from(itemsByTable.keys()).filter(t => t !== null) as string[]
      if (tablesWithItems.length < 2) {
        return NextResponse.json(
          { error: 'Need at least 2 tables with items to split by table' },
          { status: 400 }
        )
      }

      if (isAlreadySplit) {
        return NextResponse.json(
          { error: 'Order is already split. Navigate between existing splits.' },
          { status: 400 }
        )
      }

      // Get table names for better labeling (read-only query, safe outside transaction)
      const tableRecords = await db.table.findMany({
        where: { id: { in: tablesWithItems } },
        select: { id: true, name: true, abbreviation: true },
      })
      const tableNameMap = new Map(tableRecords.map(t => [t.id, t.abbreviation || t.name]))

      // === TRANSACTION: create all table children + soft-delete items + update parent atomically ===
      const { splitOrders, itemIdsToRemove, remainingItems, remainingTotal } = await db.$transaction(async (tx) => {
        return createTableSplit(tx, splitOrder, taxRate, tablesWithItems, tableNameMap, inclusiveTaxRate)
      }, { timeout: 20000 })

      // Dispatch socket events for table splits (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: s.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

      // Dispatch order:split-created so all devices instantly render the split
      void dispatchSplitCreated(order.locationId, {
        parentOrderId: order.id,
        parentStatus: 'split',
        splits: splitOrders.map(s => ({
          id: s.id,
          orderNumber: s.orderNumber,
          splitIndex: s.splitIndex!,
          displayNumber: s.displayNumber,
          total: s.total,
          itemCount: s.itemCount,
          isPaid: false,
        })),
        sourceTerminalId: request.headers.get('x-terminal-id') || undefined,
      }).catch(() => {})

      // Emit order events for each table split order (fire-and-forget)
      for (const tableId of tablesWithItems) {
        const tableItems = itemsByTable.get(tableId) || []
        const matchingSplit = splitOrders.find(s => s.tableId === tableId)
        if (!matchingSplit || tableItems.length === 0) continue

        void emitOrderEvents(order.locationId, matchingSplit.id, [
          {
            type: 'ORDER_CREATED',
            payload: {
              locationId: order.locationId,
              employeeId: order.employeeId,
              orderType: order.orderType,
              tableId: tableId,
              guestCount: 1,
              orderNumber: matchingSplit.orderNumber,
              displayNumber: matchingSplit.displayNumber,
            },
          },
          ...tableItems.map(item => ({
            type: 'ITEM_ADDED' as const,
            payload: {
              lineItemId: item.id,
              menuItemId: item.menuItemId,
              name: item.name,
              priceCents: Math.round(Number(item.price) * 100),
              quantity: item.quantity,
              isHeld: false,
              soldByWeight: false,
              seatNumber: item.seatNumber,
              specialNotes: item.specialNotes,
              isTaxInclusive: item.isTaxInclusive ?? false,
            },
          })),
        ])
      }

      // Emit ITEM_REMOVED on parent for each moved item (fire-and-forget)
      for (const itemId of itemIdsToRemove) {
        void emitOrderEvent(order.locationId, order.id, 'ITEM_REMOVED', {
          lineItemId: itemId,
          reason: 'split_by_table',
        })
      }

      console.log(`[AUDIT] ORDER_SPLIT: parentId=${id}, type=by_table, children=${splitOrders.length}, by employee ${body.employeeId}`)

      return NextResponse.json({ data: {
        type: 'by_table',
        parentOrder: {
          id: order.id,
          orderNumber: order.orderNumber,
          total: remainingTotal,
          itemCount: remainingItems.length,
          hasUnassignedItems: remainingItems.length > 0,
        },
        splits: splitOrders,
        tableCount: tablesWithItems.length,
        message: `Order #${order.orderNumber} split into ${tablesWithItems.length} checks by table`,
      } })
    }

    if (body.type === 'custom_amount') {
      const amount = body.amount || 0
      if (amount <= 0) {
        return NextResponse.json(
          { error: 'Amount must be greater than 0' },
          { status: 400 }
        )
      }

      const remaining = Number(order.total) - paidAmount
      if (amount > remaining + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds remaining balance of $${remaining.toFixed(2)}` },
          { status: 400 }
        )
      }

      const result = calculateCustomSplit(splitOrder, amount, paidAmount)
      return NextResponse.json({ data: { type: 'custom_amount', ...result } })
    }

    return NextResponse.json(
      { error: 'Invalid split type' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Failed to split order:', error)
    return NextResponse.json(
      { error: 'Failed to split order' },
      { status: 500 }
    )
  }
})

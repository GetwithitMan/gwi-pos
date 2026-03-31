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
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'

const log = createChildLogger('orders.id.split')

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

    // Lock the order row inside a short transaction to prevent status changes
    // between the read and the split operation (race condition fix).
    const lockResult = await db.$transaction(async (tx) => {
      const [lockedRow] = await tx.$queryRaw<any[]>`SELECT id, status FROM "Order" WHERE id = ${id} FOR UPDATE`
      if (!lockedRow) return { error: 'Order not found' as const, status: 404 as const }
      if (!SPLITTABLE_STATUSES.includes(lockedRow.status)) {
        return { error: `Cannot split order in '${lockedRow.status}' status` as const, status: 400 as const }
      }
      return { ok: true as const }
    })

    if ('error' in lockResult) {
      return err(lockResult.error!, lockResult.status)
    }

    // Get the original order with all details (row was validated above)
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
            pizzaData: true,
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
      return notFound('Order not found')
    }

    // Auth check — require pos.split_checks permission (skip for read-only get_splits)
    if (body.type !== 'get_splits') {
      const auth = await requirePermission(body.employeeId, order.locationId, PERMISSIONS.POS_SPLIT_CHECKS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Block splitting orders with active pre-auth holds
    if (body.type !== 'get_splits') {
      const activeCards = order.cards?.filter((c: any) => c.status === 'authorized') || []
      if (activeCards.length > 0) {
        return err('Cannot split order with active pre-authorization. Close the tab or void the pre-auth first.')
      }

      // Block splitting orders with partial payments (including gift cards)
      const completedPayments = order.payments?.filter((p: any) => p.status === 'completed') || []
      if (completedPayments.length > 0) {
        return err('Cannot split order with existing payments. Void payments first or pay remaining balance.')
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
      return ok({ type: 'get_splits', ...result })
    }

    if (order.status === 'paid' || order.status === 'closed') {
      return err('Cannot split a closed order')
    }

    // Calculate what's already been paid on this order
    const paidAmount = order.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0)

    if (body.type === 'even') {
      const numWays = body.numWays || 2
      if (numWays < 2 || numWays > 10) {
        return err('Must split between 2 and 10 ways')
      }

      if (isAlreadySplit) {
        return err('Order is already split. Navigate between existing splits.')
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
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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

      pushUpstream()

      return ok({
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
          // Split family fields (Phase 1+2: Unified Split Checks)
          splitClass: (s as any).splitClass ?? 'allocation',
          splitMode: (s as any).splitMode ?? 'even',
          splitFamilyRootId: (s as any).splitFamilyRootId ?? order.id,
        })),
        numWays,
        message: `Order #${order.orderNumber} split into ${numWays} checks`,
      })
    }

    if (body.type === 'by_item') {
      const itemIds = body.itemIds || []
      if (itemIds.length === 0) {
        return err('No items selected')
      }

      // Guard: cannot split an already-split order (same guard as even/seat/table splits)
      if (isAlreadySplit) {
        return err('Cannot split an already-split order')
      }

      // Validate items belong to this order
      const itemsToMove = order.items.filter(item => itemIds.includes(item.id))
      if (itemsToMove.length !== itemIds.length) {
        return err('Some items do not belong to this order')
      }

      // Check that we're not moving all items
      if (itemsToMove.length === order.items.length) {
        return err('Cannot move all items - at least one must remain')
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
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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

      pushUpstream()

      return ok({
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
          // Split family fields (Phase 1+2: Unified Split Checks)
          splitClass: (newOrder as any).splitClass ?? null,
          splitMode: (newOrder as any).splitMode ?? null,
          splitFamilyRootId: (newOrder as any).splitFamilyRootId ?? null,
          items: newOrder.items.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: Number(item.price),
          })),
        },
      })
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
        return err('Need at least 2 seats with items to split by seat')
      }

      if (isAlreadySplit) {
        return err('Order is already split. Navigate between existing splits.')
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
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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

      pushUpstream()

      return ok({
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
      })
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
        return err('Need at least 2 tables with items to split by table')
      }

      if (isAlreadySplit) {
        return err('Order is already split. Navigate between existing splits.')
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
        }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.id.split'))
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

      pushUpstream()

      return ok({
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
      })
    }

    if (body.type === 'custom_amount') {
      const amount = body.amount || 0
      if (amount <= 0) {
        return err('Amount must be greater than 0')
      }

      const remaining = Number(order.total) - paidAmount
      if (amount > remaining + 0.01) {
        return err(`Amount exceeds remaining balance of $${remaining.toFixed(2)}`)
      }

      const result = calculateCustomSplit(splitOrder, amount, paidAmount)
      return ok({ type: 'custom_amount', ...result })
    }

    return err('Invalid split type')
  } catch (error) {
    console.error('Failed to split order:', error)
    return err('Failed to split order', 500)
  }
})

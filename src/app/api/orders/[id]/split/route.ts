import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemStatus } from '@prisma/client'
import { getLocationTaxRate, calculateTax } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged, dispatchSplitCreated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { checkOrderClaim } from '@/lib/order-claim'
import { roundToCents } from '@/lib/pricing'

interface SplitRequest {
  type: 'even' | 'by_item' | 'by_seat' | 'by_table' | 'custom_amount' | 'get_splits'
  employeeId?: string
  // For even split
  numWays?: number
  // For by_item split
  itemIds?: string[]
  // For custom_amount split
  amount?: number
}

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

    // Status guard: only splittable statuses allowed
    const SPLITTABLE_STATUSES = ['open', 'in_progress', 'sent'];
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
    const parentOrder = order.parentOrder || order
    const isAlreadySplit = order.parentOrderId !== null || order.splitOrders.length > 0

    // Get tax rate from location settings
    const taxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })

    // Handle get_splits - return all split orders for navigation
    // Reuse data from the initial fetch (includes splitOrders.items, parentOrder.splitOrders.items)
    if (body.type === 'get_splits') {
      let allSplits
      if (order.parentOrderId && order.parentOrder) {
        // This is a child - use already-fetched parent and its splitOrders
        const parent = order.parentOrder as typeof order.parentOrder & {
          splitOrders: (typeof order.splitOrders[number])[]
          payments: (typeof order.payments[number])[]
          items: (typeof order.items[number])[]
        }
        allSplits = [parent, ...parent.splitOrders]
      } else if (order.splitOrders.length > 0) {
        // This is a parent with children - already have splitOrders with items from initial fetch
        allSplits = [order, ...order.splitOrders]
      } else {
        allSplits = [order]
      }

      return NextResponse.json({ data: {
        type: 'get_splits',
        splits: allSplits.map((s) => {
          const splitOrder = s as typeof s & {
            items?: unknown[]
            splitOrders?: unknown[]
          }
          return {
            id: splitOrder.id,
            orderNumber: splitOrder.orderNumber,
            splitIndex: splitOrder.splitIndex,
            displayNumber: splitOrder.splitIndex
              ? `${parentOrder.orderNumber}-${splitOrder.splitIndex}`
              : String(splitOrder.orderNumber),
            total: Number(splitOrder.total),
            paidAmount: splitOrder.payments.reduce((sum, p) => sum + Number(p.totalAmount), 0),
            isPaid: splitOrder.status === 'paid',
            itemCount: splitOrder.items?.length || 0,
            isParent: !splitOrder.parentOrderId && (splitOrder.splitOrders?.length || 0) > 0,
          }
        }),
        currentSplitId: order.id,
      } })
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
      // Split the order evenly N ways - create N new orders
      const numWays = body.numWays || 2
      if (numWays < 2 || numWays > 10) {
        return NextResponse.json(
          { error: 'Must split between 2 and 10 ways' },
          { status: 400 }
        )
      }

      // Don't re-split an already split order
      if (isAlreadySplit) {
        return NextResponse.json(
          { error: 'Order is already split. Navigate between existing splits.' },
          { status: 400 }
        )
      }

      const orderTotal = Number(order.total)
      const perSplit = Math.floor((orderTotal / numWays) * 100) / 100

      // === TRANSACTION: create all split children + update parent atomically ===
      const splitOrders = await db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

        // Get current max split index for this parent
        const existingSplits = await tx.order.count({
          where: { parentOrderId: order.id },
        })

        // Create split orders in parallel — each is independent (same parent, unique splitIndex)
        const createdSplits = await Promise.all(
          Array.from({ length: numWays }, (_, i) => {
            const splitIndex = existingSplits + i + 1

            // Split subtotal, tax, and discount proportionally from parent (handles tax-inclusive items correctly)
            const splitSubtotal = i === numWays - 1
              ? Math.round((Number(order.subtotal) - Math.floor((Number(order.subtotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
              : Math.floor((Number(order.subtotal) / numWays) * 100) / 100
            const splitTax = i === numWays - 1
              ? Math.round((Number(order.taxTotal) - Math.floor((Number(order.taxTotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
              : Math.floor((Number(order.taxTotal) / numWays) * 100) / 100
            const splitDiscount = i === numWays - 1
              ? Math.round((Number(order.discountTotal) - Math.floor((Number(order.discountTotal) / numWays) * 100) / 100 * (numWays - 1)) * 100) / 100
              : Math.floor((Number(order.discountTotal) / numWays) * 100) / 100

            // Last split: compute total FROM its own components to avoid penny drift
            // (independently remaindered subtotal/tax/discount may not sum to independently remaindered total)
            const splitTotal = i === numWays - 1
              ? roundToCents(splitSubtotal + splitTax - splitDiscount)
              : perSplit

            return tx.order.create({
              data: {
                orderNumber: order.orderNumber, // Same base number
                displayNumber: `${order.orderNumber}-${splitIndex}`,
                locationId: order.locationId,
                employeeId: order.employeeId,
                customerId: order.customerId,
                orderType: order.orderType,
                status: 'open',
                tableId: order.tableId,
                tabName: order.tabName,
                guestCount: 1,
                subtotal: splitSubtotal,
                discountTotal: splitDiscount,
                taxTotal: splitTax,
                tipTotal: 0,
                total: splitTotal,
                parentOrderId: order.id,
                splitIndex,
                notes: `Split ${splitIndex} of ${numWays} from order #${order.orderNumber}`,
              },
            })
          })
        )

        // --- Distribute parent OrderDiscount records to children ---
        const parentDiscounts = await tx.orderDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })

        if (parentDiscounts.length > 0) {
          // Track cumulative discount per child (handles multiple discount records)
          const childDiscountAccum = new Map<string, number>()
          for (const child of createdSplits) {
            childDiscountAccum.set(child.id, 0)
          }

          for (const disc of parentDiscounts) {
            const discAmount = Number(disc.amount)
            const isPercent = disc.percent != null && Number(disc.percent) > 0

            for (let i = 0; i < createdSplits.length; i++) {
              const child = createdSplits[i]
              let childDiscAmount: number

              if (isPercent) {
                // Percent-based: clone with same percentage, recalculate amount based on child subtotal
                const childSubtotal = Number(child.subtotal)
                childDiscAmount = Math.round(childSubtotal * (Number(disc.percent) / 100) * 100) / 100
              } else {
                // Fixed amount: divide equally, last child gets remainder
                const perChild = Math.floor((discAmount / numWays) * 100) / 100
                childDiscAmount = i === numWays - 1
                  ? Math.round((discAmount - perChild * (numWays - 1)) * 100) / 100
                  : perChild
              }

              await tx.orderDiscount.create({
                data: {
                  locationId: order.locationId,
                  orderId: child.id,
                  discountRuleId: disc.discountRuleId,
                  couponId: disc.couponId,
                  couponCode: disc.couponCode,
                  name: disc.name,
                  amount: childDiscAmount,
                  percent: isPercent ? disc.percent : null,
                  appliedBy: disc.appliedBy,
                  isAutomatic: disc.isAutomatic,
                  reason: disc.reason,
                },
              })

              childDiscountAccum.set(child.id, (childDiscountAccum.get(child.id) || 0) + childDiscAmount)
            }

            // Soft-delete parent's discount record
            await tx.orderDiscount.update({
              where: { id: disc.id },
              data: { deletedAt: new Date() },
            })
          }

          // Update each child's discountTotal and total with accumulated discount
          for (const child of createdSplits) {
            const totalChildDisc = childDiscountAccum.get(child.id) || 0
            if (totalChildDisc > 0) {
              const childSubtotal = Number(child.subtotal)
              const childTax = Number(child.taxTotal)
              const newChildTotal = Math.round((childSubtotal - totalChildDisc + childTax) * 100) / 100
              await tx.order.update({
                where: { id: child.id },
                data: {
                  discountTotal: totalChildDisc,
                  total: Math.max(0, newChildTotal),
                },
              })
            }
          }

          // Remainder correction: ensure sum of child discounts equals parent discount total
          const parentDiscountTotal = Number(order.discountTotal || 0)
          if (parentDiscountTotal > 0 && createdSplits.length > 0) {
            const childDiscountSum = Array.from(childDiscountAccum.values()).reduce((sum, v) => sum + v, 0)
            const remainder = roundToCents(parentDiscountTotal - childDiscountSum)
            if (Math.abs(remainder) > 0 && Math.abs(remainder) <= 0.05) {
              // Add remainder to last child's discount
              const lastChild = createdSplits[createdSplits.length - 1]
              const lastChildDisc = childDiscountAccum.get(lastChild.id) || 0
              const correctedDisc = roundToCents(lastChildDisc + remainder)
              const lastChildSubtotal = Number(lastChild.subtotal)
              const lastChildTax = Number(lastChild.taxTotal)
              const correctedTotal = Math.round((lastChildSubtotal - correctedDisc + lastChildTax) * 100) / 100
              await tx.order.update({
                where: { id: lastChild.id },
                data: {
                  discountTotal: correctedDisc,
                  total: Math.max(0, correctedTotal),
                },
              })
            }
          }
        }

        // Mark parent order as 'split' so children become payable
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'split',
            discountTotal: 0,
            notes: order.notes
              ? `${order.notes}\n[Split ${numWays} ways]`
              : `[Split ${numWays} ways]`,
            version: { increment: 1 },
          },
        })

        return createdSplits
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
      // Move specific items to a new split order
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

      // Calculate totals for items being moved
      let newSubtotal = 0
      const newItems = itemsToMove.map(item => {
        const itemTotal = Number(item.price) * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
        newSubtotal += itemTotal + modifiersTotal

        return {
          locationId: order.locationId,
          menuItemId: item.menuItemId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          itemTotal: item.itemTotal,
          specialNotes: item.specialNotes,
          seatNumber: item.seatNumber,
          blockTimeMinutes: item.blockTimeMinutes,
          blockTimeStartedAt: item.blockTimeStartedAt,
          blockTimeExpiresAt: item.blockTimeExpiresAt,
          modifiers: {
            create: item.modifiers.map(mod => ({
              locationId: order.locationId,
              modifierId: mod.modifierId,
              name: mod.name,
              price: mod.price,
              quantity: mod.quantity,
              preModifier: mod.preModifier,
              // Spirit selection fields (Liquor Builder)
              spiritTier: mod.spiritTier,
              linkedBottleProductId: mod.linkedBottleProductId,
            })),
          },
        }
      })

      const newTax = calculateTax(newSubtotal, taxRate)
      const newTotal = Math.round((newSubtotal + newTax) * 100) / 100

      // === TRANSACTION: create child order + soft-delete items from parent + recalc parent atomically ===
      const { newOrder, remainingSubtotal, remainingTax, remainingTotal, remainingItems, baseOrderNumber, nextSplitIndex } = await db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

        // Verify items still belong to this order (guard against concurrent split)
        const freshItems = await tx.orderItem.findMany({
          where: { id: { in: itemIds }, orderId: order.id, deletedAt: null },
          select: { id: true },
        })
        const freshItemIds = new Set(freshItems.map(i => i.id))
        const validItemIds = itemIds.filter((iid: string) => freshItemIds.has(iid))
        if (validItemIds.length === 0) {
          throw new Error('All selected items were already moved by a concurrent split')
        }
        const validItemsToMove = itemsToMove.filter(item => freshItemIds.has(item.id))

        // Get the next split index
        const maxSplit = await tx.order.aggregate({
          where: { parentOrderId: order.parentOrderId || order.id },
          _max: { splitIndex: true },
        })
        const _nextSplitIndex = (maxSplit._max.splitIndex || 0) + 1
        const _baseOrderNumber = order.parentOrderId
          ? (await tx.order.findUnique({ where: { id: order.parentOrderId }, select: { orderNumber: true } }))?.orderNumber || order.orderNumber
          : order.orderNumber

        // Create new split order with the selected items
        const _newOrder = await tx.order.create({
          data: {
            orderNumber: _baseOrderNumber,
            displayNumber: `${_baseOrderNumber}-${_nextSplitIndex}`,
            locationId: order.locationId,
            employeeId: order.employeeId,
            customerId: order.customerId,
            orderType: order.orderType,
            status: 'open',
            tableId: order.tableId,
            tabName: order.tabName,
            guestCount: 1,
            subtotal: newSubtotal,
            discountTotal: 0,
            taxTotal: newTax,
            tipTotal: 0,
            total: newTotal,
            itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
            parentOrderId: order.parentOrderId || order.id,
            splitIndex: _nextSplitIndex,
            notes: `Split from order #${order.orderNumber}`,
            items: {
              create: newItems,
            },
          },
          include: {
            items: {
              include: {
                modifiers: true,
              },
            },
          },
        })

        // Update MenuItem.currentOrderId for timed_rental items moved to split child
        const movedEntertainmentItems = validItemsToMove.filter(
          (item: any) => item.menuItem?.itemType === 'timed_rental'
        )
        for (const item of movedEntertainmentItems) {
          if (item.menuItemId) {
            await tx.menuItem.update({
              where: { id: item.menuItemId },
              data: {
                currentOrderId: _newOrder.id,
                currentOrderItemId: null, // Will be set by the new OrderItem
              },
            })
            await tx.floorPlanElement.updateMany({
              where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
              data: { currentOrderId: _newOrder.id },
            })
          }
        }

        // Remove items from original order
        await tx.orderItemModifier.updateMany({
          where: {
            orderItem: {
              id: { in: validItemIds },
            },
          },
          data: { deletedAt: new Date() },
        })
        await tx.orderItem.updateMany({
          where: {
            id: { in: validItemIds },
          },
          data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
        })

        // --- Move item-level discounts to the new child order ---
        // Build a map from old item ID → new item ID in the child order
        const oldToNewItemMap = new Map<string, string>()
        for (let i = 0; i < validItemsToMove.length; i++) {
          const oldItem = validItemsToMove[i]
          // _newOrder.items are in the same order as newItems (which mirrors validItemsToMove)
          const newItem = _newOrder.items[i]
          if (newItem) oldToNewItemMap.set(oldItem.id, newItem.id)
        }

        // Find all item-level discounts on the moved items
        let childItemDiscountTotal = 0
        for (const movedItem of validItemsToMove) {
          const discounts = (movedItem as any).itemDiscounts || []
          for (const disc of discounts) {
            if (disc.deletedAt) continue
            const newItemId = oldToNewItemMap.get(movedItem.id)
            if (!newItemId) continue

            // Create a copy on the child order
            await tx.orderItemDiscount.create({
              data: {
                locationId: order.locationId,
                orderId: _newOrder.id,
                orderItemId: newItemId,
                discountRuleId: disc.discountRuleId,
                amount: disc.amount,
                percent: disc.percent,
                appliedById: disc.appliedById,
                reason: disc.reason,
              },
            })
            childItemDiscountTotal += Number(disc.amount)

            // Soft-delete the original
            await tx.orderItemDiscount.update({
              where: { id: disc.id },
              data: { deletedAt: new Date() },
            })
          }
        }

        // Also proportionally distribute order-level discounts for by_item split
        const parentDiscounts = await tx.orderDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })

        let childOrderDiscountTotal = 0
        const _remainingItems = order.items.filter(item => !validItemIds.includes(item.id))
        let _remainingSubtotal = 0
        _remainingItems.forEach(item => {
          const itemTotal = Number(item.price) * item.quantity
          const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
          _remainingSubtotal += itemTotal + modifiersTotal
        })
        const parentSubtotal = Number(order.subtotal)

        if (parentDiscounts.length > 0 && parentSubtotal > 0) {
          const childRatio = newSubtotal / parentSubtotal
          const parentRatio = _remainingSubtotal / parentSubtotal

          for (const disc of parentDiscounts) {
            const discAmount = Number(disc.amount)
            const isPercent = disc.percent != null && Number(disc.percent) > 0

            let childDiscAmount: number
            let parentDiscAmount: number

            if (isPercent) {
              // Percent-based: same percent, recalculate amounts based on new subtotals
              childDiscAmount = Math.round(newSubtotal * (Number(disc.percent) / 100) * 100) / 100
              parentDiscAmount = Math.round(_remainingSubtotal * (Number(disc.percent) / 100) * 100) / 100
            } else {
              // Fixed amount: split proportionally by subtotal ratio
              childDiscAmount = Math.round(discAmount * childRatio * 100) / 100
              parentDiscAmount = Math.round((discAmount - childDiscAmount) * 100) / 100
            }

            // Create discount on child
            await tx.orderDiscount.create({
              data: {
                locationId: order.locationId,
                orderId: _newOrder.id,
                discountRuleId: disc.discountRuleId,
                couponId: disc.couponId,
                couponCode: disc.couponCode,
                name: disc.name,
                amount: childDiscAmount,
                percent: isPercent ? disc.percent : null,
                appliedBy: disc.appliedBy,
                isAutomatic: disc.isAutomatic,
                reason: disc.reason,
              },
            })
            childOrderDiscountTotal += childDiscAmount

            // Update parent discount amount to reduced value
            await tx.orderDiscount.update({
              where: { id: disc.id },
              data: { amount: parentDiscAmount },
            })
          }
        }

        // Update child order with discount totals
        const totalChildDiscount = childItemDiscountTotal + childOrderDiscountTotal
        if (totalChildDiscount > 0) {
          const childTax = Number(_newOrder.taxTotal)
          const childTotal = Math.round((newSubtotal - totalChildDiscount + childTax) * 100) / 100
          await tx.order.update({
            where: { id: _newOrder.id },
            data: {
              discountTotal: totalChildDiscount,
              total: Math.max(0, childTotal),
            },
          })
        }

        // Recalculate remaining parent item discount total
        const remainingItemDiscounts = await tx.orderItemDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })
        const remainingItemDiscountTotal = remainingItemDiscounts.reduce(
          (sum, d) => sum + Number(d.amount), 0
        )
        const remainingOrderDiscounts = await tx.orderDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })
        const remainingOrderDiscountTotal = remainingOrderDiscounts.reduce(
          (sum, d) => sum + Number(d.amount), 0
        )
        const totalParentDiscount = remainingItemDiscountTotal + remainingOrderDiscountTotal

        const _remainingTax = calculateTax(_remainingSubtotal, taxRate)
        const _remainingTotal = Math.round((_remainingSubtotal - totalParentDiscount + _remainingTax) * 100) / 100

        // Update original order totals and mark as 'split' so children become payable
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'split',
            subtotal: _remainingSubtotal,
            discountTotal: totalParentDiscount,
            taxTotal: _remainingTax,
            total: Math.max(0, _remainingTotal),
            itemCount: _remainingItems.reduce((sum, i) => sum + i.quantity, 0),
            version: { increment: 1 },
          },
        })

        return {
          newOrder: _newOrder,
          remainingSubtotal: _remainingSubtotal,
          remainingTax: _remainingTax,
          remainingTotal: _remainingTotal,
          remainingItems: _remainingItems,
          baseOrderNumber: _baseOrderNumber,
          nextSplitIndex: _nextSplitIndex,
        }
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
          subtotal: newSubtotal,
          taxTotal: newTax,
          total: newTotal,
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
      // Split by seat - each seat gets its own check
      // Group items by seat number
      const itemsBySeat = new Map<number | null, typeof order.items>()

      for (const item of order.items) {
        const seat = item.seatNumber
        if (!itemsBySeat.has(seat)) {
          itemsBySeat.set(seat, [])
        }
        itemsBySeat.get(seat)!.push(item)
      }

      // Check if there are items with seat assignments
      const seatsWithItems = Array.from(itemsBySeat.keys()).filter(s => s !== null)
      if (seatsWithItems.length < 2) {
        return NextResponse.json(
          { error: 'Need at least 2 seats with items to split by seat' },
          { status: 400 }
        )
      }

      // Don't re-split an already split order
      if (isAlreadySplit) {
        return NextResponse.json(
          { error: 'Order is already split. Navigate between existing splits.' },
          { status: 400 }
        )
      }

      // Get base order number
      const baseOrderNumber = order.orderNumber

      // Sort seats numerically
      const sortedSeats = seatsWithItems.sort((a, b) => (a ?? 0) - (b ?? 0))

      // === TRANSACTION: create all seat children + soft-delete items + update parent atomically ===
      const { splitOrders, itemIdsToRemove, remainingItems, remainingTotal } = await db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

        // Get current max split index
        const existingSplits = await tx.order.count({
          where: { parentOrderId: order.id },
        })

        // Create a split order for each seat
        const _splitOrders: Array<{
          id: string
          orderNumber: number
          splitIndex: number | null
          displayNumber: string
          seatNumber: number | null
          total: number
          itemCount: number
          paidAmount: number
          isPaid: boolean
        }> = []
        let splitIndex = existingSplits

        for (const seatNumber of sortedSeats) {
          const seatItems = itemsBySeat.get(seatNumber) || []
          if (seatItems.length === 0) continue

          splitIndex++

          // Calculate totals for this seat's items
          let seatSubtotal = 0
          const newItems = seatItems.map(item => {
            const itemTotal = Number(item.price) * item.quantity
            const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
            seatSubtotal += itemTotal + modifiersTotal

            return {
              locationId: order.locationId,
              menuItemId: item.menuItemId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              itemTotal: item.itemTotal,
              specialNotes: item.specialNotes,
              seatNumber: item.seatNumber,
              courseNumber: item.courseNumber,
              blockTimeMinutes: item.blockTimeMinutes,
              blockTimeStartedAt: item.blockTimeStartedAt,
              blockTimeExpiresAt: item.blockTimeExpiresAt,
              modifiers: {
                create: item.modifiers.map(mod => ({
                  locationId: order.locationId,
                  modifierId: mod.modifierId,
                  name: mod.name,
                  price: mod.price,
                  quantity: mod.quantity,
                  preModifier: mod.preModifier,
                  spiritTier: mod.spiritTier,
                  linkedBottleProductId: mod.linkedBottleProductId,
                })),
              },
            }
          })

          const seatTax = calculateTax(seatSubtotal, taxRate)
          const seatTotal = Math.round((seatSubtotal + seatTax) * 100) / 100

          // Create split order for this seat
          const splitOrder = await tx.order.create({
            data: {
              orderNumber: baseOrderNumber,
              displayNumber: `${baseOrderNumber}-${splitIndex}`,
              locationId: order.locationId,
              employeeId: order.employeeId,
              customerId: order.customerId,
              orderType: order.orderType,
              status: 'open',
              tableId: order.tableId,
              tabName: order.tabName,
              guestCount: 1,
              subtotal: seatSubtotal,
              discountTotal: 0,
              taxTotal: seatTax,
              tipTotal: 0,
              total: seatTotal,
              itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
              parentOrderId: order.id,
              splitIndex,
              notes: `Seat ${seatNumber} from order #${baseOrderNumber}`,
              items: {
                create: newItems,
              },
            },
            include: {
              items: {
                include: { modifiers: true },
              },
            },
          })

          _splitOrders.push({
            id: splitOrder.id,
            orderNumber: splitOrder.orderNumber,
            splitIndex: splitOrder.splitIndex,
            displayNumber: `${baseOrderNumber}-${splitIndex}`,
            seatNumber,
            total: Number(splitOrder.total),
            itemCount: splitOrder.items.length,
            paidAmount: 0,
            isPaid: false,
          })

          // Update MenuItem.currentOrderId for timed_rental items moved to split child
          const movedEntertainmentItems = seatItems.filter(
            (item: any) => item.menuItem?.itemType === 'timed_rental'
          )
          for (const item of movedEntertainmentItems) {
            if (item.menuItemId) {
              await tx.menuItem.update({
                where: { id: item.menuItemId },
                data: {
                  currentOrderId: splitOrder.id,
                  currentOrderItemId: null, // Will be set by the new OrderItem
                },
              })
              await tx.floorPlanElement.updateMany({
                where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
                data: { currentOrderId: splitOrder.id },
              })
            }
          }
        }

        // Delete items from original order (they've been copied to split orders)
        const _itemIdsToRemove = seatsWithItems.flatMap(seat =>
          itemsBySeat.get(seat)?.map(item => item.id) || []
        )

        await tx.orderItemModifier.updateMany({
          where: {
            orderItem: { id: { in: _itemIdsToRemove } },
          },
          data: { deletedAt: new Date() },
        })
        await tx.orderItem.updateMany({
          where: { id: { in: _itemIdsToRemove } },
          data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
        })

        // --- Distribute parent OrderDiscount records proportionally to seat children ---
        const parentDiscountsBySeat = await tx.orderDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })

        // Calculate total subtotal across all seat children for proportional distribution
        const totalChildSubtotal = _splitOrders.reduce((sum, s) => {
          // Re-derive subtotal from total and tax: subtotal = total / (1 + taxRate)
          // But we stored seatSubtotal locally during creation. Since _splitOrders doesn't
          // carry subtotal, we derive from seatItems.
          const seatItems = itemsBySeat.get(s.seatNumber) || []
          let sub = 0
          seatItems.forEach(item => {
            sub += Number(item.price) * item.quantity
            sub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
          })
          return sum + sub
        }, 0)

        if (parentDiscountsBySeat.length > 0 && totalChildSubtotal > 0) {
          // Track cumulative discount per child
          const seatChildDiscAccum = new Map<string, number>()
          for (const child of _splitOrders) {
            seatChildDiscAccum.set(child.id, 0)
          }

          for (const disc of parentDiscountsBySeat) {
            const discAmount = Number(disc.amount)
            const isPercent = disc.percent != null && Number(disc.percent) > 0
            let distributed = 0

            for (let si = 0; si < _splitOrders.length; si++) {
              const child = _splitOrders[si]
              const seatItems = itemsBySeat.get(child.seatNumber) || []
              let childSub = 0
              seatItems.forEach(item => {
                childSub += Number(item.price) * item.quantity
                childSub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
              })

              let childDiscAmount: number
              if (isPercent) {
                childDiscAmount = Math.round(childSub * (Number(disc.percent) / 100) * 100) / 100
              } else {
                if (si === _splitOrders.length - 1) {
                  childDiscAmount = Math.round((discAmount - distributed) * 100) / 100
                } else {
                  childDiscAmount = Math.round(discAmount * (childSub / totalChildSubtotal) * 100) / 100
                }
              }
              distributed += childDiscAmount

              await tx.orderDiscount.create({
                data: {
                  locationId: order.locationId,
                  orderId: child.id,
                  discountRuleId: disc.discountRuleId,
                  couponId: disc.couponId,
                  couponCode: disc.couponCode,
                  name: disc.name,
                  amount: childDiscAmount,
                  percent: isPercent ? disc.percent : null,
                  appliedBy: disc.appliedBy,
                  isAutomatic: disc.isAutomatic,
                  reason: disc.reason,
                },
              })

              seatChildDiscAccum.set(child.id, (seatChildDiscAccum.get(child.id) || 0) + childDiscAmount)
            }

            // Soft-delete parent discount
            await tx.orderDiscount.update({
              where: { id: disc.id },
              data: { deletedAt: new Date() },
            })
          }

          // Update each child's discountTotal and total with accumulated discount
          for (const child of _splitOrders) {
            const totalChildDisc = seatChildDiscAccum.get(child.id) || 0
            if (totalChildDisc > 0) {
              const seatItems = itemsBySeat.get(child.seatNumber) || []
              let childSub = 0
              seatItems.forEach(item => {
                childSub += Number(item.price) * item.quantity
                childSub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
              })
              const childTax = calculateTax(childSub, taxRate)
              const newChildTotal = Math.round((childSub - totalChildDisc + childTax) * 100) / 100
              await tx.order.update({
                where: { id: child.id },
                data: {
                  discountTotal: totalChildDisc,
                  total: Math.max(0, newChildTotal),
                },
              })
              child.total = Math.max(0, newChildTotal)
            }
          }
        }

        // Recalculate original order totals (for items without seat assignment)
        const _remainingItems = itemsBySeat.get(null) || []
        let _remainingSubtotal = 0
        _remainingItems.forEach(item => {
          const itemTotal = Number(item.price) * item.quantity
          const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
          _remainingSubtotal += itemTotal + modifiersTotal
        })

        const _remainingTax = calculateTax(_remainingSubtotal, taxRate)
        const _remainingTotal = Math.round((_remainingSubtotal + _remainingTax) * 100) / 100

        // Update original order totals and mark as 'split' so children become payable
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'split',
            subtotal: _remainingSubtotal,
            discountTotal: 0,
            taxTotal: _remainingTax,
            total: _remainingTotal,
            itemCount: _remainingItems.reduce((sum, i) => sum + i.quantity, 0),
            notes: order.notes
              ? `${order.notes}\n[Split by seat: ${sortedSeats.length} seats]`
              : `[Split by seat: ${sortedSeats.length} seats]`,
            version: { increment: 1 },
          },
        })

        return {
          splitOrders: _splitOrders,
          itemIdsToRemove: _itemIdsToRemove,
          remainingItems: _remainingItems,
          remainingTotal: _remainingTotal,
        }
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
      // We need to re-query to get full item data for the events since splitOrders
      // is a mapped summary. The db.order.create calls above already include items.
      // Reconstruct from the seat groupings:
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
              lineItemId: item.id, // Original item ID (new items have new IDs in the split order)
              menuItemId: item.menuItemId,
              name: item.name,
              priceCents: Math.round(Number(item.price) * 100),
              quantity: item.quantity,
              isHeld: false,
              soldByWeight: false,
              seatNumber: item.seatNumber,
              specialNotes: item.specialNotes,
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
        message: `Order #${baseOrderNumber} split into ${sortedSeats.length} checks by seat`,
      } })
    }

    if (body.type === 'by_table') {
      // Split by table - each source table gets its own check
      // Group items by sourceTableId
      const itemsByTable = new Map<string | null, typeof order.items>()

      for (const item of order.items) {
        const tableId = item.sourceTableId
        if (!itemsByTable.has(tableId)) {
          itemsByTable.set(tableId, [])
        }
        itemsByTable.get(tableId)!.push(item)
      }

      // Check if there are items with table assignments
      const tablesWithItems = Array.from(itemsByTable.keys()).filter(t => t !== null) as string[]
      if (tablesWithItems.length < 2) {
        return NextResponse.json(
          { error: 'Need at least 2 tables with items to split by table' },
          { status: 400 }
        )
      }

      // Don't re-split an already split order
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

      // Get base order number
      const baseOrderNumber = order.orderNumber

      // === TRANSACTION: create all table children + soft-delete items + update parent atomically ===
      const { splitOrders, itemIdsToRemove, remainingItems, remainingTotal } = await db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT id FROM "Order" WHERE id = $1 FOR UPDATE', order.id)

        // Get current max split index
        const existingSplits = await tx.order.count({
          where: { parentOrderId: order.id },
        })

        // Create a split order for each table
        const _splitOrders: Array<{
          id: string
          orderNumber: number
          splitIndex: number | null
          displayNumber: string
          tableId: string
          tableName: string
          total: number
          itemCount: number
          paidAmount: number
          isPaid: boolean
        }> = []
        let splitIndex = existingSplits

        for (const tableId of tablesWithItems) {
          const tableItems = itemsByTable.get(tableId) || []
          if (tableItems.length === 0) continue

          splitIndex++
          const tableName = tableNameMap.get(tableId) || `Table ${tableId.slice(0, 4)}`

          // Calculate totals for this table's items
          let tableSubtotal = 0
          const newItems = tableItems.map(item => {
            const itemTotal = Number(item.price) * item.quantity
            const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
            tableSubtotal += itemTotal + modifiersTotal

            return {
              locationId: order.locationId,
              menuItemId: item.menuItemId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              itemTotal: item.itemTotal,
              specialNotes: item.specialNotes,
              seatNumber: item.seatNumber,
              courseNumber: item.courseNumber,
              sourceTableId: item.sourceTableId, // Preserve source table reference
              blockTimeMinutes: item.blockTimeMinutes,
              blockTimeStartedAt: item.blockTimeStartedAt,
              blockTimeExpiresAt: item.blockTimeExpiresAt,
              modifiers: {
                create: item.modifiers.map(mod => ({
                  locationId: order.locationId,
                  modifierId: mod.modifierId,
                  name: mod.name,
                  price: mod.price,
                  quantity: mod.quantity,
                  preModifier: mod.preModifier,
                  spiritTier: mod.spiritTier,
                  linkedBottleProductId: mod.linkedBottleProductId,
                })),
              },
            }
          })

          const tableTax = calculateTax(tableSubtotal, taxRate)
          const tableTotal = Math.round((tableSubtotal + tableTax) * 100) / 100

          // Create split order for this table
          const splitOrder = await tx.order.create({
            data: {
              orderNumber: baseOrderNumber,
              displayNumber: `${baseOrderNumber}-${splitIndex}`,
              locationId: order.locationId,
              employeeId: order.employeeId,
              customerId: order.customerId,
              orderType: order.orderType,
              status: 'open',
              tableId: tableId, // Associate with the source table
              tabName: order.tabName,
              guestCount: 1,
              subtotal: tableSubtotal,
              discountTotal: 0,
              taxTotal: tableTax,
              tipTotal: 0,
              total: tableTotal,
              itemCount: newItems.reduce((sum, i) => sum + i.quantity, 0),
              parentOrderId: order.id,
              splitIndex,
              notes: `${tableName} from order #${baseOrderNumber}`,
              items: {
                create: newItems,
              },
            },
            include: {
              items: {
                include: { modifiers: true },
              },
            },
          })

          _splitOrders.push({
            id: splitOrder.id,
            orderNumber: splitOrder.orderNumber,
            splitIndex: splitOrder.splitIndex,
            displayNumber: `${baseOrderNumber}-${splitIndex}`,
            tableId,
            tableName,
            total: Number(splitOrder.total),
            itemCount: splitOrder.items.length,
            paidAmount: 0,
            isPaid: false,
          })

          // Update MenuItem.currentOrderId for timed_rental items moved to split child
          const movedEntertainmentItems = tableItems.filter(
            (item: any) => item.menuItem?.itemType === 'timed_rental'
          )
          for (const item of movedEntertainmentItems) {
            if (item.menuItemId) {
              await tx.menuItem.update({
                where: { id: item.menuItemId },
                data: {
                  currentOrderId: splitOrder.id,
                  currentOrderItemId: null, // Will be set by the new OrderItem
                },
              })
              await tx.floorPlanElement.updateMany({
                where: { linkedMenuItemId: item.menuItemId, deletedAt: null },
                data: { currentOrderId: splitOrder.id },
              })
            }
          }
        }

        // Delete items from original order (they've been copied to split orders)
        const _itemIdsToRemove = tablesWithItems.flatMap(tableId =>
          itemsByTable.get(tableId)?.map(item => item.id) || []
        )

        await tx.orderItemModifier.updateMany({
          where: {
            orderItem: { id: { in: _itemIdsToRemove } },
          },
          data: { deletedAt: new Date() },
        })
        await tx.orderItem.updateMany({
          where: { id: { in: _itemIdsToRemove } },
          data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
        })

        // --- Distribute parent OrderDiscount records proportionally to table children ---
        const parentDiscountsByTable = await tx.orderDiscount.findMany({
          where: { orderId: order.id, deletedAt: null },
        })

        // Calculate total subtotal across all table children for proportional distribution
        const totalTableChildSubtotal = _splitOrders.reduce((sum, s) => {
          const tblItems = itemsByTable.get(s.tableId) || []
          let sub = 0
          tblItems.forEach(item => {
            sub += Number(item.price) * item.quantity
            sub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
          })
          return sum + sub
        }, 0)

        if (parentDiscountsByTable.length > 0 && totalTableChildSubtotal > 0) {
          // Track cumulative discount per child
          const tableChildDiscAccum = new Map<string, number>()
          for (const child of _splitOrders) {
            tableChildDiscAccum.set(child.id, 0)
          }

          for (const disc of parentDiscountsByTable) {
            const discAmount = Number(disc.amount)
            const isPercent = disc.percent != null && Number(disc.percent) > 0
            let distributed = 0

            for (let si = 0; si < _splitOrders.length; si++) {
              const child = _splitOrders[si]
              const tblItems = itemsByTable.get(child.tableId) || []
              let childSub = 0
              tblItems.forEach(item => {
                childSub += Number(item.price) * item.quantity
                childSub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
              })

              let childDiscAmount: number
              if (isPercent) {
                childDiscAmount = Math.round(childSub * (Number(disc.percent) / 100) * 100) / 100
              } else {
                if (si === _splitOrders.length - 1) {
                  childDiscAmount = Math.round((discAmount - distributed) * 100) / 100
                } else {
                  childDiscAmount = Math.round(discAmount * (childSub / totalTableChildSubtotal) * 100) / 100
                }
              }
              distributed += childDiscAmount

              await tx.orderDiscount.create({
                data: {
                  locationId: order.locationId,
                  orderId: child.id,
                  discountRuleId: disc.discountRuleId,
                  couponId: disc.couponId,
                  couponCode: disc.couponCode,
                  name: disc.name,
                  amount: childDiscAmount,
                  percent: isPercent ? disc.percent : null,
                  appliedBy: disc.appliedBy,
                  isAutomatic: disc.isAutomatic,
                  reason: disc.reason,
                },
              })

              tableChildDiscAccum.set(child.id, (tableChildDiscAccum.get(child.id) || 0) + childDiscAmount)
            }

            // Soft-delete parent discount
            await tx.orderDiscount.update({
              where: { id: disc.id },
              data: { deletedAt: new Date() },
            })
          }

          // Update each child's discountTotal and total with accumulated discount
          for (const child of _splitOrders) {
            const totalChildDisc = tableChildDiscAccum.get(child.id) || 0
            if (totalChildDisc > 0) {
              const tblItems = itemsByTable.get(child.tableId) || []
              let childSub = 0
              tblItems.forEach(item => {
                childSub += Number(item.price) * item.quantity
                childSub += item.modifiers.reduce((ms, m) => ms + Number(m.price), 0) * item.quantity
              })
              const childTax = calculateTax(childSub, taxRate)
              const newChildTotal = Math.round((childSub - totalChildDisc + childTax) * 100) / 100
              await tx.order.update({
                where: { id: child.id },
                data: {
                  discountTotal: totalChildDisc,
                  total: Math.max(0, newChildTotal),
                },
              })
              child.total = Math.max(0, newChildTotal)
            }
          }
        }

        // Recalculate original order totals (for items without table assignment)
        const _remainingItems = itemsByTable.get(null) || []
        let _remainingSubtotal = 0
        _remainingItems.forEach(item => {
          const itemTotal = Number(item.price) * item.quantity
          const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
          _remainingSubtotal += itemTotal + modifiersTotal
        })

        const _remainingTax = calculateTax(_remainingSubtotal, taxRate)
        const _remainingTotal = Math.round((_remainingSubtotal + _remainingTax) * 100) / 100

        // Update original order totals and mark as 'split' so children become payable
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'split',
            subtotal: _remainingSubtotal,
            discountTotal: 0,
            taxTotal: _remainingTax,
            total: _remainingTotal,
            itemCount: _remainingItems.reduce((sum, i) => sum + i.quantity, 0),
            notes: order.notes
              ? `${order.notes}\n[Split by table: ${tablesWithItems.length} tables]`
              : `[Split by table: ${tablesWithItems.length} tables]`,
            version: { increment: 1 },
          },
        })

        return {
          splitOrders: _splitOrders,
          itemIdsToRemove: _itemIdsToRemove,
          remainingItems: _remainingItems,
          remainingTotal: _remainingTotal,
        }
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
        message: `Order #${baseOrderNumber} split into ${tablesWithItems.length} checks by table`,
      } })
    }

    if (body.type === 'custom_amount') {
      // Pay a specific amount toward this order
      const amount = body.amount || 0
      if (amount <= 0) {
        return NextResponse.json(
          { error: 'Amount must be greater than 0' },
          { status: 400 }
        )
      }

      const remaining = Number(order.total) - paidAmount
      if (amount > remaining + 0.01) { // Small tolerance for rounding
        return NextResponse.json(
          { error: `Amount exceeds remaining balance of $${remaining.toFixed(2)}` },
          { status: 400 }
        )
      }

      // Return the split info (actual payment happens in /pay endpoint)
      return NextResponse.json({ data: {
        type: 'custom_amount',
        orderId: order.id,
        orderNumber: order.orderNumber,
        displayNumber: order.displayNumber || String(order.orderNumber),
        originalTotal: Number(order.total),
        paidAmount,
        remainingBalance: remaining,
        splitAmount: Math.min(amount, remaining),
        newRemaining: Math.max(0, remaining - amount),
      } })
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

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderItemStatus } from '@prisma/client'
import { getLocationTaxRate, calculateTax } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

interface SplitRequest {
  type: 'even' | 'by_item' | 'by_seat' | 'by_table' | 'custom_amount' | 'get_splits'
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

    // Get the original order with all details
    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: true,
        location: true,
        items: {
          include: {
            modifiers: true,
          },
        },
        payments: {
          where: { status: 'completed' },
        },
        splitOrders: {
          include: {
            payments: {
              where: { status: 'completed' },
            },
          },
        },
        parentOrder: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // If this is a split order, get the parent
    const parentOrder = order.parentOrder || order
    const isAlreadySplit = order.parentOrderId !== null || order.splitOrders.length > 0

    // Get tax rate from location settings
    const taxRate = getLocationTaxRate(order.location.settings as { tax?: { defaultRate?: number } })

    // Handle get_splits - return all split orders for navigation
    if (body.type === 'get_splits') {
      let allSplits
      if (order.parentOrderId) {
        // This is a child - get parent and siblings
        const parent = await db.order.findUnique({
          where: { id: order.parentOrderId },
          include: {
            splitOrders: {
              include: {
                payments: { where: { status: 'completed' } },
                items: true,
              },
              orderBy: { splitIndex: 'asc' },
            },
            payments: { where: { status: 'completed' } },
            items: true,
          },
        })
        allSplits = parent ? [parent, ...parent.splitOrders] : [order]
      } else if (order.splitOrders.length > 0) {
        // This is a parent with children - need to fetch with items
        const parentWithItems = await db.order.findUnique({
          where: { id: order.id },
          include: {
            splitOrders: {
              include: {
                payments: { where: { status: 'completed' } },
                items: true,
              },
              orderBy: { splitIndex: 'asc' },
            },
            payments: { where: { status: 'completed' } },
            items: true,
          },
        })
        allSplits = parentWithItems ? [parentWithItems, ...parentWithItems.splitOrders] : [order]
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

      // Get current max split index for this parent
      const existingSplits = await db.order.count({
        where: { parentOrderId: order.id },
      })

      // Create split orders
      const splitOrders = []
      for (let i = 0; i < numWays; i++) {
        const splitIndex = existingSplits + i + 1
        // Last split gets any remaining cents
        const splitTotal = i === numWays - 1
          ? Math.round((orderTotal - perSplit * (numWays - 1)) * 100) / 100
          : perSplit

        const splitSubtotal = Math.round((splitTotal / (1 + taxRate)) * 100) / 100
        const splitTax = Math.round((splitTotal - splitSubtotal) * 100) / 100

        const splitOrder = await db.order.create({
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
            discountTotal: 0,
            taxTotal: splitTax,
            tipTotal: 0,
            total: splitTotal,
            parentOrderId: order.id,
            splitIndex,
            notes: `Split ${splitIndex} of ${numWays} from order #${order.orderNumber}`,
          },
        })
        splitOrders.push(splitOrder)
      }

      // Mark parent order status as 'split' (or keep tracking)
      await db.order.update({
        where: { id: order.id },
        data: {
          notes: order.notes
            ? `${order.notes}\n[Split ${numWays} ways]`
            : `[Split ${numWays} ways]`,
          version: { increment: 1 },
        },
      })

      // Dispatch socket events for new split orders (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: order.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

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

      // Get the next split index
      const maxSplit = await db.order.aggregate({
        where: { parentOrderId: order.parentOrderId || order.id },
        _max: { splitIndex: true },
      })
      const nextSplitIndex = (maxSplit._max.splitIndex || 0) + 1
      const baseOrderNumber = order.parentOrderId
        ? (await db.order.findUnique({ where: { id: order.parentOrderId }, select: { orderNumber: true } }))?.orderNumber || order.orderNumber
        : order.orderNumber

      // Create new split order with the selected items
      const newOrder = await db.order.create({
        data: {
          orderNumber: baseOrderNumber,
          displayNumber: `${baseOrderNumber}-${nextSplitIndex}`,
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
          splitIndex: nextSplitIndex,
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

      // Remove items from original order
      await db.orderItemModifier.updateMany({
        where: {
          orderItem: {
            id: { in: itemIds },
          },
        },
        data: { deletedAt: new Date() },
      })
      await db.orderItem.updateMany({
        where: {
          id: { in: itemIds },
        },
        data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
      })

      // Recalculate original order totals
      const remainingItems = order.items.filter(item => !itemIds.includes(item.id))
      let remainingSubtotal = 0
      remainingItems.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
        remainingSubtotal += itemTotal + modifiersTotal
      })

      const remainingTax = calculateTax(remainingSubtotal, taxRate)
      const remainingTotal = Math.round((remainingSubtotal + remainingTax) * 100) / 100

      // Update original order totals
      await db.order.update({
        where: { id: order.id },
        data: {
          subtotal: remainingSubtotal,
          taxTotal: remainingTax,
          total: remainingTotal,
          itemCount: remainingItems.reduce((sum, i) => sum + i.quantity, 0),
          version: { increment: 1 },
        },
      })

      // Dispatch socket events for split (fire-and-forget)
      void dispatchOpenOrdersChanged(order.locationId, {
        trigger: 'created',
        orderId: newOrder.id,
        tableId: order.tableId || undefined,
      }, { async: true }).catch(() => {})

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

      // Get current max split index
      const existingSplits = await db.order.count({
        where: { parentOrderId: order.id },
      })

      // Create a split order for each seat
      const splitOrders = []
      let splitIndex = existingSplits

      // Sort seats numerically
      const sortedSeats = seatsWithItems.sort((a, b) => (a ?? 0) - (b ?? 0))

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
        const splitOrder = await db.order.create({
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

        splitOrders.push({
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
      }

      // Delete items from original order (they've been copied to split orders)
      const itemIdsToRemove = seatsWithItems.flatMap(seat =>
        itemsBySeat.get(seat)?.map(item => item.id) || []
      )

      await db.orderItemModifier.updateMany({
        where: {
          orderItem: { id: { in: itemIdsToRemove } },
        },
        data: { deletedAt: new Date() },
      })
      await db.orderItem.updateMany({
        where: { id: { in: itemIdsToRemove } },
        data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
      })

      // Recalculate original order totals (for items without seat assignment)
      const remainingItems = itemsBySeat.get(null) || []
      let remainingSubtotal = 0
      remainingItems.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
        remainingSubtotal += itemTotal + modifiersTotal
      })

      const remainingTax = calculateTax(remainingSubtotal, taxRate)
      const remainingTotal = Math.round((remainingSubtotal + remainingTax) * 100) / 100

      // Update original order totals
      await db.order.update({
        where: { id: order.id },
        data: {
          subtotal: remainingSubtotal,
          taxTotal: remainingTax,
          total: remainingTotal,
          itemCount: remainingItems.reduce((sum, i) => sum + i.quantity, 0),
          notes: order.notes
            ? `${order.notes}\n[Split by seat: ${sortedSeats.length} seats]`
            : `[Split by seat: ${sortedSeats.length} seats]`,
          version: { increment: 1 },
        },
      })

      // Dispatch socket events for seat splits (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: order.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

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

      // Get table names for better labeling
      const tableRecords = await db.table.findMany({
        where: { id: { in: tablesWithItems } },
        select: { id: true, name: true, abbreviation: true },
      })
      const tableNameMap = new Map(tableRecords.map(t => [t.id, t.abbreviation || t.name]))

      // Get base order number
      const baseOrderNumber = order.orderNumber

      // Get current max split index
      const existingSplits = await db.order.count({
        where: { parentOrderId: order.id },
      })

      // Create a split order for each table
      const splitOrders = []
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
        const splitOrder = await db.order.create({
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

        splitOrders.push({
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
      }

      // Delete items from original order (they've been copied to split orders)
      const itemIdsToRemove = tablesWithItems.flatMap(tableId =>
        itemsByTable.get(tableId)?.map(item => item.id) || []
      )

      await db.orderItemModifier.updateMany({
        where: {
          orderItem: { id: { in: itemIdsToRemove } },
        },
        data: { deletedAt: new Date() },
      })
      await db.orderItem.updateMany({
        where: { id: { in: itemIdsToRemove } },
        data: { deletedAt: new Date(), status: 'removed' as OrderItemStatus },
      })

      // Recalculate original order totals (for items without table assignment)
      const remainingItems = itemsByTable.get(null) || []
      let remainingSubtotal = 0
      remainingItems.forEach(item => {
        const itemTotal = Number(item.price) * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, m) => sum + Number(m.price), 0) * item.quantity
        remainingSubtotal += itemTotal + modifiersTotal
      })

      const remainingTax = calculateTax(remainingSubtotal, taxRate)
      const remainingTotal = Math.round((remainingSubtotal + remainingTax) * 100) / 100

      // Update original order totals
      await db.order.update({
        where: { id: order.id },
        data: {
          subtotal: remainingSubtotal,
          taxTotal: remainingTax,
          total: remainingTotal,
          itemCount: remainingItems.reduce((sum, i) => sum + i.quantity, 0),
          notes: order.notes
            ? `${order.notes}\n[Split by table: ${tablesWithItems.length} tables]`
            : `[Split by table: ${tablesWithItems.length} tables]`,
          version: { increment: 1 },
        },
      })

      // Dispatch socket events for table splits (fire-and-forget)
      for (const s of splitOrders) {
        void dispatchOpenOrdersChanged(order.locationId, {
          trigger: 'created',
          orderId: s.id,
          tableId: s.tableId || undefined,
        }, { async: true }).catch(() => {})
      }

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

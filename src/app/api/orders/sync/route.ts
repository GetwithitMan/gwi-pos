import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate, calculateTax } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'

// POST sync an offline order
// This handles orders that were created while the terminal was offline
export const POST = withVenue(async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      locationId,
      tableId,
      orderTypeId,
      employeeId,
      items,
      customFields,
      localId,      // Terminal-prefixed ID (e.g., "BAR1-102")
      offlineId,    // UUID for deduplication
      offlineTimestamp,
    } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Check for duplicate sync (idempotency) — read from OrderSnapshot
    if (offlineId) {
      const existing = await db.orderSnapshot.findFirst({
        where: {
          locationId,
          offlineId,
        },
        select: { id: true },
      })

      if (existing) {
        // Already synced - return the existing order ID
        return NextResponse.json(
          {
            message: 'Order already synced',
            existingOrderId: existing.id,
          },
          { status: 409 }
        )
      }
    }

    // Validate required fields
    if (!employeeId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Employee ID and items are required' },
        { status: 400 }
      )
    }

    // Validate employee exists
    const employee = await db.employee.findUnique({
      where: { id: employeeId },
    })
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 400 })
    }

    // Validate table if provided
    if (tableId) {
      const table = await db.table.findUnique({
        where: { id: tableId },
      })
      if (!table) {
        return NextResponse.json({ error: 'Table not found' }, { status: 400 })
      }
    }

    // Create the order with items atomically (order number lock + create in one tx)
    const order = await db.$transaction(async (tx) => {
      // Generate order number (sequential per location per day)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const tomorrow = new Date(today)
      tomorrow.setDate(tomorrow.getDate() + 1)

      // Lock latest order row to prevent duplicate order numbers
      const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
        `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3 ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
        locationId, today, tomorrow
      )
      const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

      // Calculate totals from items
      let subtotal = 0
      const orderItems: any[] = []

      for (const item of items) {
        const menuItem = await tx.menuItem.findUnique({
          where: { id: item.menuItemId },
        })

        if (!menuItem) {
          throw new Error(`Menu item ${item.menuItemId} not found`)
        }

        const itemPrice = Number(menuItem.price)
        const quantity = item.quantity || 1
        const itemTotal = itemPrice * quantity

        subtotal += itemTotal

        orderItems.push({
          locationId,
          menuItemId: item.menuItemId,
          name: menuItem.name,
          quantity,
          price: itemPrice,
          total: itemTotal,
          seatNumber: item.seatNumber || null,
          specialNotes: item.specialNotes || null,
          status: 'pending',
          modifiers: item.modifiers || [],
        })
      }

      // Get tax rate from location settings
      const location = await tx.location.findUnique({
        where: { id: locationId },
      })
      const taxRate = getLocationTaxRate(location?.settings as { tax?: { defaultRate?: number } })
      const taxTotal = calculateTax(subtotal, taxRate)
      const total = Math.round((subtotal + taxTotal) * 100) / 100

      // Create the order
      const newOrder = await tx.order.create({
        data: {
          locationId,
          employeeId,
          orderNumber,
          tableId: tableId || null,
          orderTypeId: orderTypeId || null,
          customFields: customFields || {},
          status: 'open',
          subtotal,
          taxTotal,
          total,
          offlineId: offlineId || null,
          offlineLocalId: localId || null,
          offlineTimestamp: offlineTimestamp ? new Date(offlineTimestamp) : null,
        },
      })

      // Create order items
      for (const item of orderItems) {
        await tx.orderItem.create({
          data: {
            ...item,
            orderId: newOrder.id,
          },
        })
      }

      // If table, update status
      if (tableId) {
        await tx.table.update({
          where: { id: tableId },
          data: {
            status: 'occupied',
          },
        })
      }

      return newOrder
    })

    // Fetch the complete order with items
    const completeOrder = await db.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            menuItem: true,
            modifiers: true,
          },
        },
        table: true,
        employee: {
          select: { id: true, firstName: true, lastName: true, displayName: true },
        },
      },
    })

    // Dispatch socket event for synced order (fire-and-forget)
    if (completeOrder) {
      void dispatchOpenOrdersChanged(completeOrder.locationId, {
        trigger: 'created',
        orderId: completeOrder.id,
        tableId: completeOrder.tableId || undefined,
      }, { async: true }).catch(() => {})
    }

    return NextResponse.json({ data: {
      success: true,
      order: completeOrder,
      localId,
      message: 'Offline order synced successfully',
    } })
  } catch (error) {
    console.error('Failed to sync offline order:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync order' },
      { status: 500 }
    )
  }
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLocationTaxRate, calculateSplitTax, isItemTaxInclusive } from '@/lib/order-calculations'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { OrderRepository, EmployeeRepository } from '@/lib/repositories'
import { createChildLogger } from '@/lib/logger'
const log = createChildLogger('orders-sync')

// POST sync an offline order
// This handles orders that were created while the terminal was offline
export const POST = withVenue(withAuth({ allowCellular: true }, async function POST(request: NextRequest) {
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

    // Check for duplicate sync (idempotency) — read from Order (where sync creates records)
    if (offlineId) {
      const existing = await OrderRepository.getOrderByOfflineId(offlineId, locationId)

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
    const employee = await EmployeeRepository.getEmployeeById(employeeId, locationId)
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 400 })
    }

    // Validate table if provided
    // TODO: Add TableRepository once that repository exists
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

      // Batch-fetch all menu items in one query instead of N+1 findUnique calls
      const menuItemIds = [...new Set(items.map((item: any) => item.menuItemId))]
      const menuItemsMap = new Map(
        (await tx.menuItem.findMany({
          where: { id: { in: menuItemIds } },
          include: { category: { select: { categoryType: true } } },
        })).map(mi => [mi.id, mi])
      )

      // Get tax rate and inclusive settings from location
      const location = await tx.location.findUnique({
        where: { id: locationId },
      })
      const locSettings = location?.settings as { tax?: { defaultRate?: number; inclusiveTaxRate?: number; taxInclusiveLiquor?: boolean; taxInclusiveFood?: boolean } } | null
      const taxRate = getLocationTaxRate(locSettings)
      const taxIncSettings = {
        taxInclusiveLiquor: locSettings?.tax?.taxInclusiveLiquor ?? false,
        taxInclusiveFood: locSettings?.tax?.taxInclusiveFood ?? false,
      }

      // Calculate totals from items
      let subtotal = 0
      const orderItems: any[] = []

      for (const item of items) {
        const menuItem = menuItemsMap.get(item.menuItemId)

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
          isTaxInclusive: isItemTaxInclusive(menuItem.category?.categoryType, taxIncSettings),
        })
      }

      // Split subtotals by tax-inclusive status
      let inclusiveSubtotal = 0
      let exclusiveSubtotal = 0
      for (const oi of orderItems) {
        const itemTotal = Number(oi.price) * (oi.quantity || 1)
        if (oi.isTaxInclusive) {
          inclusiveSubtotal += itemTotal
        } else {
          exclusiveSubtotal += itemTotal
        }
      }

      // Use split-aware tax calculation
      const inclusiveTaxRateRaw = locSettings?.tax?.inclusiveTaxRate
      const inclusiveTaxRate = inclusiveTaxRateRaw != null && Number.isFinite(inclusiveTaxRateRaw) && inclusiveTaxRateRaw > 0
        ? inclusiveTaxRateRaw / 100 : undefined
      const { taxFromInclusive, taxFromExclusive, totalTax: taxTotal } = calculateSplitTax(
        inclusiveSubtotal, exclusiveSubtotal, taxRate, inclusiveTaxRate
      )
      // Inclusive items already contain tax; only exclusive tax is added on top
      const total = Math.round((subtotal + taxFromExclusive) * 100) / 100

      // TX-KEEP: CREATE — offline-synced order inside order-number lock; no repo create method
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
          taxFromInclusive,
          taxFromExclusive,
          inclusiveTaxRate: inclusiveTaxRate || 0,
          total,
          offlineId: offlineId || null,
          offlineLocalId: localId || null,
          offlineTimestamp: offlineTimestamp ? new Date(offlineTimestamp) : null,
        },
      })

      // Create order items in parallel
      await Promise.all(
        orderItems.map(item =>
          // TX-KEEP: CREATE — offline-synced order items with orderId FK; no batch repo create method
          tx.orderItem.create({
            data: {
              ...item,
              orderId: newOrder.id,
            },
          })
        )
      )

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
    const completeOrder = await OrderRepository.getOrderByIdWithInclude(order.id, locationId, {
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
    })

    // Dispatch socket event for synced order (fire-and-forget)
    if (completeOrder) {
      void dispatchOpenOrdersChanged(completeOrder.locationId, {
        trigger: 'created',
        orderId: completeOrder.id,
        tableId: completeOrder.tableId || undefined,
      }, { async: true }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders.sync'))
    }

    // Emit ORDER_CREATED + ITEM_ADDED events (fire-and-forget)
    if (completeOrder) {
      void emitOrderEvents(locationId, order.id, [
        {
          type: 'ORDER_CREATED',
          payload: {
            locationId,
            employeeId,
            orderType: null,
            tableId: tableId || null,
            guestCount: 1,
            orderNumber: order.orderNumber,
            displayNumber: null,
          },
        },
        ...(completeOrder.items || []).map((item: any) => ({
          type: 'ITEM_ADDED' as const,
          payload: {
            lineItemId: item.id,
            menuItemId: item.menuItemId,
            name: item.name,
            priceCents: Math.round(Number(item.price) * 100),
            quantity: item.quantity,
            isHeld: item.isHeld || false,
            soldByWeight: item.soldByWeight || false,
            modifiersJson: item.modifiers?.length
              ? JSON.stringify(item.modifiers.map((m: any) => ({
                  id: m.id, modifierId: m.modifierId, name: m.name,
                  price: Number(m.price), quantity: m.quantity,
                  preModifier: m.preModifier, depth: m.depth,
                  spiritTier: m.spiritTier || null,
                  linkedBottleProductId: m.linkedBottleProductId || null,
                  isCustomEntry: m.isCustomEntry || false,
                  isNoneSelection: m.isNoneSelection || false,
                  swapTargetName: m.swapTargetName || null,
                  swapTargetItemId: m.swapTargetItemId || null,
                  swapPricingMode: m.swapPricingMode || null,
                  swapEffectivePrice: m.swapEffectivePrice != null ? Number(m.swapEffectivePrice) : null,
                })))
              : null,
            specialNotes: item.specialNotes || null,
            seatNumber: item.seatNumber ?? null,
            courseNumber: item.courseNumber ?? null,
            isTaxInclusive: item.isTaxInclusive ?? false,
            pourSize: item.pourSize || null,
            pourMultiplier: item.pourMultiplier ? Number(item.pourMultiplier) : null,
          },
        })),
      ]).catch(err => log.warn({ err }, 'Background task failed'))
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
}))

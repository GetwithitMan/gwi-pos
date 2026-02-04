import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderSchema, validateRequest } from '@/lib/validations'

// Helper to calculate commission for an item
function calculateItemCommission(
  itemTotal: number,
  quantity: number,
  commissionType: string | null,
  commissionValue: number | null
): number {
  if (!commissionType || commissionValue === null || commissionValue === undefined) {
    return 0
  }
  if (commissionType === 'percent') {
    return Math.round((itemTotal * commissionValue / 100) * 100) / 100
  } else if (commissionType === 'fixed') {
    return Math.round((commissionValue * quantity) * 100) / 100
  }
  return 0
}

// POST - Create a new order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createOrderSchema, body)
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      )
    }

    const { employeeId, locationId, orderType, orderTypeId, tableId, tabName, guestCount, items, notes, customFields } = validation.data

    // Get next order number for today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const lastOrder = await db.order.findFirst({
      where: {
        locationId,
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      orderBy: { orderNumber: 'desc' },
    })

    const orderNumber = (lastOrder?.orderNumber || 0) + 1

    // Fetch menu items to get commission settings
    const menuItemIds = items.map(item => item.menuItemId)
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: { id: true, commissionType: true, commissionValue: true },
    })
    const menuItemMap = new Map(menuItems.map(mi => [mi.id, mi]))

    // Calculate totals
    let subtotal = 0
    let commissionTotal = 0

    // Helper to check if a string is a valid CUID (for real modifier IDs)
    const isValidModifierId = (id: string) => {
      // CUIDs are typically 25 chars starting with 'c'
      // Exclude synthetic IDs: combo- (combo selections), pizza- (pizza toppings/sauces/cheeses)
      return id && !id.startsWith('combo-') && !id.startsWith('pizza-') && id.length >= 20
    }

    const orderItems = items.map(item => {
      const itemTotal = item.price * item.quantity
      const modifiersTotal = item.modifiers.reduce((sum, mod) => sum + mod.price, 0) * item.quantity
      const fullItemTotal = itemTotal + modifiersTotal
      subtotal += fullItemTotal

      // Calculate commission for this item
      const menuItem = menuItemMap.get(item.menuItemId)
      const itemCommission = calculateItemCommission(
        fullItemTotal,
        item.quantity,
        menuItem?.commissionType || null,
        menuItem?.commissionValue ? Number(menuItem.commissionValue) : null
      )
      commissionTotal += itemCommission

      // Build pizza data if present
      const pizzaData = item.pizzaConfig ? {
        create: {
          locationId,
          sizeId: item.pizzaConfig.sizeId,
          crustId: item.pizzaConfig.crustId,
          sauceId: item.pizzaConfig.sauceId,
          sauceAmount: item.pizzaConfig.sauceAmount,
          cheeseId: item.pizzaConfig.cheeseId,
          cheeseAmount: item.pizzaConfig.cheeseAmount,
          // Store full config in toppingsData JSON for easy retrieval
          toppingsData: {
            toppings: item.pizzaConfig.toppings,
            sauces: item.pizzaConfig.sauces,
            cheeses: item.pizzaConfig.cheeses,
            cookingInstructions: item.pizzaConfig.cookingInstructions,
            cutStyle: item.pizzaConfig.cutStyle,
          },
          cookingInstructions: item.pizzaConfig.cookingInstructions || null,
          cutStyle: item.pizzaConfig.cutStyle || null,
          sizePrice: item.pizzaConfig.priceBreakdown.sizePrice,
          crustPrice: item.pizzaConfig.priceBreakdown.crustPrice,
          saucePrice: item.pizzaConfig.priceBreakdown.saucePrice,
          cheesePrice: item.pizzaConfig.priceBreakdown.cheesePrice,
          toppingsPrice: item.pizzaConfig.priceBreakdown.toppingsPrice,
          totalPrice: item.pizzaConfig.totalPrice,
        }
      } : undefined

      return {
        locationId,
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        itemTotal: itemTotal + modifiersTotal,
        commissionAmount: itemCommission,
        specialNotes: item.specialNotes || null,
        seatNumber: item.seatNumber || null,
        courseNumber: item.courseNumber || null,
        // Timed rental / entertainment fields
        blockTimeMinutes: item.blockTimeMinutes || null,
        modifiers: {
          create: item.modifiers.map(mod => ({
            locationId,
            // Set modifierId to null for combo selections (they have synthetic IDs)
            modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
            name: mod.name,
            price: mod.price,
            quantity: 1,
            preModifier: mod.preModifier || null,
            depth: mod.depth || 0, // Modifier hierarchy depth
            // Spirit selection fields (Liquor Builder)
            spiritTier: mod.spiritTier || null,
            linkedBottleProductId: mod.linkedBottleProductId || null,
          })),
        },
        // Ingredient modifications (No, Lite, On Side, Extra, Swap)
        ingredientModifications: item.ingredientModifications && item.ingredientModifications.length > 0
          ? {
              create: item.ingredientModifications.map(ing => ({
                locationId,
                ingredientId: ing.ingredientId,
                ingredientName: ing.name,
                modificationType: ing.modificationType,
                priceAdjustment: ing.priceAdjustment || 0,
                swappedToModifierId: ing.swappedTo?.modifierId || null,
                swappedToModifierName: ing.swappedTo?.name || null,
              })),
            }
          : undefined,
        // Pizza configuration
        pizzaData,
      }
    })

    // Get tax rate from location settings (default 8%)
    const location = await db.location.findUnique({
      where: { id: locationId },
    })
    const settings = location?.settings as { tax?: { defaultRate?: number } } | null
    const taxRate = (settings?.tax?.defaultRate || 8) / 100

    const taxTotal = Math.round(subtotal * taxRate * 100) / 100
    const total = Math.round((subtotal + taxTotal) * 100) / 100

    // Create the order
    // Initialize seat management (Skill 121)
    const initialSeatCount = guestCount || 1
    const initialSeatTimestamps: Record<string, string> = {}
    const now = new Date().toISOString()
    for (let i = 1; i <= initialSeatCount; i++) {
      initialSeatTimestamps[i.toString()] = now
    }

    const order = await db.order.create({
      data: {
        locationId,
        employeeId,
        orderNumber,
        orderType,
        orderTypeId: orderTypeId || null,
        tableId: tableId || null,
        tabName: tabName || null,
        guestCount: initialSeatCount,
        baseSeatCount: initialSeatCount,     // Skill 121: Track original seat count
        extraSeatCount: 0,                    // Skill 121: Additional seats added
        seatVersion: 0,                       // Skill 121: Concurrency version
        seatTimestamps: initialSeatTimestamps, // Skill 121: When each seat was created
        status: 'open',
        subtotal,
        discountTotal: 0,
        taxTotal,
        tipTotal: 0,
        total,
        commissionTotal,
        notes: notes || null,
        customFields: customFields ? (customFields as Prisma.InputJsonValue) : Prisma.JsonNull,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: {
          include: {
            modifiers: true,
          },
        },
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
            id: true,
            name: true,
          },
        },
      },
    })

    return NextResponse.json({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      tableId: order.tableId,
      tableName: order.table?.name || null,
      tabName: order.tabName,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      items: order.items.map((item, index) => ({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        itemTotal: Number(item.itemTotal),
        correlationId: items[index]?.correlationId, // Echo back client-provided correlation ID
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
        })),
      })),
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      createdAt: order.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create order:', error)
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    )
  }
}

// GET - List orders with pagination (for order history, kitchen display, etc.)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const orders = await db.order.findMany({
      where: {
        locationId,
        ...(status ? { status } : {}),
        ...(employeeId ? { employeeId } : {}),
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
            id: true,
            name: true,
          },
        },
        items: {
          include: {
            modifiers: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    })

    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        tableId: order.tableId,
        tableName: order.table?.name || null,
        tabName: order.tabName,
        guestCount: order.guestCount,
        employee: {
          id: order.employee.id,
          name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
        },
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Number(order.subtotal),
        total: Number(order.total),
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
        createdAt: order.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}

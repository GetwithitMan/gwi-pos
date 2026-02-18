import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderSchema, validateRequest } from '@/lib/validations'
import { errorCapture } from '@/lib/error-capture'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { calculateItemTotal, calculateItemCommission, calculateOrderTotals, isItemTaxInclusive } from '@/lib/order-calculations'
import { calculateCardPrice } from '@/lib/pricing'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'

// POST - Create a new order
export const POST = withVenue(withTiming(async function POST(request: NextRequest) {
  try {
    const timing = getTimingFromRequest(request)
    const body = await request.json()

    // Validate request body
    const validation = validateRequest(createOrderSchema, body)
    if (!validation.success) {
      return apiError.badRequest(validation.error, ERROR_CODES.VALIDATION_ERROR)
    }

    const { employeeId, locationId, orderType, orderTypeId, tableId, tabName, guestCount, items, notes, customFields } = validation.data

    // Get next order number for today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    // === FAST PATH: Draft shell creation (no items) ===
    // When items is empty, create a lightweight order shell without tax/commission/totals computation.
    // This enables background pre-creation on table tap so "Send to Kitchen" is near-instant.
    if (items.length === 0) {
      const initialSeatCount = guestCount || 1
      const initialSeatTimestamps: Record<string, string> = {}
      const now = new Date().toISOString()
      for (let i = 1; i <= initialSeatCount; i++) {
        initialSeatTimestamps[i.toString()] = now
      }

      // Serializable transaction: prevents duplicate order numbers under concurrent requests
      timing.start('db-draft')
      const order = await db.$transaction(async (tx) => {
        const lastOrder = await tx.order.findFirst({
          where: { locationId, createdAt: { gte: today, lt: tomorrow } },
          orderBy: { orderNumber: 'desc' },
          select: { orderNumber: true },
        })
        const orderNumber = (lastOrder?.orderNumber || 0) + 1

        return tx.order.create({
          data: {
            locationId,
            employeeId,
            orderNumber,
            orderType,
            orderTypeId: orderTypeId || null,
            tableId: tableId || null,
            tabName: tabName || null,
            guestCount: initialSeatCount,
            baseSeatCount: initialSeatCount,
            extraSeatCount: 0,
            seatVersion: 0,
            seatTimestamps: initialSeatTimestamps,
            status: 'draft',
            subtotal: 0,
            discountTotal: 0,
            taxTotal: 0,
            taxFromInclusive: 0,
            taxFromExclusive: 0,
            tipTotal: 0,
            total: 0,
            commissionTotal: 0,
            notes: notes || null,
            customFields: customFields ? (customFields as Prisma.InputJsonValue) : Prisma.JsonNull,
          },
        })
      }, { isolationLevel: 'Serializable' })

      timing.end('db-draft', 'Draft order create')

      // Fire-and-forget audit log
      db.auditLog.create({
        data: {
          locationId,
          employeeId,
          action: 'order_draft_created',
          entityType: 'order',
          entityId: order.id,
          details: { orderNumber: order.orderNumber, orderType, tableId: tableId || null },
        },
      }).catch(() => {})

      // No socket dispatches for drafts — invisible to Open Orders & Floor Plan
      return NextResponse.json({ data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'draft',
        items: [],
      } })
    }

    // === STANDARD PATH: Full order creation with items ===

    // Get order number atomically (serializable transaction prevents duplicates)
    const { orderNumber } = await db.$transaction(async (tx) => {
      const lastOrder = await tx.order.findFirst({
        where: { locationId, createdAt: { gte: today, lt: tomorrow } },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      })
      return { orderNumber: (lastOrder?.orderNumber || 0) + 1 }
    }, { isolationLevel: 'Serializable' })

    // Fetch menu items to get commission settings
    const menuItemIds = items.map(item => item.menuItemId)
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      select: { id: true, commissionType: true, commissionValue: true, category: { select: { categoryType: true } } },
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
      // Calculate item total using centralized function
      const fullItemTotal = calculateItemTotal(item)
      subtotal += fullItemTotal

      // Calculate commission using centralized function
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
        itemTotal: fullItemTotal,
        commissionAmount: itemCommission,
        specialNotes: item.specialNotes || null,
        seatNumber: item.seatNumber || null,
        courseNumber: item.courseNumber || null,
        isHeld: item.isHeld || false,
        delayMinutes: item.delayMinutes || null,
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

    // Get location settings for tax calculation (cached - FIX-009)
    const locationSettings = await getLocationSettings(locationId)
    const parsedSettings = locationSettings ? parseSettings(locationSettings) : null
    const dualPricingEnabled = parsedSettings?.dualPricing?.enabled ?? false
    const cashDiscountPct = parsedSettings?.dualPricing?.cashDiscountPercent ?? 4.0

    // Derive tax-inclusive flags from TaxRule records (same logic as /api/settings GET)
    const [taxRules, allCategories] = await Promise.all([
      db.taxRule.findMany({
        where: { locationId, isActive: true, isInclusive: true, deletedAt: null },
        select: { appliesTo: true, categoryIds: true },
      }),
      db.category.findMany({
        where: { locationId, deletedAt: null },
        select: { id: true, categoryType: true },
      }),
    ])
    let taxInclusiveLiquor = false
    let taxInclusiveFood = false
    const LIQUOR_TYPES = ['liquor', 'drinks']
    const FOOD_TYPES = ['food', 'pizza', 'combos']
    for (const rule of taxRules) {
      if (rule.appliesTo === 'all') { taxInclusiveLiquor = true; taxInclusiveFood = true; break }
      if (rule.appliesTo === 'category' && rule.categoryIds) {
        const ruleCategories = rule.categoryIds as string[]
        for (const cat of allCategories) {
          if (ruleCategories.includes(cat.id)) {
            if (cat.categoryType && LIQUOR_TYPES.includes(cat.categoryType)) taxInclusiveLiquor = true
            if (cat.categoryType && FOOD_TYPES.includes(cat.categoryType)) taxInclusiveFood = true
          }
        }
      }
    }
    const taxIncSettings = { taxInclusiveLiquor, taxInclusiveFood }

    // Stamp each orderItem with pricing truth + mark items for split tax calc
    for (const oi of orderItems) {
      const mi = menuItemMap.get(oi.menuItemId)
      const catType = mi?.category?.categoryType ?? null
      const taxInc = isItemTaxInclusive(catType ?? undefined, taxIncSettings)
      ;(oi as any).categoryType = catType
      ;(oi as any).isTaxInclusive = taxInc
      ;(oi as any).cardPrice = dualPricingEnabled ? calculateCardPrice(Number(oi.price), cashDiscountPct) : null
    }

    // Also mark the raw items array so calculateOrderTotals can split
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)
      const catType = mi?.category?.categoryType ?? null
      ;(item as any).isTaxInclusive = isItemTaxInclusive(catType ?? undefined, taxIncSettings)
    }

    // Use centralized calculation function (single source of truth)
    const totals = calculateOrderTotals(items, locationSettings, 0, 0)
    const { taxTotal, taxFromInclusive, taxFromExclusive, total } = totals

    // Create the order
    // Initialize seat management (Skill 121)
    timing.start('db')
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
        taxFromInclusive,
        taxFromExclusive,
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
            ingredientModifications: true,
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

    timing.end('db', 'Order create with items')

    // Audit log: order created
    await db.auditLog.create({
      data: {
        locationId,
        employeeId,
        action: 'order_created',
        entityType: 'order',
        entityId: order.id,
        details: {
          orderNumber,
          orderType,
          tableId: tableId || null,
          tabName: tabName || null,
          itemCount: items.length,
        },
      },
    })

    // Use mapper for complete response with correlationId support
    const response = {
      ...mapOrderForResponse(order),
      items: order.items.map((item: any, index: number) =>
        mapOrderItemForResponse(item, items[index]?.correlationId)
      ),
    }

    // FIX-011: Dispatch real-time totals update (fire-and-forget)
    dispatchOrderTotalsUpdate(locationId, order.id, {
      subtotal,
      taxTotal,
      tipTotal: 0,
      discountTotal: 0,
      total,
      commissionTotal,
    }, { async: true }).catch(console.error)

    // Dispatch open orders list changed + floor plan update (fire-and-forget)
    dispatchOpenOrdersChanged(locationId, { trigger: 'created', orderId: order.id, tableId: tableId || undefined }, { async: true }).catch(() => {})
    if (tableId) {
      dispatchFloorPlanUpdate(locationId, { async: true }).catch(() => {})
    }

    return NextResponse.json({ data: response })
  } catch (error) {
    console.error('Failed to create order:', error)

    // Capture CRITICAL order creation error
    const body = await request.clone().json().catch(() => ({}))
    errorCapture.critical('ORDER', 'Order creation failed', {
      category: 'order-creation-error',
      action: 'Creating new order',
      error: error instanceof Error ? error : undefined,
      path: '/api/orders',
      requestBody: body,
      locationId: body?.locationId,
      employeeId: body?.employeeId,
      tableId: body?.tableId,
    }).catch(() => {
      // Silently fail error logging
    })

    return apiError.internalError('Failed to create order', ERROR_CODES.INTERNAL_ERROR)
  }
}, 'orders-create'))

// GET - List orders with pagination (for order history, kitchen display, etc.)
export const GET = withVenue(async function GET(request: NextRequest) {
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
          where: { deletedAt: null },
          include: {
            modifiers: { where: { deletedAt: null } },
            ingredientModifications: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    })

    return NextResponse.json({ data: {
      orders: orders.map(order => ({
        ...mapOrderForResponse(order),
        // Add summary fields for list view
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
      })),
    } })
  } catch (error) {
    console.error('Failed to fetch orders:', error)

    // Capture HIGH severity error for order fetching
    const searchParams = request.nextUrl.searchParams
    errorCapture.high('API', 'Failed to fetch orders', {
      category: 'order-fetch-error',
      action: 'Fetching orders list',
      error: error instanceof Error ? error : undefined,
      path: '/api/orders',
      queryParams: {
        locationId: searchParams.get('locationId') || '',
        status: searchParams.get('status') || '',
        employeeId: searchParams.get('employeeId') || '',
      },
      locationId: searchParams.get('locationId') || undefined,
    }).catch(() => {
      // Silently fail error logging
    })

    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
})

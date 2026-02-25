import { NextRequest, NextResponse } from 'next/server'
import { Prisma, OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderSchema, validateRequest } from '@/lib/validations'
import { errorCapture } from '@/lib/error-capture'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { calculateItemTotal, calculateItemCommission, calculateOrderTotals, isItemTaxInclusive } from '@/lib/order-calculations'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { getLocationSettings } from '@/lib/location-cache'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'

// POST - Create a new order
export const POST = withVenue(withTiming(async function POST(request: NextRequest) {
  let reqBody: any = {}
  try {
    const timing = getTimingFromRequest(request)
    const body = await request.json()
    reqBody = body

    // Validate request body
    const validation = validateRequest(createOrderSchema, body)
    if (!validation.success) {
      return apiError.badRequest(validation.error, ERROR_CODES.VALIDATION_ERROR)
    }

    const { employeeId, locationId, orderType, orderTypeId, tableId, tabName, guestCount, items, notes, customFields } = validation.data
    const reservationId: string | undefined = typeof body.reservationId === 'string' ? body.reservationId : undefined

    // Auth check — require POS access
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Compute business day for this order
    const locationRec = await db.location.findFirst({ where: { id: locationId }, select: { settings: true } })
    const locSettings = locationRec?.settings as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const businessDayStart = getCurrentBusinessDay(dayStartTime).start

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

      // Atomic transaction: table lock (Bug 13) + order number lock (Bug 5) + create
      timing.start('db-draft')
      let order: any
      try {
        order = await db.$transaction(async (tx) => {
          // Lock table row to prevent concurrent double-claim
          if (tableId) {
            await tx.$queryRawUnsafe(`SELECT id FROM "Table" WHERE id = $1 FOR UPDATE`, tableId)
            const existingOrder = await tx.order.findFirst({
              where: {
                tableId,
                status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
                deletedAt: null,
              },
              select: { id: true, orderNumber: true, version: true },
            })
            if (existingOrder) {
              throw { code: 'TABLE_OCCUPIED', data: existingOrder }
            }
          }

          // Lock latest order row to prevent duplicate order numbers (global unique constraint)
          const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
            `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NULL ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
            locationId
          )
          const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

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
              businessDayDate: businessDayStart,
            },
          })
        })
      } catch (err: any) {
        if (err?.code === 'TABLE_OCCUPIED') {
          return apiError.conflict(
            'Table already has an active order',
            ERROR_CODES.TABLE_OCCUPIED,
            { existingOrderId: err.data.id, existingOrderNumber: err.data.orderNumber, existingOrderVersion: err.data.version }
          )
        }
        throw err
      }

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

      // Link reservation to this draft order (fire-and-forget)
      if (reservationId) {
        void (async () => {
          try {
            const reservation = await db.reservation.findUnique({
              where: { id: reservationId },
              select: { orderId: true, bottleServiceTierId: true, bottleServiceTier: { select: { minimumSpend: true } } },
            })
            if (reservation && !reservation.orderId) {
              await db.reservation.update({ where: { id: reservationId }, data: { orderId: order.id } })
            }
            if (reservation?.bottleServiceTierId) {
              await db.order.update({
                where: { id: order.id },
                data: {
                  isBottleService: true,
                  bottleServiceTierId: reservation.bottleServiceTierId,
                  bottleServiceMinSpend: reservation.bottleServiceTier?.minimumSpend ?? null,
                  bottleServiceCurrentSpend: 0,
                },
              })
            }
          } catch (e) {
            console.error('Failed to link reservation to draft order:', e)
          }
        })()
      }

      // No socket dispatches for drafts — invisible to Open Orders & Floor Plan
      return NextResponse.json({ data: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: 'draft',
        orderType: order.orderType,
        tableId: order.tableId || null,
        tabName: order.tabName || null,
        guestCount: order.guestCount,
        employeeId: order.employeeId,
        subtotal: 0,
        taxTotal: 0,
        tipTotal: 0,
        discountTotal: 0,
        total: 0,
        openedAt: order.createdAt.toISOString(),
        items: [],
      } })
    }

    // === STANDARD PATH: Full order creation with items ===

    // Order number + table check handled atomically inside order creation transaction below

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
      // For weight-based items, compute the effective price for backward compat
      const effectivePrice = (item.soldByWeight && item.weight && item.unitPrice)
        ? roundToCents(item.unitPrice * item.weight)
        : item.price

      // Calculate item total using centralized function
      const fullItemTotal = calculateItemTotal({
        ...item,
        price: effectivePrice,
      })
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
        price: effectivePrice,
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
        // Weight-based pricing fields
        soldByWeight: item.soldByWeight || false,
        weight: item.weight ?? null,
        weightUnit: item.weightUnit ?? null,
        unitPrice: item.unitPrice ?? null,
        grossWeight: item.grossWeight ?? null,
        tareWeight: item.tareWeight ?? null,
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
    // For weight-based items, override price with effectivePrice for correct total calculation
    for (const item of items) {
      const mi = menuItemMap.get(item.menuItemId)
      const catType = mi?.category?.categoryType ?? null
      ;(item as any).isTaxInclusive = isItemTaxInclusive(catType ?? undefined, taxIncSettings)
      if (item.soldByWeight && item.weight && item.unitPrice) {
        ;(item as any).price = roundToCents(item.unitPrice * item.weight)
      }
    }

    // Use centralized calculation function (single source of truth)
    const totals = calculateOrderTotals(items, locationSettings, 0, 0)
    const { taxTotal, taxFromInclusive, taxFromExclusive, total } = totals

    // Create the order atomically: table lock (Bug 13) + order number lock (Bug 5) + create
    // Initialize seat management (Skill 121)
    timing.start('db')
    const initialSeatCount = guestCount || 1
    const initialSeatTimestamps: Record<string, string> = {}
    const now = new Date().toISOString()
    for (let i = 1; i <= initialSeatCount; i++) {
      initialSeatTimestamps[i.toString()] = now
    }

    let order: any
    try {
      order = await db.$transaction(async (tx) => {
        // Lock table row to prevent concurrent double-claim (Bug 13)
        if (tableId) {
          await tx.$queryRawUnsafe(`SELECT id FROM "Table" WHERE id = $1 FOR UPDATE`, tableId)
          const existingOrder = await tx.order.findFirst({
            where: {
              tableId,
              status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
              deletedAt: null,
            },
            select: { id: true, orderNumber: true, version: true },
          })
          if (existingOrder) {
            throw { code: 'TABLE_OCCUPIED', data: existingOrder }
          }
        }

        // Lock latest order row to prevent duplicate order numbers (global unique constraint)
        const lastOrderRows = await tx.$queryRawUnsafe<{ orderNumber: number }[]>(
          `SELECT "orderNumber" FROM "Order" WHERE "locationId" = $1 AND "parentOrderId" IS NULL ORDER BY "orderNumber" DESC LIMIT 1 FOR UPDATE`,
          locationId
        )
        const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

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
            itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
            notes: notes || null,
            customFields: customFields ? (customFields as Prisma.InputJsonValue) : Prisma.JsonNull,
            businessDayDate: businessDayStart,
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
      })
    } catch (err: any) {
      if (err?.code === 'TABLE_OCCUPIED') {
        return apiError.conflict(
          'Table already has an active order',
          ERROR_CODES.TABLE_OCCUPIED,
          { existingOrderId: err.data.id, existingOrderNumber: err.data.orderNumber, existingOrderVersion: err.data.version }
        )
      }
      throw err
    }

    timing.end('db', 'Order create with items')

    // Link reservation to this order (fire-and-forget)
    if (reservationId) {
      void (async () => {
        try {
          const reservation = await db.reservation.findUnique({
            where: { id: reservationId },
            select: { orderId: true, bottleServiceTierId: true, bottleServiceTier: { select: { minimumSpend: true } } },
          })
          if (reservation && !reservation.orderId) {
            await db.reservation.update({ where: { id: reservationId }, data: { orderId: order.id } })
          }
          if (reservation?.bottleServiceTierId) {
            await db.order.update({
              where: { id: order.id },
              data: {
                isBottleService: true,
                bottleServiceTierId: reservation.bottleServiceTierId,
                bottleServiceMinSpend: reservation.bottleServiceTier?.minimumSpend ?? null,
                bottleServiceCurrentSpend: 0,
              },
            })
          }
        } catch (e) {
          console.error('Failed to link reservation to order:', e)
        }
      })()
    }

    // Audit log: order created
    await db.auditLog.create({
      data: {
        locationId,
        employeeId,
        action: 'order_created',
        entityType: 'order',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
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
    errorCapture.critical('ORDER', 'Order creation failed', {
      category: 'order-creation-error',
      action: 'Creating new order',
      error: error instanceof Error ? error : undefined,
      path: '/api/orders',
      requestBody: reqBody,
      locationId: reqBody?.locationId,
      employeeId: reqBody?.employeeId,
      tableId: reqBody?.tableId,
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

    // T-078 admin filters
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const balanceFilter = searchParams.get('balanceFilter') // 'zero' | 'nonzero' | omit
    const includeRolledOver = searchParams.get('includeRolledOver') === 'true'

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Auth check — require POS access
    const requestingEmployeeId = request.headers.get('x-employee-id') || searchParams.get('requestingEmployeeId')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })

    // Build date range filter on createdAt
    const dateRangeFilter: Record<string, unknown> = {}
    if (dateFrom) {
      dateRangeFilter.gte = new Date(dateFrom)
    }
    if (dateTo) {
      // Include the full dateTo day by going to end of that day
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      dateRangeFilter.lte = end
    }

    // Build balance (total) filter
    let totalFilter: Record<string, unknown> | undefined
    if (balanceFilter === 'zero') {
      totalFilter = { lte: 0 }
    } else if (balanceFilter === 'nonzero') {
      totalFilter = { gt: 0 }
    }

    const orders = await db.order.findMany({
      where: {
        locationId,
        ...(status ? { status: status as OrderStatus } : {}),
        ...(employeeId ? { employeeId } : {}),
        ...(Object.keys(dateRangeFilter).length > 0 ? { createdAt: dateRangeFilter } : {}),
        ...(totalFilter ? { total: totalFilter } : {}),
        ...(includeRolledOver ? { rolledOverAt: { not: null } } : {}),
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
        itemCount: order.itemCount,
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

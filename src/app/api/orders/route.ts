import { NextRequest, NextResponse } from 'next/server'
import { Prisma, OrderStatus } from '@/generated/prisma/client'
import { db } from '@/lib/db'
import * as OrderRepository from '@/lib/repositories/order-repository'
import { createOrderSchema, validateRequest } from '@/lib/validations'
import { errorCapture } from '@/lib/error-capture'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { calculateItemTotal, calculateItemCommission, calculateOrderTotals, isItemTaxInclusive, getConvenienceFeeForChannel } from '@/lib/order-calculations'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES } from '@/lib/api/error-responses'
import { getLocationSettings, getLocationTimezone } from '@/lib/location-cache'
import { dispatchFloorPlanUpdate, buildOrderSummary } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { withTiming, getTimingFromRequest } from '@/lib/with-timing'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitOrderEvent, emitOrderEvents } from '@/lib/order-events/emitter'
import type { AddItemInput } from '@/lib/domain/order-items/types'
import { validateRequiredModifierGroups } from '@/lib/domain/order-items/item-operations'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { isTrainingEmployee } from '@/lib/training-mode'
import { validateCellularEmployeeFromHeaders, CellularAuthError } from '@/lib/cellular-validation'
import { getCachedInclusiveTaxRules, getCachedCategories } from '@/lib/tax-cache'
import { SOCKET_EVENTS } from '@/lib/socket-events'
import type { OrderTotalsUpdatedPayload, OrdersListChangedPayload, OrderSummaryUpdatedPayload } from '@/lib/socket-events'
import { queueSocketEvent, flushOutboxSafe } from '@/lib/socket-outbox'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('orders')

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

    const { employeeId: claimedEmployeeId, locationId, orderType, orderTypeId, tableId, tabName, guestCount, items, notes, customFields, idempotencyKey, scheduledFor } = validation.data
    const reservationId: string | undefined = typeof body.reservationId === 'string' ? body.reservationId : undefined
    const orderSource: string | null = typeof body.source === 'string' ? body.source : null
    const assignPager: boolean = body.assignPager === true
    const fulfillmentMode: string | null = typeof body.fulfillmentMode === 'string' ? body.fulfillmentMode : null

    // Notification Platform: reject raw pagerNumber — cache-only field
    if (body.pagerNumber !== undefined) {
      console.warn(`[Orders] DEPRECATED: raw pagerNumber sent in order create body. Use assignPager: true instead. Value ignored.`)
    }

    // Cellular employee binding: prevent impersonation by validating bound employee
    let employeeId: string
    try {
      employeeId = validateCellularEmployeeFromHeaders(request, claimedEmployeeId)
    } catch (caughtErr) {
      if (err instanceof CellularAuthError) {
        return err(err.message, err.status)
      }
      throw err
    }

    // Order creation idempotency — prevent double-tap / retry duplicates
    if (idempotencyKey) {
      const existing = await OrderRepository.getOrderByIdempotencyKey(idempotencyKey, locationId)
      if (existing) {
        // Return existing order — this is a duplicate request (locationId already available from validation)
        const fullOrder = await OrderRepository.getOrderByIdWithInclude(existing.id, locationId, {
          employee: { select: { id: true, displayName: true, firstName: true, lastName: true } },
          items: { where: { deletedAt: null }, include: { modifiers: true, ingredientModifications: true, pizzaData: true } },
          table: { select: { id: true, name: true, sectionId: true } },
        })
        return NextResponse.json({ data: fullOrder, duplicate: true })
      }
    }

    // HA cellular sync — detect mutation origin + audit trail enrichment
    const isCellularOrigin = request.headers.get('x-cellular-authenticated') === '1'
    const originTerminalIdValue = request.headers.get('x-terminal-id') || null
    const cellularMutationFields = isCellularOrigin
      ? {
          lastMutatedBy: 'cloud',
          originTerminalId: originTerminalIdValue,
          metadata: { originDeviceType: 'cellular' as const, originTerminalId: originTerminalIdValue },
        }
      : {
          lastMutatedBy: 'local',
          originTerminalId: null as string | null,
          metadata: { originDeviceType: 'lan' as const, originTerminalId: null as string | null },
        }

    // Auth check — require POS access
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)

    // Compute business day for this order (uses cached location settings — FIX-005)
    // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
    const locSettings = await getLocationSettings(locationId) as Record<string, unknown> | null
    const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
    const venueTimezone = await getLocationTimezone(locationId)
    const businessDay = getCurrentBusinessDay(dayStartTime, venueTimezone)
    const businessDayStart = businessDay.start

    // Training mode: stamp isTraining on orders created by training employees
    const parsedLocSettings = locSettings ? parseSettings(locSettings) : null
    const orderIsTraining = parsedLocSettings ? isTrainingEmployee(employeeId, parsedLocSettings) : false

    // Pre-order / scheduled order validation
    let scheduledForDate: Date | null = null
    if (scheduledFor) {
      scheduledForDate = new Date(scheduledFor)
      if (isNaN(scheduledForDate.getTime())) {
        return apiError.badRequest('Invalid scheduledFor datetime', ERROR_CODES.VALIDATION_ERROR)
      }
      const now = new Date()
      if (scheduledForDate <= now) {
        return apiError.badRequest('scheduledFor must be in the future', ERROR_CODES.VALIDATION_ERROR)
      }
      const preOrderSettings = parsedLocSettings?.preOrders
      if (preOrderSettings?.enabled) {
        const msAhead = scheduledForDate.getTime() - now.getTime()
        const maxMs = (preOrderSettings.maxAdvanceHours ?? 72) * 60 * 60 * 1000
        const minMs = (preOrderSettings.minAdvanceMinutes ?? 30) * 60 * 1000
        if (msAhead > maxMs) {
          return apiError.badRequest(`Cannot schedule more than ${preOrderSettings.maxAdvanceHours ?? 72} hours ahead`, ERROR_CODES.VALIDATION_ERROR)
        }
        if (msAhead < minMs) {
          return apiError.badRequest(`Must be at least ${preOrderSettings.minAdvanceMinutes ?? 30} minutes in the future`, ERROR_CODES.VALIDATION_ERROR)
        }
      }
    }

    // Snapshot the inclusive tax rate for drafts AND full orders (derive once, use in both paths)
    const draftInclusiveTaxRateRaw = (locSettings as any)?.tax?.inclusiveTaxRate
    const draftInclusiveTaxRate = draftInclusiveTaxRateRaw != null && Number.isFinite(draftInclusiveTaxRateRaw) && draftInclusiveTaxRateRaw > 0
      ? draftInclusiveTaxRateRaw / 100 : 0

    // Snapshot the exclusive tax rate (survives mid-day rate changes)
    const draftExclusiveTaxRateRaw = (locSettings as any)?.tax?.defaultRate
    const draftExclusiveTaxRate = draftExclusiveTaxRateRaw != null && Number.isFinite(draftExclusiveTaxRateRaw) && draftExclusiveTaxRateRaw > 0
      ? draftExclusiveTaxRateRaw / 100 : 0

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
            await tx.$queryRaw`SELECT id FROM "Table" WHERE id = ${tableId} FOR UPDATE`
            // TX-KEEP: LOCK — find active order on table inside FOR UPDATE lock to prevent double-claim
            const existingOrder = await tx.order.findFirst({
              where: {
                tableId,
                locationId,
                status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
                deletedAt: null,
              },
              select: { id: true, orderNumber: true, version: true },
            })
            if (existingOrder) {
              throw { code: 'TABLE_OCCUPIED', data: existingOrder }
            }
          }

          // Advisory lock on locationId hash to serialize order number generation
          // This works even when there are zero rows (unlike FOR UPDATE which only locks existing rows)
          const lockKey = Math.abs(locationId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0))
          const [{ acquired }] = await tx.$queryRaw<[{ acquired: boolean }]>`SELECT pg_try_advisory_xact_lock(${lockKey}) as acquired`
          if (!acquired) {
            throw new Error('ORDER_CREATION_BUSY')
          }

          const lastOrderRows = await tx.$queryRaw<{ orderNumber: number }[]>`
            SELECT "orderNumber" FROM "Order" WHERE "locationId" = ${locationId} AND "parentOrderId" IS NULL AND "businessDayDate" = ${businessDayStart.toISOString()}::timestamp ORDER BY "orderNumber" DESC LIMIT 1
          `
          const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

          // TX-KEEP: CREATE — draft order shell inside advisory lock; no repo create method
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
              inclusiveTaxRate: draftInclusiveTaxRate,
              exclusiveTaxRate: draftExclusiveTaxRate,
              tipTotal: 0,
              total: 0,
              commissionTotal: 0,
              source: orderSource,
              notes: notes || null,
              customFields: customFields ? (customFields as Prisma.InputJsonValue) : Prisma.JsonNull,
              businessDayDate: businessDayStart,
              idempotencyKey: idempotencyKey || null,
              isTraining: orderIsTraining,
              ...cellularMutationFields,
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

      // Stamp fulfillmentMode if provided (fire-and-forget)
      if (fulfillmentMode) {
        void db.$executeRaw`
          UPDATE "Order" SET "fulfillmentMode" = ${fulfillmentMode} WHERE id = ${order.id}
        `.catch(err => log.warn({ err }, 'Background task failed'))
      }

      // Auto-assign pager if requested (fire-and-forget)
      if (assignPager) {
        void (async () => {
          try {
            const assignResult: any[] = await db.$queryRaw`
              WITH device AS (
                SELECT id, "deviceNumber", "providerId"
                FROM "NotificationDevice"
                WHERE "locationId" = ${locationId}
                  AND "deviceType" = 'pager'
                  AND status = 'available'
                  AND "deletedAt" IS NULL
                ORDER BY "deviceNumber"::int ASC NULLS LAST, "deviceNumber" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
              ), updated_device AS (
                UPDATE "NotificationDevice" d
                SET status = 'assigned',
                    "assignedToSubjectType" = 'order',
                    "assignedToSubjectId" = ${order.id},
                    "assignedAt" = CURRENT_TIMESTAMP,
                    "updatedAt" = CURRENT_TIMESTAMP
                FROM device
                WHERE d.id = device.id
                RETURNING d.id, d."deviceNumber", d."providerId"
              )
              SELECT * FROM updated_device
            `
            if (assignResult.length > 0) {
              const pNum = assignResult[0].deviceNumber
              // Create target assignment
              await db.$executeRaw`
                INSERT INTO "NotificationTargetAssignment" (
                  id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
                  "providerId", "isPrimary", source, status,
                  "assignedAt", "createdAt", "updatedAt"
                ) VALUES (
                  gen_random_uuid()::text, ${locationId}, 'order', ${order.id}, 'guest_pager', ${pNum},
                  ${assignResult[0].providerId}, true, 'auto_assign', 'active',
                  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
              `
              // Sync cache
              await db.$executeRaw`
                UPDATE "Order" SET "pagerNumber" = ${pNum} WHERE id = ${order.id}
              `
              // Log device event
              void db.$executeRaw`
                INSERT INTO "NotificationDeviceEvent" (id, "deviceId", "locationId", "eventType", "subjectType", "subjectId", metadata, "createdAt")
                 VALUES (gen_random_uuid()::text, ${assignResult[0].id}, ${locationId}, 'assigned', 'order', ${order.id}, '{"autoAssign":true}'::jsonb, CURRENT_TIMESTAMP)
              `.catch(err => log.warn({ err }, 'Background task failed'))
            }
          } catch (pagerErr) {
            console.warn('[Orders] Auto-assign pager failed:', pagerErr)
          }
        })()
      }

      // Stamp scheduledFor for pre-orders (fire-and-forget, column added by migration 027)
      if (scheduledForDate) {
        void db.$executeRaw`
          UPDATE "Order" SET "scheduledFor" = ${scheduledForDate} WHERE id = ${order.id}
        `.catch(err => log.warn({ err }, 'Background task failed'))
      }

      // Fire-and-forget audit log
      db.auditLog.create({
        data: {
          locationId,
          employeeId,
          action: scheduledForDate ? 'order_scheduled' : 'order_draft_created',
          entityType: 'order',
          entityId: order.id,
          details: {
            orderNumber: order.orderNumber, orderType, tableId: tableId || null,
            ...(scheduledForDate ? { scheduledFor: scheduledForDate.toISOString() } : {}),
          },
        },
      }).catch(err => log.warn({ err }, 'fire-and-forget failed in orders'))
      void emitOrderEvent(locationId, order.id, 'ORDER_CREATED', {
        locationId,
        employeeId,
        orderType,
        tableId: tableId || null,
        guestCount: initialSeatCount,
        orderNumber: order.orderNumber,
        displayNumber: null,
      })

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
              // TODO: migrate to OrderRepository — bottleServiceTierId is a relational FK not in OrderUpdateManyMutationInput
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
      return ok({
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
      })
    }

    // === STANDARD PATH: Full order creation with items ===

    // Validate items input (count, prices, quantities, weights, modifiers, pizza, lineItemId uniqueness)
    const { validateAddItemsInput } = await import('@/lib/domain/order-items/validation')
    const inputValidation = validateAddItemsInput(items as AddItemInput[])
    if (!inputValidation.valid) {
      return apiError.badRequest(inputValidation.error, ERROR_CODES.VALIDATION_ERROR)
    }

    // Order number + table check handled atomically inside order creation transaction below

    // Fetch menu items to get commission settings
    // TODO: Add MenuItemRepository.getMenuItemsByIds() for batch ID lookups with custom select
    const menuItemIds = items.map(item => item.menuItemId)
    // TODO: Add MenuItemRepository.getMenuItemsByIds() for batch ID lookups with custom select
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds }, locationId },
      select: { id: true, commissionType: true, commissionValue: true, category: { select: { categoryType: true } }, tipExempt: true },
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
        addedByEmployeeId: employeeId, // Track who added each item
        specialNotes: item.specialNotes || null,
        seatNumber: item.seatNumber || null,
        courseNumber: item.courseNumber || null,
        isHeld: item.isHeld || false,
        delayMinutes: item.delayMinutes || null,
        // Pour size (liquor)
        pourSize: item.pourSize || null,
        pourMultiplier: item.pourMultiplier ?? null,
        // Timed rental / entertainment fields
        blockTimeMinutes: item.blockTimeMinutes || null,
        // Weight-based pricing fields
        soldByWeight: item.soldByWeight || false,
        weight: item.weight ?? null,
        weightUnit: item.weightUnit ?? null,
        unitPrice: item.unitPrice ?? null,
        grossWeight: item.grossWeight ?? null,
        tareWeight: item.tareWeight ?? null,
        ...({ tipExempt: (menuItem as any)?.tipExempt ?? false } as any),
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
            // Open Entry fields
            isCustomEntry: mod.isCustomEntry || false,
            customEntryName: mod.customEntryName || null,
            customEntryPrice: mod.customEntryPrice ?? null,
            // None selection
            isNoneSelection: mod.isNoneSelection || false,
            noneShowOnReceipt: mod.noneShowOnReceipt ?? false,
            // Swap fields
            swapTargetName: mod.swapTargetName || null,
            swapTargetItemId: mod.swapTargetItemId || null,
            swapPricingMode: mod.swapPricingMode || null,
            swapEffectivePrice: mod.swapEffectivePrice ?? null,
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
    // Uses 5-minute TTL cache to avoid hitting DB on every order creation
    const [taxRules, allCategories] = await Promise.all([
      getCachedInclusiveTaxRules(locationId),
      getCachedCategories(locationId),
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

    // Snapshot the inclusive tax rate for this order — survives location setting changes
    const orderInclusiveTaxRateRaw = (locationSettings as any)?.tax?.inclusiveTaxRate
    const orderInclusiveTaxRate = orderInclusiveTaxRateRaw != null && Number.isFinite(orderInclusiveTaxRateRaw) && orderInclusiveTaxRateRaw > 0
      ? orderInclusiveTaxRateRaw / 100 : 0

    // Snapshot the exclusive tax rate for this order — survives mid-day rate changes
    const orderExclusiveTaxRateRaw = (locationSettings as any)?.tax?.defaultRate
    const orderExclusiveTaxRate = orderExclusiveTaxRateRaw != null && Number.isFinite(orderExclusiveTaxRateRaw) && orderExclusiveTaxRateRaw > 0
      ? orderExclusiveTaxRateRaw / 100 : 0

    // Compute per-channel convenience fee from settings + order source
    const orderConvenienceFee = getConvenienceFeeForChannel(orderSource, parsedSettings?.convenienceFees)

    // Use centralized calculation function (single source of truth)
    // Use totals.subtotal instead of the accumulated `subtotal` to avoid floating-point drift
    const totals = calculateOrderTotals(items, locationSettings, 0, 0, parsedSettings?.priceRounding ?? undefined, 'card', undefined, orderInclusiveTaxRate || undefined, orderConvenienceFee)
    const { subtotal: roundedSubtotal, taxTotal, taxFromInclusive, taxFromExclusive, total } = totals

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
          await tx.$queryRaw`SELECT id FROM "Table" WHERE id = ${tableId} FOR UPDATE`
          // TX-KEEP: LOCK — find active order on table inside FOR UPDATE lock to prevent double-claim
          const existingOrder = await tx.order.findFirst({
            where: {
              tableId,
              locationId,
              status: { in: ['draft', 'open', 'in_progress', 'sent', 'split'] },
              deletedAt: null,
            },
            select: { id: true, orderNumber: true, version: true },
          })
          if (existingOrder) {
            throw { code: 'TABLE_OCCUPIED', data: existingOrder }
          }
        }

        // Advisory lock on locationId hash to serialize order number generation
        // This works even when there are zero rows (unlike FOR UPDATE which only locks existing rows)
        const lockKey = Math.abs(locationId.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0))
        const [{ acquired }] = await tx.$queryRaw<[{ acquired: boolean }]>`SELECT pg_try_advisory_xact_lock(${lockKey}) as acquired`
        if (!acquired) {
          throw new Error('ORDER_CREATION_BUSY')
        }

        const lastOrderRows = await tx.$queryRaw<{ orderNumber: number }[]>`
          SELECT "orderNumber" FROM "Order" WHERE "locationId" = ${locationId} AND "parentOrderId" IS NULL AND "businessDayDate" = ${businessDayStart.toISOString()}::timestamp ORDER BY "orderNumber" DESC LIMIT 1
        `
        const orderNumber = ((lastOrderRows as any[])[0]?.orderNumber ?? 0) + 1

        // Server-side required modifier group validation (safety net — clients already validate)
        const modGroupError = await validateRequiredModifierGroups(tx, items as AddItemInput[])
        if (modGroupError) {
          throw new Error(
            `REQUIRED_MODIFIER_MISSING:${modGroupError.itemName}:${modGroupError.groupName}` +
            `:requires ${modGroupError.minSelections}, got ${modGroupError.actualSelections}`
          )
        }

        // TX-KEEP: CREATE — full order with nested items/modifiers inside advisory lock; no repo create method
        const created = await tx.order.create({
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
            subtotal: roundedSubtotal,
            discountTotal: 0,
            taxTotal,
            taxFromInclusive,
            taxFromExclusive,
            inclusiveTaxRate: orderInclusiveTaxRate,
            exclusiveTaxRate: orderExclusiveTaxRate,
            tipTotal: 0,
            total,
            commissionTotal,
            convenienceFee: orderConvenienceFee || null,
            source: orderSource,
            itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
            notes: notes || null,
            customFields: customFields ? (customFields as Prisma.InputJsonValue) : Prisma.JsonNull,
            businessDayDate: businessDayStart,
            idempotencyKey: idempotencyKey || null,
            isTraining: orderIsTraining,
            ...cellularMutationFields,
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

        // Queue critical socket events in the outbox (atomic with order creation)
        const totalsPayload: OrderTotalsUpdatedPayload = {
          orderId: created.id,
          totals: {
            subtotal: roundedSubtotal,
            taxTotal,
            tipTotal: 0,
            discountTotal: 0,
            total,
            commissionTotal,
          },
          timestamp: new Date().toISOString(),
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_TOTALS_UPDATED, totalsPayload)

        const listChangedPayload: OrdersListChangedPayload = {
          trigger: 'created',
          orderId: created.id,
          tableId: tableId || undefined,
        }
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDERS_LIST_CHANGED, listChangedPayload)

        const summaryPayload: OrderSummaryUpdatedPayload = buildOrderSummary(created)
        await queueSocketEvent(tx, locationId, SOCKET_EVENTS.ORDER_SUMMARY_UPDATED, summaryPayload)

        return created
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

    // Transaction committed — flush outbox (fire-and-forget, catch-up handles failures)
    flushOutboxSafe(locationId)

    timing.end('db', 'Order create with items')

    // Stamp scheduledFor for pre-orders (fire-and-forget, column added by migration 027)
    if (scheduledForDate) {
      void db.$executeRaw`
        UPDATE "Order" SET "scheduledFor" = ${scheduledForDate} WHERE id = ${order.id}
      `.catch(err => log.warn({ err }, 'Background task failed'))
    }

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
            // TODO: migrate to OrderRepository — bottleServiceTierId is a relational FK not in OrderUpdateManyMutationInput
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

    // Audit log: order created (fire-and-forget — non-critical, don't block response)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId,
        action: scheduledForDate ? 'order_scheduled' : 'order_created',
        entityType: 'order',
        entityId: order.id,
        details: {
          orderNumber: order.orderNumber,
          orderType,
          tableId: tableId || null,
          tabName: tabName || null,
          itemCount: items.length,
          ...(scheduledForDate ? { scheduledFor: scheduledForDate.toISOString() } : {}),
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))
    if (fulfillmentMode) {
      void db.$executeRaw`
        UPDATE "Order" SET "fulfillmentMode" = ${fulfillmentMode} WHERE id = ${order.id}
      `.catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Notification Platform: auto-assign pager for full order (fire-and-forget)
    if (assignPager) {
      void (async () => {
        try {
          const assignResult: any[] = await db.$queryRaw`
            WITH device AS (
              SELECT id, "deviceNumber", "providerId"
              FROM "NotificationDevice"
              WHERE "locationId" = ${locationId}
                AND "deviceType" = 'pager'
                AND status = 'available'
                AND "deletedAt" IS NULL
              ORDER BY "deviceNumber"::int ASC NULLS LAST, "deviceNumber" ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            ), updated_device AS (
              UPDATE "NotificationDevice" d
              SET status = 'assigned',
                  "assignedToSubjectType" = 'order',
                  "assignedToSubjectId" = ${order.id},
                  "assignedAt" = CURRENT_TIMESTAMP,
                  "updatedAt" = CURRENT_TIMESTAMP
              FROM device
              WHERE d.id = device.id
              RETURNING d.id, d."deviceNumber", d."providerId"
            )
            SELECT * FROM updated_device
          `
          if (assignResult.length > 0) {
            const pNum = assignResult[0].deviceNumber
            await db.$executeRaw`
              INSERT INTO "NotificationTargetAssignment" (
                id, "locationId", "subjectType", "subjectId", "targetType", "targetValue",
                "providerId", "isPrimary", source, status,
                "assignedAt", "createdAt", "updatedAt"
              ) VALUES (
                gen_random_uuid()::text, ${locationId}, 'order', ${order.id}, 'guest_pager', ${pNum},
                ${assignResult[0].providerId}, true, 'auto_assign', 'active',
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
              )
            `
            await db.$executeRaw`
              UPDATE "Order" SET "pagerNumber" = ${pNum} WHERE id = ${order.id}
            `
          }
        } catch (pagerErr) {
          console.warn('[Orders] Full-order auto-assign pager failed:', pagerErr)
        }
      })()
    }

    // Queue for Neon replay if in outage mode (fire-and-forget)
    if (isInOutageMode()) {
      void queueOutageWrite('Order', order.id, 'INSERT', order, locationId).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Emit ORDER_CREATED + ITEM_ADDED events (fire-and-forget)
    void emitOrderEvents(locationId, order.id, [
      {
        type: 'ORDER_CREATED',
        payload: {
          locationId,
          employeeId,
          orderType,
          tableId: tableId || null,
          guestCount: order.guestCount,
          orderNumber: order.orderNumber,
          displayNumber: null,
        },
      },
      ...order.items.map((item: any) => ({
        type: 'ITEM_ADDED' as const,
        payload: {
          lineItemId: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          priceCents: Math.round(Number(item.price) * 100),
          quantity: item.quantity,
          employeeId, // WHO added this item
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
          isHeld: item.isHeld || false,
          soldByWeight: item.soldByWeight || false,
          isTaxInclusive: item.isTaxInclusive ?? false,
          pourSize: item.pourSize || null,
          pourMultiplier: item.pourMultiplier ? Number(item.pourMultiplier) : null,
        },
      })),
    ])

    // Use mapper for complete response with correlationId support
    const response = {
      ...mapOrderForResponse(order),
      items: order.items.map((item: any, index: number) =>
        mapOrderItemForResponse(item, items[index]?.correlationId)
      ),
    }

    // ORDER_TOTALS_UPDATED, ORDERS_LIST_CHANGED, and ORDER_SUMMARY_UPDATED are
    // now queued in the transactional outbox above — crash-safe, flushed after commit.

    // Floor plan update remains fire-and-forget (non-critical UI event)
    if (tableId) {
      dispatchFloorPlanUpdate(locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
    }

    // Trigger upstream sync (fire-and-forget, debounced)
    pushUpstream()

    return ok(response)
  } catch (error) {
    // Handle required modifier validation errors (thrown inside transaction)
    const message = error instanceof Error ? error.message : ''
    if (message.startsWith('REQUIRED_MODIFIER_MISSING:')) {
      const parts = message.replace('REQUIRED_MODIFIER_MISSING:', '').split(':')
      const itemName = parts[0]
      const groupName = parts[1]
      return err(`Required modifier group "${groupName}" is not satisfied for item "${itemName}"`)
    }

    if (message === 'ORDER_CREATION_BUSY') {
      return err('Order creation is busy — please try again', 409)
    }

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
    }).catch(err => {
      log.warn({ err }, 'error event logging failed during order creation')
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
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50))
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0)

    // T-078 admin filters
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const balanceFilter = searchParams.get('balanceFilter') // 'zero' | 'nonzero' | omit
    const includeRolledOver = searchParams.get('includeRolledOver') === 'true'

    if (!locationId) {
      return err('Location ID is required')
    }

    // Auth check — require POS access
    const requestingEmployeeId = request.headers.get('x-employee-id') || searchParams.get('requestingEmployeeId')
    const auth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.POS_ACCESS)
    if (!auth.authorized) return err(auth.error, auth.status)
    // Viewing another employee's orders requires explicit permission
    if (employeeId && requestingEmployeeId && employeeId !== requestingEmployeeId) {
      const othersAuth = await requirePermission(requestingEmployeeId, locationId, PERMISSIONS.POS_VIEW_OTHERS_ORDERS)
      if (!othersAuth.authorized) return err(othersAuth.error, othersAuth.status)
    }

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

    // TODO: add repository method for filtered order listing (status + employee + date range + balance + includes)
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

    return ok({
      orders: orders.map(order => ({
        ...mapOrderForResponse(order),
        // Add summary fields for list view
        itemCount: order.itemCount,
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
      })),
    })
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
    }).catch(err => {
      log.warn({ err }, 'error event logging failed during order fetch')
    })

    return err('Failed to fetch orders', 500)
  }
})

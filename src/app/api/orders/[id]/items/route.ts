import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mapOrderForResponse } from '@/lib/api/order-response-mapper'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchTabItemsUpdated, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { calculateIngredientCosts, calculateVariantCost } from '@/lib/inventory/recipe-costing'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { evaluateAutoDiscounts } from '@/lib/auto-discount-engine'
import { checkOrderClaim } from '@/lib/order-claim'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { getCachedInclusiveTaxRules, getCachedCategories } from '@/lib/tax-cache'
import { OrderRepository, OrderItemRepository } from '@/lib/repositories'
import { getLocationId } from '@/lib/location-cache'
import {
  type AddItemInput,
  validateAddItemsInput,
  validateOrderStatusForAdd,
  validateNoActivePayments,
  validateMenuItemAvailabilityForAdd,
  prepareAllItemsData,
  deriveTaxInclusiveSettings,
  hasOpenPricedItems,
  overrideModifierPrices,
  createOrderItem,
  validateComboComponents,
  fetchModifierPrices,
  validateRequiredModifierGroups,
  recalculateOrderTotalsForAdd,
  recalculateParentOrderTotals,
  // Combo Pick N of M (Phase 5)
  validateAndBuildComboSelections,
  ComboValidationError,
  ORDER_ITEM_FULL_INCLUDE,
  mapOrderItemForWire,
  type ComboSelectionInput,
} from '@/lib/domain/order-items'
import { createChildLogger } from '@/lib/logger'
import { err, ok } from '@/lib/api-response'
const log = createChildLogger('orders-items')

// ── Zod schema for POST /api/orders/[id]/items ──────────────────────
const AddItemModifierSchema = z.object({
  modifierId: z.string().min(1),
  name: z.string().min(1),
  price: z.number(),
  preModifier: z.string().nullable().optional(),
  depth: z.number().int().nonnegative().optional(),
  spiritTier: z.string().nullable().optional(),
  linkedBottleProductId: z.string().nullable().optional(),
  parentModifierId: z.string().nullable().optional(),
  isCustomEntry: z.boolean().optional(),
  customEntryName: z.string().nullable().optional(),
  customEntryPrice: z.number().nullable().optional(),
  isNoneSelection: z.boolean().optional(),
  noneShowOnReceipt: z.boolean().optional(),
  swapTargetName: z.string().nullable().optional(),
  swapTargetItemId: z.string().nullable().optional(),
  swapPricingMode: z.string().nullable().optional(),
  swapEffectivePrice: z.number().nullable().optional(),
}).passthrough()

const ComboSelectionInputSchema = z.object({
  id: z.string().nullable().optional(),
  comboComponentId: z.string().nullable().optional(),
  comboComponentOptionId: z.string().nullable().optional(),
  menuItemId: z.string().nullable().optional(),
  optionName: z.string().nullable().optional(),
  upchargeApplied: z.number().nullable().optional(),
  sortIndex: z.number().int().nullable().optional(),
}).passthrough()

const AddItemSchema = z.object({
  menuItemId: z.string().min(1),
  name: z.string().min(1),
  price: z.number(),
  quantity: z.number().int().positive(),
  modifiers: z.array(AddItemModifierSchema).optional(),
  specialNotes: z.string().max(500).nullable().optional(),
  seatNumber: z.number().int().nonnegative().nullable().optional(),
  courseNumber: z.number().int().nonnegative().nullable().optional(),
  isHeld: z.boolean().optional(),
  soldByWeight: z.boolean().optional(),
  weight: z.number().nullable().optional(),
  weightUnit: z.string().nullable().optional(),
  unitPrice: z.number().nullable().optional(),
  grossWeight: z.number().nullable().optional(),
  tareWeight: z.number().nullable().optional(),
  pricingOptionId: z.string().nullable().optional(),
  pricingOptionLabel: z.string().nullable().optional(),
  pourSize: z.string().nullable().optional(),
  pourMultiplier: z.number().nullable().optional(),
  correlationId: z.string().optional(),
  blockTimeMinutes: z.number().nullable().optional(),
  pizzaConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  ingredientModifications: z.array(z.record(z.string(), z.unknown())).optional(),
  // Combo Pick N of M (Phase 5) — customer-pick snapshots
  comboSelections: z.array(ComboSelectionInputSchema).nullable().optional(),
}).passthrough()

const AddItemsBodySchema = z.object({
  items: z.array(AddItemSchema).min(1, 'At least one item is required'),
  // Accept idempotencyKey from body; Android sends it via HTTP header instead,
  // so we fall back to the Idempotency-Key header below if body field is missing.
  idempotencyKey: z.string().min(1).optional(),
  requestingEmployeeId: z.string().optional(),
}).passthrough()

/**
 * Calculate cost-at-sale for multiple order items in batch (fire-and-forget).
 * Uses two bulk queries (menuItems + pricingOptions) instead of N+1 per-item queries.
 * Returns a Map of orderItemId → cost for items that have recipe/cost data.
 */
async function calculateCostAtSaleBatch(
  items: Array<{ id: string; menuItemId: string; pricingOptionId: string | null }>
): Promise<Map<string, number>> {
  const results = new Map<string, number>()
  if (items.length === 0) return results

  const menuItemIds = [...new Set(items.map(i => i.menuItemId))]
  const pricingOptionIds = [...new Set(items.filter(i => i.pricingOptionId).map(i => i.pricingOptionId!))]

  // Batch fetch all menu items with recipe data (single query instead of N)
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: menuItemIds } },
    select: {
      id: true,
      recipe: {
        select: {
          ingredients: {
            select: {
              quantity: true,
              unit: true,
              inventoryItem: {
                select: { storageUnit: true, costPerUnit: true, yieldCostPerUnit: true },
              },
              prepItem: {
                select: { costPerUnit: true },
              },
            },
          },
        },
      },
      recipeIngredients: {
        where: { deletedAt: null },
        select: {
          pourCount: true,
          bottleProduct: {
            select: { pourCost: true },
          },
        },
      },
    },
  })
  const menuItemMap = new Map(menuItems.map(mi => [mi.id, mi]))

  // Batch fetch all pricing options with inventory links (single query instead of N)
  const pricingOptionMap = new Map<string, (typeof pricingOptions)[number]>()
  const pricingOptions = pricingOptionIds.length > 0
    ? await db.pricingOption.findMany({
        where: { id: { in: pricingOptionIds } },
        select: {
          id: true,
          inventoryLinks: {
            where: { deletedAt: null },
            select: {
              usageQuantity: true,
              usageUnit: true,
              inventoryItem: {
                select: { storageUnit: true, costPerUnit: true, yieldCostPerUnit: true },
              },
              prepItem: {
                select: { costPerUnit: true },
              },
            },
          },
        },
      })
    : []
  for (const opt of pricingOptions) {
    pricingOptionMap.set(opt.id, opt)
  }

  // Calculate costs from pre-fetched data (pure computation, no DB queries)
  for (const item of items) {
    const menuItem = menuItemMap.get(item.menuItemId)
    if (!menuItem) continue

    let baseCost = 0

    // Food recipe cost
    if (menuItem.recipe?.ingredients?.length) {
      const { totalCost } = calculateIngredientCosts(menuItem.recipe.ingredients)
      baseCost += totalCost
    }

    // Liquor recipe cost (from Liquor Builder)
    if (menuItem.recipeIngredients?.length) {
      for (const ri of menuItem.recipeIngredients) {
        const pourCost = ri.bottleProduct?.pourCost ? Number(ri.bottleProduct.pourCost) : 0
        const pourCount = Number(ri.pourCount) || 1
        baseCost += pourCost * pourCount
      }
    }

    if (baseCost === 0 && !item.pricingOptionId) continue

    // Pricing option inventory link costs (additive on top of base)
    if (item.pricingOptionId) {
      const option = pricingOptionMap.get(item.pricingOptionId)
      if (option?.inventoryLinks?.length) {
        const { totalCost } = calculateVariantCost(baseCost, option.inventoryLinks)
        results.set(item.id, totalCost)
        continue
      }
    }

    if (baseCost > 0) {
      results.set(item.id, baseCost)
    }
  }

  return results
}

/**
 * POST /api/orders/[id]/items
 *
 * Appends new items to an existing order atomically.
 * This avoids race conditions that occur when multiple terminals
 * try to add items simultaneously using PUT (which replaces all items).
 *
 * Each item is added in a transaction and totals are recalculated
 * based on the current database state, not client-provided totals.
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const rawBody = await request.json()
    const parseResult = AddItemsBodySchema.safeParse(rawBody)
    if (!parseResult.success) {
      return apiError.badRequest(
        `Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        ERROR_CODES.VALIDATION_ERROR,
      )
    }
    const body = parseResult.data
    const { items, requestingEmployeeId } = body as { items: AddItemInput[], idempotencyKey?: string, requestingEmployeeId?: string }

    // Resolve idempotencyKey: prefer body field, fall back to HTTP header (Android sends it there).
    // Android's AuthInterceptor always adds Idempotency-Key header on POST/PUT/PATCH/DELETE.
    const idempotencyKey = body.idempotencyKey || request.headers.get('idempotency-key')
    if (!idempotencyKey) {
      return apiError.badRequest(
        'idempotencyKey is required to prevent duplicate items. Send in body or Idempotency-Key header.',
        ERROR_CODES.VALIDATION_ERROR,
      )
    }

    // Validate items input (count, prices, quantities, weights, modifiers, pizza)
    const inputValidation = validateAddItemsInput(items)
    if (!inputValidation.valid) {
      return apiError.badRequest(inputValidation.error, ERROR_CODES.VALIDATION_ERROR)
    }

    // Resolve locationId for tenant-safe queries
    const locationId = await getLocationId()
    if (!locationId) {
      return apiError.badRequest('Location not found', ERROR_CODES.VALIDATION_ERROR)
    }

    // HA cellular sync — detect mutation origin for downstream sync
    const isCellular = request.headers.get('x-cellular-authenticated') === '1'
    const mutationOrigin = isCellular ? 'cloud' : 'local'

    // Cellular ownership gating — block mutation of locally-owned orders
    if (isCellular) {
      const { validateCellularOrderAccess, CellularAuthError } = await import('@/lib/cellular-validation')
      try {
        await validateCellularOrderAccess(true, orderId, 'mutate', db)
      } catch (caughtErr) {
        if (caughtErr instanceof CellularAuthError) {
          return err(caughtErr.message, caughtErr.status)
        }
        throw caughtErr
      }
    }

    // Pre-fetch all needed menu item fields in a single query (used for both price validation AND inside the transaction).
    // This merges the two separate menuItem queries that previously ran: one for price check (id, price) and
    // one inside the transaction for commission/availability (id, price, commissionType, commissionValue, ...).
    const allMenuItemIds = items.map((i: AddItemInput) => i.menuItemId)
    const prefetchedMenuItems = await db.menuItem.findMany({
      where: { id: { in: allMenuItemIds } },
      select: {
        id: true,
        price: true,
        commissionType: true,
        commissionValue: true,
        itemType: true,
        isAvailable: true,
        isActive: true,
        deletedAt: true,
        name: true,
        categoryId: true,
        category: { select: { categoryType: true } },
        tipExempt: true,
      },
    })

    // FAIL FAST: Validate menu item availability before any mutations.
    // Rejects with 409 if ANY items are deleted, inactive, or 86'd.
    // This prevents silent "[Deleted Item]" ghost orders when kitchen 86's mid-service.
    const availabilityCheck = validateMenuItemAvailabilityForAdd(allMenuItemIds, prefetchedMenuItems)
    if (!availabilityCheck.valid) {
      return apiError.conflict(
        availabilityCheck.error,
        ERROR_CODES.ITEM_UNAVAILABLE,
        availabilityCheck.details
      )
    }

    // Pre-fetch pricing options once (used for both permission validation AND price enforcement in transaction)
    const allPricableItems = items.filter((i: AddItemInput) => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)
    const allPricingOptionIds = [...new Set(allPricableItems.filter((i: AddItemInput) => i.pricingOptionId).map((i: AddItemInput) => i.pricingOptionId!))]
    const prefetchedPricingOptions = allPricingOptionIds.length > 0
      ? await db.pricingOption.findMany({
          where: { id: { in: allPricingOptionIds } },
          select: { id: true, price: true },
        })
      : []

    // Auth checks — fetch order metadata once for all permission guards (tenant-safe)
    if (requestingEmployeeId) {
      const orderMeta = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
        employeeId: true, locationId: true,
      })

      // Guard: editing another employee's order requires pos.edit_others_orders
      if (orderMeta?.employeeId && orderMeta.employeeId !== requestingEmployeeId) {
        const auth = await requirePermission(requestingEmployeeId, orderMeta.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
        if (!auth.authorized) return err(auth.error, auth.status)
      }

      // Guard: custom-priced items require manager.open_items
      // Skip for weight-based, pizza, and timed-rental items whose prices are inherently dynamic
      if (orderMeta) {
        const pricableItems = items.filter((i: AddItemInput) => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)
        if (pricableItems.length > 0) {
          // Re-use prefetched menuItems + pricingOptions (hoisted before transaction)
          const menuItemPrices = new Map(prefetchedMenuItems.map(m => [m.id, Number(m.price)]))
          const pricingOptionPrices = new Map(prefetchedPricingOptions.map(p => [p.id, Number(p.price)]))

          if (hasOpenPricedItems(items, menuItemPrices, pricingOptionPrices)) {
            const auth = await requirePermission(requestingEmployeeId, orderMeta.locationId, PERMISSIONS.MGR_OPEN_ITEMS)
            if (!auth.authorized) return err(auth.error, auth.status)
          }
        }
      }
    }

    // Order claim check — block if another employee has an active claim
    if (requestingEmployeeId) {
      const terminalId = request.headers.get('x-terminal-id')
      const claimBlock = await checkOrderClaim(db, orderId, requestingEmployeeId, terminalId)
      if (claimBlock) {
        return NextResponse.json(
          { error: claimBlock.error, claimedBy: claimBlock.claimedBy },
          { status: claimBlock.status }
        )
      }
    }

    // Use a transaction to ensure atomic append
    const result = await db.$transaction(async (tx) => {
      // Idempotency check — if this key was already processed, return current order
      // This prevents duplicate item additions on retried requests (e.g., WiFi stutter → Android retry).
      // The idempotencyKey must be unique per request attempt and remain stable across retries.
      const existing = await tx.orderItem.findMany({
        where: { orderId, idempotencyKey, deletedAt: null },
      })
      if (existing.length > 0) {
        // Return early from transaction with the current order state
        const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          items: {
            where: { deletedAt: null },
            include: ORDER_ITEM_FULL_INCLUDE,
          },
        }, tx)
        if (!order) throw new Error('Order not found')
        return { idempotencyMatch: true, order }
      }
      // Lock the order row to prevent concurrent modifications (FOR UPDATE)
      const [lockedOrder] = await tx.$queryRaw<any[]>`
        SELECT id, status, "tabStatus" FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `

      if (!lockedOrder) {
        throw new Error('Order not found')
      }

      // Validate order status via domain
      const statusCheck = validateOrderStatusForAdd(lockedOrder.status)
      if (!statusCheck.valid) throw new Error(statusCheck.error)

      // Block item additions while tab is being closed (race between Phase 1 tabStatus='closing' and Phase 3 capture)
      if (lockedOrder.tabStatus === 'closing') {
        throw new Error('TAB_CLOSING')
      }

      // Get order data with only the fields needed downstream (row is already locked within this tx)
      const existingOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        location: { select: { settings: true, timezone: true } },
        items: {
          select: { kitchenStatus: true },
        },
        payments: {
          where: { deletedAt: null },
          select: { id: true, status: true },
        },
      }, tx)

      if (!existingOrder) {
        throw new Error('Order not found')
      }

      // Block modifications if any active (pending or completed) payment exists
      const paymentCheck = validateNoActivePayments(existingOrder.payments)
      if (!paymentCheck.valid) throw new Error(paymentCheck.error)

      // Promote businessDayDate to current business day when items are added
      try {
        const locSettings = existingOrder.location.settings as Record<string, unknown> | null
        const dayStartTime = (locSettings?.businessDay as Record<string, unknown> | null)?.dayStartTime as string | undefined ?? '04:00'
        // TZ-FIX: Pass venue timezone so Vercel (UTC) computes correct business day
        const itemTz = existingOrder.location.timezone || 'America/New_York'
        const businessDayStart = getCurrentBusinessDay(dayStartTime, itemTz).start

        if (!existingOrder.businessDayDate || existingOrder.businessDayDate < businessDayStart) {
          await OrderRepository.updateOrder(orderId, locationId, { businessDayDate: businessDayStart }, tx)
        }
      } catch (promoErr) {
        console.warn('[BusinessDay] Failed to promote businessDayDate on item add:', promoErr)
      }

      // Use pre-fetched menu items (hoisted before transaction to eliminate duplicate DB query)
      const menuItemIds = items.map(item => item.menuItemId)
      const menuItemsWithCommission = prefetchedMenuItems
      const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))

      // B6: Guard against deleted/missing MenuItems — populate fallback entries so downstream
      // code (event emission, response mapping) never crashes on null reference.
      // NOTE: All items should have been validated as available before entering this transaction,
      // so this fallback should rarely/never execute. If it does, it indicates a race condition
      // (item deleted between validation and transaction start).
      for (const id of menuItemIds) {
        if (!menuItemMap.has(id)) {
          log.error({ menuItemId: id, orderId }, '[RACE CONDITION] MenuItem disappeared between validation and transaction — rejecting order')
          throw new Error(`ITEM_RACE_CONDITION:${id}`)
        }
      }

      // H9: Check if order already has sent items — explicitly set kitchenStatus on new items
      // so they're visible on KDS (default is 'pending' but can be null in edge cases)
      const hasSentItems = existingOrder.items.some(
        i => i.kitchenStatus === 'sent' || i.kitchenStatus === 'cooking' || i.kitchenStatus === 'ready'
      )

      // NOTE: Menu item availability was already validated outside the transaction (FAIL FAST).
      // This includes checks for deleted, inactive, and 86'd items.

      // For combo items, validate component availability via domain
      const comboMenuItems = menuItemsWithCommission.filter(mi => mi.itemType === 'combo')
      const comboError = await validateComboComponents(tx, comboMenuItems.map(c => c.id))
      if (comboError) {
        throw new Error(`${comboError.type}:${comboError.name}`)
      }

      // Server-side modifier price validation via domain
      const modifierPriceMap = await fetchModifierPrices(tx, items)
      overrideModifierPrices(items, modifierPriceMap)

      // Server-side base item price enforcement: override client-sent prices with catalog prices.
      // Weight-based, pizza, and timed-rental items have inherently dynamic prices and are excluded.
      // Items with a pricingOptionId use that option's catalog price instead of the base menu item price.
      // Track price corrections for audit log + socket event.
      const priceCorrectionLog: Array<{
        clientPrice: number
        catalogPrice: number
        menuItemId: string
        menuItemName: string
      }> = []
      {
        const pricableItems = items.filter(i => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)
        if (pricableItems.length > 0) {
          // Re-use prefetched pricing options (hoisted before transaction to eliminate duplicate DB query)
          const pricingOptionPrices = new Map(prefetchedPricingOptions.map(p => [p.id, Number(p.price)]))

          for (const item of pricableItems) {
            // Determine the canonical catalog price (pricing option overrides base price)
            let catalogPrice: number | undefined
            if (item.pricingOptionId) {
              const optPrice = pricingOptionPrices.get(item.pricingOptionId)
              if (optPrice != null) catalogPrice = optPrice
            }
            if (catalogPrice === undefined) {
              const mi = menuItemMap.get(item.menuItemId)
              if (mi) catalogPrice = Number(mi.price)
            }

            if (catalogPrice !== undefined) {
              // Apply pour multiplier (liquor sizing: double, tall, short)
              let expectedPrice = catalogPrice
              if (item.pourMultiplier && item.pourMultiplier !== 1) {
                expectedPrice = Math.round(catalogPrice * item.pourMultiplier * 100) / 100
              }

              // If client price deviates from expected, enforce catalog price.
              // Permission check for open-priced items still happens above when requestingEmployeeId is present.
              if (Math.abs(Math.round(item.price * 100) - Math.round(expectedPrice * 100)) > 1) {
                const clientPrice = item.price
                item.price = expectedPrice
                // Track the correction for audit log + socket event
                priceCorrectionLog.push({
                  clientPrice,
                  catalogPrice: expectedPrice,
                  menuItemId: item.menuItemId,
                  menuItemName: item.name,
                })
              }
            }
          }
        }
      }

      // Server-side required modifier group validation (safety net — clients already validate)
      const modGroupError = await validateRequiredModifierGroups(tx, items)
      if (modGroupError) {
        throw new Error(
          `REQUIRED_MODIFIER_MISSING:${modGroupError.itemName}:${modGroupError.groupName}` +
          `:requires ${modGroupError.minSelections}, got ${modGroupError.actualSelections}`
        )
      }

      // Derive tax-inclusive flags + dual pricing settings via domain
      const locSettings = existingOrder.location.settings
      const parsedSettings = locSettings ? parseSettings(locSettings) : null
      const dualPricingEnabled = parsedSettings?.dualPricing?.enabled ?? false
      const cashDiscountPct = parsedSettings?.dualPricing?.cashDiscountPercent ?? 4.0
      const pricingRules = parsedSettings?.pricingRules ?? []

      // Use cached tax rules + categories (5-min TTL) to avoid DB queries inside transaction
      const [taxRules, allCategories] = await Promise.all([
        getCachedInclusiveTaxRules(existingOrder.locationId),
        getCachedCategories(existingOrder.locationId),
      ])
      const taxIncSettings = deriveTaxInclusiveSettings(taxRules, allCategories)

      // Pre-compute all item data (pure computation via domain)
      const { itemPrepData } = prepareAllItemsData(items, menuItemMap, taxIncSettings)

      // Create all order items in parallel via domain (N+1 fix — concurrent creates)
      const createdItems = await Promise.all(
        itemPrepData.map(prepData =>
          createOrderItem(tx, {
            orderId,
            locationId: existingOrder.locationId,
            prepData,
            dualPricingEnabled,
            cashDiscountPct,
            requestingEmployeeId: requestingEmployeeId || null,
            hasSentItems,
            idempotencyKey, // Now mandatory, always present
            pricingRules,
            mutationOrigin,
          })
        )
      )

      // Combo Pick N of M (Phase 5) — validate + write snapshots for items that carry them.
      // Runs inside the same transaction as item creation so we can still abort on validation error.
      for (let i = 0; i < items.length; i++) {
        const incoming = items[i] as AddItemInput & { comboSelections?: ComboSelectionInput[] | null }
        const created = createdItems[i]
        const comboSelections = incoming.comboSelections
        if (!comboSelections || comboSelections.length === 0) continue

        const comboResult = await validateAndBuildComboSelections({
          prisma: tx,
          locationId: existingOrder.locationId,
          orderItemId: created.id,
          menuItemId: created.menuItemId,
          quantity: created.quantity,
          selections: comboSelections,
        })

        if (comboResult.rowsToCreate.length > 0) {
          await tx.orderItemComboSelection.createMany({
            data: comboResult.rowsToCreate,
          })
        }

        if (comboResult.price != null) {
          // Server-authoritative price: template.basePrice + Σ upcharges.
          // Recompute itemTotal from finalPrice × quantity (quantity must be 1 per validator rule).
          await tx.orderItem.update({
            where: { id: created.id },
            data: {
              price: comboResult.price,
              itemTotal: comboResult.price,
            },
          })
          // Keep the in-memory copy consistent for downstream event emission
          created.price = comboResult.price
          created.itemTotal = comboResult.price
        }
      }

      // Recalculate order totals from current database state via domain
      const totals = await recalculateOrderTotalsForAdd(
        tx, orderId, existingOrder.location.settings,
        Number(existingOrder.tipTotal) || 0, existingOrder.isTaxExempt
      )

      // Update order totals + bump version for concurrency control
      const updatedOrder = await OrderRepository.updateOrderAndReturn(
        orderId, locationId,
        {
          ...totals,
          ...(existingOrder.isBottleService ? { bottleServiceCurrentSpend: totals.subtotal } : {}),
          version: { increment: 1 },
          lastMutatedBy: mutationOrigin,
        },
        {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          items: {
            where: { deletedAt: null },
            include: ORDER_ITEM_FULL_INCLUDE,
          },
        },
        tx,
      ) as any
      if (!updatedOrder) throw new Error('Order not found after update')

      // Audit log: items added
      await tx.auditLog.create({
        data: {
          locationId: existingOrder.locationId,
          employeeId: existingOrder.employeeId,
          action: 'items_added',
          entityType: 'order',
          entityId: orderId,
          details: {
            itemCount: createdItems.length,
            items: createdItems.map((i: any) => ({ name: i.name, quantity: i.quantity, price: Number(i.price) })),
          },
        },
      })

      // Audit log: price corrections (if any occurred)
      for (const correction of priceCorrectionLog) {
        await tx.auditLog.create({
          data: {
            locationId: existingOrder.locationId,
            employeeId: requestingEmployeeId || existingOrder.employeeId,
            action: 'price_corrected',
            entityType: 'order_item',
            entityId: orderId,
            details: {
              menuItemId: correction.menuItemId,
              menuItemName: correction.menuItemName,
              clientPrice: correction.clientPrice,
              catalogPrice: correction.catalogPrice,
              reason: 'stale_client_menu',
            },
          },
        })
      }

      // BUG 3 FIX: If this is a split child order, recalculate parent totals via domain
      if (existingOrder.parentOrderId) {
        await recalculateParentOrderTotals(tx, existingOrder.parentOrderId)
      }

      return { updatedOrder, createdItems, menuItemMap, hasSentItems, priceCorrectionLog }
    })

    // Handle idempotency match — return existing order if already processed
    if ('idempotencyMatch' in result && result.idempotencyMatch) {
      return ok(mapOrderForResponse(result.order))
    }

    // Narrow type: past this point, result is the normal transaction result
    const { updatedOrder, createdItems, menuItemMap, hasSentItems, priceCorrectionLog } = result as {
      updatedOrder: any; createdItems: any[]; menuItemMap: Map<string, any>; hasSentItems: boolean; priceCorrectionLog: any[]
    }

    // Fire-and-forget: check if bar tab or bottle service tab needs auto-increment
    if ((updatedOrder.orderType === 'bar_tab' || updatedOrder.isBottleService) && updatedOrder.preAuthRecordNo) {
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`}/api/orders/${orderId}/auto-increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: updatedOrder.employeeId }),
      }).catch(err => {
        console.warn('[Auto-Increment] Background check failed:', err)
      })
    }

    // Queue outage writes if Neon is unreachable
    if (isInOutageMode()) {
      for (const item of createdItems) {
        void queueOutageWrite('OrderItem', item.id, 'INSERT', { ...item } as Record<string, unknown>, updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }
      void queueOutageWrite('Order', orderId, 'UPDATE', updatedOrder as unknown as Record<string, unknown>, updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Fire-and-forget: calculate and store costAtSale for all new items (batch query instead of N+1)
    void (async () => {
      try {
        const costMap = await calculateCostAtSaleBatch(
          createdItems.map((item: any) => ({
            id: item.id,
            menuItemId: item.menuItemId,
            pricingOptionId: item.pricingOptionId,
          }))
        )
        if (costMap.size > 0) {
          const updates = [...costMap.entries()]
          const caseClauses = updates.map((_, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ')
          const ids = updates.map(([id]) => id)
          const params: (string | number)[] = []
          for (const [id, cost] of updates) {
            params.push(id, cost)
          }
          params.push(...ids)
          const idPlaceholders = ids.map((_, i) => `$${updates.length * 2 + i + 1}`).join(', ')
          // eslint-disable-next-line -- dynamic CASE clauses + spread params require $executeRawUnsafe; all values are parameterized
          await db.$executeRawUnsafe(
            `UPDATE "OrderItem" SET "costAtSale" = CASE ${caseClauses} END, "updatedAt" = NOW() WHERE id IN (${idPlaceholders})`,
            ...params
          )
        }
      } catch (e) {
        console.error('[costAtSale] Failed to calculate:', e)
      }
    })()

    // Emit ITEM_ADDED events for each new item (fire-and-forget)
    // Pass idempotencyKey as clientEventId so server echo reuses the client's eventId,
    // enabling proper deduplication via Room's INSERT OR IGNORE (fixes C4 and H2)
    void emitOrderEvents(updatedOrder.locationId, orderId, createdItems.map((item: any) => ({
      type: 'ITEM_ADDED' as const,
      payload: {
        lineItemId: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        priceCents: Math.round(Number(item.price) * 100),
        quantity: item.quantity,
        employeeId: requestingEmployeeId || null, // WHO added this item
        modifiersJson: item.modifiers?.length
          ? JSON.stringify(item.modifiers.map((m: any) => ({
              id: m.id, modifierId: m.modifierId, name: m.name,
              price: Number(m.price), quantity: m.quantity,
              preModifier: m.preModifier, depth: m.depth,
              spiritTier: m.spiritTier || null,
              linkedBottleProductId: m.linkedBottleProductId || null,
              isCustomEntry: m.isCustomEntry || false,
              isNoneSelection: m.isNoneSelection || false,
              customEntryName: m.customEntryName || null,
              customEntryPrice: m.customEntryPrice != null ? Number(m.customEntryPrice) : null,
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
        weight: item.weight ? Number(item.weight) : null,
        weightUnit: item.weightUnit || null,
        unitPriceCents: item.unitPrice ? Math.round(Number(item.unitPrice) * 100) : null,
        grossWeight: item.grossWeight ? Number(item.grossWeight) : null,
        tareWeight: item.tareWeight ? Number(item.tareWeight) : null,
        pricingOptionId: item.pricingOptionId || null,
        pricingOptionLabel: item.pricingOptionLabel || null,
        costAtSaleCents: item.costAtSale ? Math.round(Number(item.costAtSale) * 100) : null,
        pourSize: item.pourSize || null,
        pourMultiplier: item.pourMultiplier ? Number(item.pourMultiplier) : null,
        isTaxInclusive: item.isTaxInclusive ?? false,
        itemType: menuItemMap.get(item.menuItemId)?.itemType || null,
      },
    })), { clientEventId: idempotencyKey })

    // Format response with complete modifier data
    // Build correlation map for newly created items
    const correlationMap = new Map<string, string>()
    createdItems.forEach(item => {
      const corr = (item as any).correlationId
      if (corr) {
        correlationMap.set(item.id, corr)
      }
    })

    // Build price correction metadata for client display (toast notifications)
    const priceCorrectionMap = new Map<string, { clientPrice: number; catalogPrice: number; menuItemName: string }>()
    priceCorrectionLog.forEach(correction => {
      priceCorrectionMap.set(correction.menuItemId, {
        clientPrice: correction.clientPrice,
        catalogPrice: correction.catalogPrice,
        menuItemName: correction.menuItemName,
      })
    })

    const response = {
      ...mapOrderForResponse(updatedOrder),
      // Map items with correlationId for newly created items — use wire mapper
      // so comboSelections are always included alongside the regular fields.
      items: updatedOrder.items.map((item: any) => {
        const mapped = mapOrderItemForWire(item, correlationMap.get(item.id))
        const correction = priceCorrectionMap.get(item.menuItemId)
        if (correction) {
          return {
            ...mapped,
            priceCorrected: true,
            originalClientPrice: correction.clientPrice,
          }
        }
        return mapped
      }),
      // Summary of price corrections for toast/alert
      ...(priceCorrectionLog.length > 0 && {
        priceCorrectionAlert: {
          hasPriceCorrections: true,
          correctionCount: priceCorrectionLog.length,
          corrections: priceCorrectionLog.map(c => ({
            menuItemName: c.menuItemName,
            oldPrice: c.clientPrice,
            newPrice: c.catalogPrice,
            message: `${c.menuItemName} price updated from $${c.clientPrice.toFixed(2)} to $${c.catalogPrice.toFixed(2)}`,
          })),
        },
      }),
    }

    // FIX-011: Dispatch real-time totals update (fire-and-forget)
    dispatchOrderTotalsUpdate(updatedOrder.locationId, updatedOrder.id, {
      subtotal: Number(updatedOrder.subtotal),
      taxTotal: Number(updatedOrder.taxTotal),
      tipTotal: Number(updatedOrder.tipTotal),
      discountTotal: Number(updatedOrder.discountTotal),
      total: Number(updatedOrder.total),
      commissionTotal: Number(updatedOrder.commissionTotal || 0),
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    dispatchOpenOrdersChanged(updatedOrder.locationId, { trigger: 'item_updated', orderId: updatedOrder.id, tableId: updatedOrder.tableId || undefined }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
    if (updatedOrder.tableId) {
      dispatchFloorPlanUpdate(updatedOrder.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
    }

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(updatedOrder.locationId, buildOrderSummary(updatedOrder), { async: true }).catch(err => log.warn({ err }, 'order summary dispatch failed'))
    if (updatedOrder.orderType === 'bar_tab' || updatedOrder.status === 'open') {
      const updatedItemCount = await OrderItemRepository.countItemsForOrder(orderId, locationId)
      dispatchTabItemsUpdated(updatedOrder.locationId, { orderId, itemCount: updatedItemCount })
    }

    // Notify terminal if new items were added to an order that already has sent items.
    // This prevents the add-then-send race where items stay 'pending' forever because
    // the employee already sent the order and doesn't realize new items arrived.
    if (hasSentItems && createdItems.length > 0) {
      void emitToLocation(updatedOrder.locationId, 'order:pending-items', {
        orderId: updatedOrder.id,
        count: createdItems.length,
        itemNames: createdItems.map((i: any) => i.name).slice(0, 5),
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Emit price correction alerts for managers (real-time visibility of stale menu issues)
    if (priceCorrectionLog.length > 0) {
      void emitToLocation(updatedOrder.locationId, 'order:price-corrected', {
        orderId: updatedOrder.id,
        employeeId: requestingEmployeeId || updatedOrder.employeeId,
        employeeName: updatedOrder.employee?.displayName || 'Unknown',
        corrections: priceCorrectionLog.map(c => ({
          menuItemId: c.menuItemId,
          menuItemName: c.menuItemName,
          clientPrice: c.clientPrice,
          catalogPrice: c.catalogPrice,
          priceDifference: c.catalogPrice - c.clientPrice,
        })),
        correctionCount: priceCorrectionLog.length,
        timestamp: new Date().toISOString(),
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Evaluate auto-discount rules after items are added (fire-and-forget)
    void evaluateAutoDiscounts(updatedOrder.id, updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
    pushUpstream()

    return ok({
      ...response,
      addedItems: createdItems.map(item => ({
        id: item.id,
        name: item.name,
        correlationId: (item as { correlationId?: string }).correlationId,
      })),
    })
  } catch (error) {
    console.error('Failed to add items to order:', error)
    if (error instanceof Error) {
      console.error('Error stack:', error.stack)
    }
    // Combo validation errors → 400 JSON with stable code (Phase 5)
    if (error instanceof ComboValidationError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    }
    const message = getErrorMessage(error)

    // Map known errors to appropriate responses
    if (message === 'Order not found') {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }
    if (message === 'ORDER_NOT_MODIFIABLE') {
      return err('Order cannot be modified — it may have been paid or closed by another terminal', 409)
    }
    if (message === 'TAB_CLOSING') {
      // Improve error context: find who is closing this tab
      const { id: errorOrderId } = await params
      let closingEmployeeName = 'Another bartender'
      let closingEmployeeId: string | undefined = undefined
      try {
        const orderData = await db.order.findUnique({
          where: { id: errorOrderId },
          include: { employee: true },
        })
        if (orderData?.employee) {
          closingEmployeeId = orderData.employee.id
          closingEmployeeName = `${orderData.employee.firstName} ${orderData.employee.lastName}`.trim() || closingEmployeeName
        }
      } catch (lookupErr) {
        log.warn({ err: lookupErr, orderId: errorOrderId }, 'Failed to look up employee for TAB_CLOSING error')
      }

      return NextResponse.json(
        {
          error: `Cannot add items — tab #${errorOrderId.slice(-3)} is being closed by ${closingEmployeeName}`,
          code: 'TAB_CLOSING',
          closingEmployeeId,
          closingEmployeeName,
          suggestion: 'Wait for the tab to close, then reopen it or start a new tab.',
        },
        { status: 409 }
      )
    }
    if (message === 'ORDER_HAS_PAYMENTS') {
      return err('Cannot modify an order with existing payments. Void the payment first.')
    }
    if (message.startsWith('ITEM_86D:')) {
      const itemName = message.replace('ITEM_86D:', '')
      return err(`"${itemName}" is currently 86'd (unavailable)`)
    }
    if (message.startsWith('ITEM_INACTIVE:') || message.startsWith('ITEM_DELETED:')) {
      const itemName = message.split(':')[1]
      return err(`"${itemName}" is no longer available`)
    }
    if (message.startsWith('COMBO_COMPONENT_86D:')) {
      const itemName = message.replace('COMBO_COMPONENT_86D:', '')
      return err(`Combo component "${itemName}" is currently 86'd (unavailable)`)
    }
    if (message.startsWith('COMBO_COMPONENT_INACTIVE:')) {
      const itemName = message.replace('COMBO_COMPONENT_INACTIVE:', '')
      return err(`Combo component "${itemName}" is no longer available`)
    }
    if (message.startsWith('REQUIRED_MODIFIER_MISSING:')) {
      const parts = message.replace('REQUIRED_MODIFIER_MISSING:', '').split(':')
      const itemName = parts[0]
      const groupName = parts[1]
      return err(`Required modifier group "${groupName}" is not satisfied for item "${itemName}"`)
    }
    if (message.startsWith('MENU_ITEM_NOT_FOUND:')) {
      const missingIds = message.replace('MENU_ITEM_NOT_FOUND:', '')
      return NextResponse.json(
        { error: `Menu items not found: ${missingIds}`, code: 'MENU_ITEM_NOT_FOUND' },
        { status: 400 }
      )
    }
    if (message.startsWith('ITEM_RACE_CONDITION:')) {
      const itemId = message.replace('ITEM_RACE_CONDITION:', '')
      return apiError.conflict(
        'Menu item became unavailable during processing. Please try again.',
        ERROR_CODES.ITEM_UNAVAILABLE,
        { menuItemId: itemId, reason: 'item_deleted_during_transaction' }
      )
    }

    const detail = process.env.NODE_ENV !== 'production' && error instanceof Error ? `: ${error.message}` : ''
    return apiError.internalError(`Failed to add items to order${detail}`, ERROR_CODES.INTERNAL_ERROR)
  }
})

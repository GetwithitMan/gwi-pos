import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
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
  validateMenuItemAvailability,
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
}).passthrough()

const AddItemsBodySchema = z.object({
  items: z.array(AddItemSchema).min(1, 'At least one item is required'),
  idempotencyKey: z.string().optional(),
  requestingEmployeeId: z.string().optional(),
}).passthrough()

/**
 * Calculate cost-at-sale for a single order item (fire-and-forget).
 * Sums base recipe ingredient costs + liquor recipe costs + pricing option link costs.
 * Returns null if no recipe/cost data exists.
 */
async function calculateCostAtSale(
  menuItemId: string,
  pricingOptionId: string | null
): Promise<number | null> {
  // TODO: MenuItemRepository.getMenuItemByIdWithInclude() needs locationId; cost calc is location-agnostic
  const menuItem = await db.menuItem.findUnique({
    where: { id: menuItemId },
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

  if (!menuItem) return null

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

  // If no base cost and no pricing option, no cost data to snapshot
  if (baseCost === 0 && !pricingOptionId) return null

  // Pricing option inventory link costs (additive on top of base)
  // TODO: Add PricingOptionRepository once that repository exists
  if (pricingOptionId) {
    const option = await db.pricingOption.findUnique({
      where: { id: pricingOptionId },
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

    if (option?.inventoryLinks?.length) {
      const { totalCost } = calculateVariantCost(baseCost, option.inventoryLinks)
      return totalCost
    }
  }

  return baseCost > 0 ? baseCost : null
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
    const { items, idempotencyKey, requestingEmployeeId } = body as { items: AddItemInput[], idempotencyKey?: string, requestingEmployeeId?: string }

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
        if (err instanceof CellularAuthError) {
          return err(err.message, err.status)
        }
        throw err
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
          const pricingOptionIds = pricableItems.filter((i: AddItemInput) => i.pricingOptionId).map((i: AddItemInput) => i.pricingOptionId!)
          // Re-use prefetched menuItems (hoisted before transaction) for price validation
          // TODO: MenuItemRepository.getMenuItems() doesn't support batch-by-IDs; PricingOption has no repo
          const pricingOptions = pricingOptionIds.length > 0
            ? await db.pricingOption.findMany({
                where: { id: { in: pricingOptionIds } },
                select: { id: true, price: true },
              })
            : []
          const menuItemPrices = new Map(prefetchedMenuItems.map(m => [m.id, Number(m.price)]))
          const pricingOptionPrices = new Map(pricingOptions.map(p => [p.id, Number(p.price)]))

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

    // Idempotency check — if this key was already processed, return current order
    if (idempotencyKey) {
      const existing = await OrderItemRepository.getItemsForOrderWhere(orderId, locationId, {
        idempotencyKey, deletedAt: null,
      })
      if (existing.length > 0) {
        const order = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          items: {
            include: {
              modifiers: true,
              ingredientModifications: true,
              pizzaData: true,
            },
          },
        })
        if (!order) return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
        return ok(mapOrderForResponse(order))
      }
    }

    // Use a transaction to ensure atomic append
    const result = await db.$transaction(async (tx) => {
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

      // Get full order data with includes (row is already locked within this tx)
      const existingOrder = await OrderRepository.getOrderByIdWithInclude(orderId, locationId, {
        location: true,
        items: {
          include: {
            modifiers: true,
            ingredientModifications: true,
          },
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
      // Staff sees '[Deleted Item]' which is visually distinct.
      for (const id of menuItemIds) {
        if (!menuItemMap.has(id)) {
          log.warn({ menuItemId: id, orderId }, 'MenuItem not found — using deleted item fallback')
          menuItemMap.set(id, {
            id,
            name: '[Deleted Item]',
            price: 0,
            commissionType: null,
            commissionValue: null,
            itemType: null,
            isAvailable: true,   // allow order to proceed — item data is already on the client
            isActive: true,      // allow order to proceed — price comes from client
            deletedAt: null,     // don't trigger ITEM_DELETED validation
            categoryId: null,
            category: null,
            tipExempt: false,
          } as any)
        }
      }

      // H9: Check if order already has sent items — explicitly set kitchenStatus on new items
      // so they're visible on KDS (default is 'pending' but can be null in edge cases)
      const hasSentItems = existingOrder.items.some(
        i => i.kitchenStatus === 'sent' || i.kitchenStatus === 'cooking' || i.kitchenStatus === 'ready'
      )

      // Validate menu item availability (86 check) via domain
      const availCheck = validateMenuItemAvailability(menuItemsWithCommission)
      if (!availCheck.valid) throw new Error(availCheck.error)

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
      {
        const pricableItems = items.filter(i => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)
        if (pricableItems.length > 0) {
          const pricingOptionIds = pricableItems.filter(i => i.pricingOptionId).map(i => i.pricingOptionId!)
          const pricingOptions = pricingOptionIds.length > 0
            ? await tx.pricingOption.findMany({
                where: { id: { in: pricingOptionIds } },
                select: { id: true, price: true },
              })
            : []
          const pricingOptionPrices = new Map(pricingOptions.map(p => [p.id, Number(p.price)]))

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
                item.price = expectedPrice
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
            idempotencyKey: idempotencyKey || null,
            pricingRules,
            mutationOrigin,
          })
        )
      )

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
            include: {
              modifiers: true,
              ingredientModifications: true,
              pizzaData: true,
            },
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

      // BUG 3 FIX: If this is a split child order, recalculate parent totals via domain
      if (existingOrder.parentOrderId) {
        await recalculateParentOrderTotals(tx, existingOrder.parentOrderId)
      }

      return { updatedOrder, createdItems, menuItemMap, hasSentItems }
    })

    // Fire-and-forget: check if bar tab or bottle service tab needs auto-increment
    if ((result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.isBottleService) && result.updatedOrder.preAuthRecordNo) {
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3005}`}/api/orders/${orderId}/auto-increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: result.updatedOrder.employeeId }),
      }).catch(err => {
        console.warn('[Auto-Increment] Background check failed:', err)
      })
    }

    // Queue outage writes if Neon is unreachable
    if (isInOutageMode()) {
      for (const item of result.createdItems) {
        void queueOutageWrite('OrderItem', item.id, 'INSERT', { ...item } as Record<string, unknown>, result.updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
      }
      void queueOutageWrite('Order', orderId, 'UPDATE', result.updatedOrder as unknown as Record<string, unknown>, result.updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Fire-and-forget: calculate and store costAtSale for all new items in parallel (N+1 fix)
    void (async () => {
      try {
        const costResults = await Promise.all(
          result.createdItems.map(async (item: any) => {
            const cost = await calculateCostAtSale(item.menuItemId, item.pricingOptionId)
            return { id: item.id, cost }
          })
        )
        const updates = costResults.filter(r => r.cost !== null)
        if (updates.length > 0) {
          // Batch update all costAtSale values in a single SQL statement
          const caseClauses = updates.map((_, i) => `WHEN id = $${i * 2 + 1} THEN $${i * 2 + 2}`).join(' ')
          const ids = updates.map(u => u.id)
          const params: (string | number)[] = []
          for (const u of updates) {
            params.push(u.id, u.cost!)
          }
          params.push(...ids)
          const idPlaceholders = ids.map((_, i) => `$${updates.length * 2 + i + 1}`).join(', ')
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
    void emitOrderEvents(result.updatedOrder.locationId, orderId, result.createdItems.map((item: any) => ({
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
        itemType: result.menuItemMap.get(item.menuItemId)?.itemType || null,
      },
    })))

    // Format response with complete modifier data
    // Build correlation map for newly created items
    const correlationMap = new Map<string, string>()
    result.createdItems.forEach(item => {
      const corr = (item as any).correlationId
      if (corr) {
        correlationMap.set(item.id, corr)
      }
    })

    const response = {
      ...mapOrderForResponse(result.updatedOrder),
      // Map items with correlationId for newly created items
      items: result.updatedOrder.items.map((item: any) =>
        mapOrderItemForResponse(item, correlationMap.get(item.id))
      ),
    }

    // FIX-011: Dispatch real-time totals update (fire-and-forget)
    dispatchOrderTotalsUpdate(result.updatedOrder.locationId, result.updatedOrder.id, {
      subtotal: Number(result.updatedOrder.subtotal),
      taxTotal: Number(result.updatedOrder.taxTotal),
      tipTotal: Number(result.updatedOrder.tipTotal),
      discountTotal: Number(result.updatedOrder.discountTotal),
      total: Number(result.updatedOrder.total),
      commissionTotal: Number(result.updatedOrder.commissionTotal || 0),
    }, { async: true }).catch(err => log.warn({ err }, 'Background task failed'))
    dispatchOpenOrdersChanged(result.updatedOrder.locationId, { trigger: 'item_updated', orderId: result.updatedOrder.id, tableId: result.updatedOrder.tableId || undefined }, { async: true }).catch(err => log.warn({ err }, 'open orders dispatch failed'))
    if (result.updatedOrder.tableId) {
      dispatchFloorPlanUpdate(result.updatedOrder.locationId, { async: true }).catch(err => log.warn({ err }, 'floor plan dispatch failed'))
    }

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(result.updatedOrder.locationId, buildOrderSummary(result.updatedOrder), { async: true }).catch(err => log.warn({ err }, 'order summary dispatch failed'))
    if (result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.status === 'open') {
      const updatedItemCount = await OrderItemRepository.countItemsForOrder(orderId, locationId)
      dispatchTabItemsUpdated(result.updatedOrder.locationId, { orderId, itemCount: updatedItemCount })
    }

    // Notify terminal if new items were added to an order that already has sent items.
    // This prevents the add-then-send race where items stay 'pending' forever because
    // the employee already sent the order and doesn't realize new items arrived.
    if (result.hasSentItems && result.createdItems.length > 0) {
      void emitToLocation(result.updatedOrder.locationId, 'order:pending-items', {
        orderId: result.updatedOrder.id,
        count: result.createdItems.length,
        itemNames: result.createdItems.map((i: any) => i.name).slice(0, 5),
      }).catch(err => log.warn({ err }, 'Background task failed'))
    }

    // Evaluate auto-discount rules after items are added (fire-and-forget)
    void evaluateAutoDiscounts(result.updatedOrder.id, result.updatedOrder.locationId).catch(err => log.warn({ err }, 'Background task failed'))
    pushUpstream()

    return ok({
      ...response,
      addedItems: result.createdItems.map(item => ({
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
    const message = getErrorMessage(error)

    // Map known errors to appropriate responses
    if (message === 'Order not found') {
      return apiError.notFound('Order not found', ERROR_CODES.ORDER_NOT_FOUND)
    }
    if (message === 'Cannot modify a closed order') {
      return apiError.conflict('Cannot modify a closed order', ERROR_CODES.ORDER_CLOSED)
    }
    if (message === 'ORDER_NOT_MODIFIABLE') {
      return err('Order cannot be modified — it may have been paid or closed by another terminal', 409)
    }
    if (message === 'TAB_CLOSING') {
      return NextResponse.json(
        { error: 'Cannot add items — tab is being closed', code: 'TAB_CLOSING' },
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

    const detail = process.env.NODE_ENV !== 'production' && error instanceof Error ? `: ${error.message}` : ''
    return apiError.internalError(`Failed to add items to order${detail}`, ERROR_CODES.INTERNAL_ERROR)
  }
})

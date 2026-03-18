import { NextRequest, NextResponse } from 'next/server'
import { db, adminDb } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderItemAdded, dispatchTabItemsUpdated, dispatchOrderSummaryUpdated, buildOrderSummary } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { calculateIngredientCosts, calculateVariantCost } from '@/lib/inventory/recipe-costing'
import { emitOrderEvents } from '@/lib/order-events/emitter'
import { evaluateAutoDiscounts } from '@/lib/auto-discount-engine'
import { checkOrderClaim } from '@/lib/order-claim'
import { isInOutageMode, queueOutageWrite } from '@/lib/sync/upstream-sync-worker'
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
  recalculateOrderTotalsForAdd,
  recalculateParentOrderTotals,
} from '@/lib/domain/order-items'

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
  const menuItem = await adminDb.menuItem.findUnique({
    where: { id: menuItemId },
    include: {
      recipe: {
        include: {
          ingredients: {
            include: {
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
      include: {
        inventoryLinks: {
          where: { deletedAt: null },
          include: {
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
    const body = await request.json()
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

    // Auth checks — fetch order metadata once for all permission guards (tenant-safe)
    if (requestingEmployeeId) {
      const orderMeta = await OrderRepository.getOrderByIdWithSelect(orderId, locationId, {
        employeeId: true, locationId: true,
      })

      // Guard: editing another employee's order requires pos.edit_others_orders
      if (orderMeta?.employeeId && orderMeta.employeeId !== requestingEmployeeId) {
        const auth = await requirePermission(requestingEmployeeId, orderMeta.locationId, PERMISSIONS.POS_EDIT_OTHERS_ORDERS)
        if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
      }

      // Guard: custom-priced items require manager.open_items
      // Skip for weight-based, pizza, and timed-rental items whose prices are inherently dynamic
      if (orderMeta) {
        const pricableItems = items.filter((i: AddItemInput) => !i.soldByWeight && !i.pizzaConfig && !i.blockTimeMinutes)
        if (pricableItems.length > 0) {
          const pricingOptionIds = pricableItems.filter((i: AddItemInput) => i.pricingOptionId).map((i: AddItemInput) => i.pricingOptionId!)
          // Parallelize independent DB lookups
          // TODO: MenuItemRepository.getMenuItems() doesn't support batch-by-IDs; PricingOption has no repo
          const [menuItemsForPrice, pricingOptions] = await Promise.all([
            adminDb.menuItem.findMany({
              where: { id: { in: pricableItems.map((i: AddItemInput) => i.menuItemId) } },
              select: { id: true, price: true },
            }),
            pricingOptionIds.length > 0
              ? db.pricingOption.findMany({
                  where: { id: { in: pricingOptionIds } },
                  select: { id: true, price: true },
                })
              : Promise.resolve([]),
          ])
          const menuItemPrices = new Map(menuItemsForPrice.map(m => [m.id, Number(m.price)]))
          const pricingOptionPrices = new Map(pricingOptions.map(p => [p.id, Number(p.price)]))

          if (hasOpenPricedItems(items, menuItemPrices, pricingOptionPrices)) {
            const auth = await requirePermission(requestingEmployeeId, orderMeta.locationId, PERMISSIONS.MGR_OPEN_ITEMS)
            if (!auth.authorized) return NextResponse.json({ error: auth.error }, { status: auth.status })
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
        return NextResponse.json({ data: mapOrderForResponse(order) })
      }
    }

    // Use a transaction to ensure atomic append
    // TODO: [Phase 2] Migrate tx.order.findUnique/update calls inside this transaction to
    // OrderRepository methods with tx parameter once the FOR UPDATE lock pattern is validated
    const result = await db.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent modifications (FOR UPDATE)
      const [lockedOrder] = await tx.$queryRaw<any[]>`
        SELECT id, status FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `

      if (!lockedOrder) {
        throw new Error('Order not found')
      }

      // Validate order status via domain
      const statusCheck = validateOrderStatusForAdd(lockedOrder.status)
      if (!statusCheck.valid) throw new Error(statusCheck.error)

      // Get full order data with includes (row is already locked within this tx)
      const existingOrder = await tx.order.findUnique({
        where: { id: orderId },
        include: {
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
        },
      })

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
        const businessDayStart = getCurrentBusinessDay(dayStartTime).start

        if (!existingOrder.businessDayDate || existingOrder.businessDayDate < businessDayStart) {
          await tx.order.update({ where: { id: orderId }, data: { businessDayDate: businessDayStart } })
        }
      } catch (promoErr) {
        console.warn('[BusinessDay] Failed to promote businessDayDate on item add:', promoErr)
      }

      // Fetch menu items to get commission settings + availability
      const menuItemIds = items.map(item => item.menuItemId)
      const menuItemsWithCommission = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: { id: true, commissionType: true, commissionValue: true, itemType: true, isAvailable: true, isActive: true, deletedAt: true, name: true, categoryId: true, category: { select: { categoryType: true } }, tipExempt: true },
      })
      const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))

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
          })
        )
      )

      // Recalculate order totals from current database state via domain
      const totals = await recalculateOrderTotalsForAdd(
        tx, orderId, existingOrder.location.settings,
        Number(existingOrder.tipTotal) || 0, existingOrder.isTaxExempt
      )

      // Update order totals + bump version for concurrency control
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          ...totals,
          ...(existingOrder.isBottleService ? { bottleServiceCurrentSpend: totals.subtotal } : {}),
          version: { increment: 1 },
          lastMutatedBy: 'local',
        },
        include: {
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
      })

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

      return { updatedOrder, createdItems, menuItemMap }
    })

    // Fire-and-forget: check if bar tab or bottle service tab needs auto-increment
    if ((result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.isBottleService) && result.updatedOrder.preAuthRecordNo) {
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3005'}/api/orders/${orderId}/auto-increment`, {
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
        void queueOutageWrite('OrderItem', item.id, 'INSERT', { ...item } as Record<string, unknown>, result.updatedOrder.locationId).catch(console.error)
      }
      void queueOutageWrite('Order', orderId, 'UPDATE', result.updatedOrder as unknown as Record<string, unknown>, result.updatedOrder.locationId).catch(console.error)
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
      items: result.updatedOrder.items.map(item =>
        mapOrderItemForResponse(item, correlationMap.get(item.id))
      ),
    }

    // Dispatch order:item-added for each newly created item (fire-and-forget)
    for (const item of result.createdItems) {
      void dispatchOrderItemAdded(result.updatedOrder.locationId, { orderId: result.updatedOrder.id, itemId: item.id }).catch(() => {})
    }

    // FIX-011: Dispatch real-time totals update (fire-and-forget)
    dispatchOrderTotalsUpdate(result.updatedOrder.locationId, result.updatedOrder.id, {
      subtotal: Number(result.updatedOrder.subtotal),
      taxTotal: Number(result.updatedOrder.taxTotal),
      tipTotal: Number(result.updatedOrder.tipTotal),
      discountTotal: Number(result.updatedOrder.discountTotal),
      total: Number(result.updatedOrder.total),
      commissionTotal: Number(result.updatedOrder.commissionTotal || 0),
    }, { async: true }).catch(console.error)

    // Dispatch open orders + floor plan update for cross-terminal table status
    dispatchOpenOrdersChanged(result.updatedOrder.locationId, { trigger: 'item_updated', orderId: result.updatedOrder.id, tableId: result.updatedOrder.tableId || undefined }, { async: true }).catch(() => {})
    if (result.updatedOrder.tableId) {
      dispatchFloorPlanUpdate(result.updatedOrder.locationId, { async: true }).catch(() => {})
    }

    // Dispatch order:summary-updated for Android cross-terminal sync (fire-and-forget)
    void dispatchOrderSummaryUpdated(result.updatedOrder.locationId, buildOrderSummary(result.updatedOrder), { async: true }).catch(() => {})

    // If this is a bar tab, notify phone that items updated (tenant-safe)
    if (result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.status === 'open') {
      const updatedItemCount = await OrderItemRepository.countItemsForOrder(orderId, locationId)
      dispatchTabItemsUpdated(result.updatedOrder.locationId, { orderId, itemCount: updatedItemCount })
    }

    // Evaluate auto-discount rules after items are added (fire-and-forget)
    void evaluateAutoDiscounts(result.updatedOrder.id, result.updatedOrder.locationId).catch(console.error)

    return NextResponse.json({ data: {
      ...response,
      addedItems: result.createdItems.map(item => ({
        id: item.id,
        name: item.name,
        correlationId: (item as { correlationId?: string }).correlationId,
      })),
    } })
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
      return NextResponse.json(
        { error: 'Order cannot be modified — it may have been paid or closed by another terminal' },
        { status: 409 }
      )
    }
    if (message === 'ORDER_HAS_PAYMENTS') {
      return NextResponse.json(
        { error: 'Cannot modify an order with existing payments. Void the payment first.' },
        { status: 400 }
      )
    }
    if (message.startsWith('ITEM_86D:')) {
      const itemName = message.replace('ITEM_86D:', '')
      return NextResponse.json(
        { error: `"${itemName}" is currently 86'd (unavailable)` },
        { status: 400 }
      )
    }
    if (message.startsWith('ITEM_INACTIVE:') || message.startsWith('ITEM_DELETED:')) {
      const itemName = message.split(':')[1]
      return NextResponse.json(
        { error: `"${itemName}" is no longer available` },
        { status: 400 }
      )
    }
    if (message.startsWith('COMBO_COMPONENT_86D:')) {
      const itemName = message.replace('COMBO_COMPONENT_86D:', '')
      return NextResponse.json(
        { error: `Combo component "${itemName}" is currently 86'd (unavailable)` },
        { status: 400 }
      )
    }
    if (message.startsWith('COMBO_COMPONENT_INACTIVE:')) {
      const itemName = message.replace('COMBO_COMPONENT_INACTIVE:', '')
      return NextResponse.json(
        { error: `Combo component "${itemName}" is no longer available` },
        { status: 400 }
      )
    }

    const detail = process.env.NODE_ENV !== 'production' && error instanceof Error ? `: ${error.message}` : ''
    return apiError.internalError(`Failed to add items to order${detail}`, ERROR_CODES.INTERNAL_ERROR)
  }
})

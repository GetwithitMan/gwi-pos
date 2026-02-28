import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapOrderForResponse, mapOrderItemForResponse } from '@/lib/api/order-response-mapper'
import { calculateItemTotal, calculateItemCommission, calculateOrderTotals, calculateOrderSubtotal, isItemTaxInclusive, recalculatePercentDiscounts, type LocationTaxSettings } from '@/lib/order-calculations'
import { calculateCardPrice, roundToCents } from '@/lib/pricing'
import { parseSettings } from '@/lib/settings'
import { apiError, ERROR_CODES, getErrorMessage } from '@/lib/api/error-responses'
import { dispatchOrderTotalsUpdate, dispatchOpenOrdersChanged, dispatchFloorPlanUpdate, dispatchOrderItemAdded, dispatchTabItemsUpdated } from '@/lib/socket-dispatch'
import { withVenue } from '@/lib/with-venue'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { calculateIngredientCosts, calculateVariantCost } from '@/lib/inventory/recipe-costing'
import { emitOrderEvents } from '@/lib/order-events/emitter'

// Helper to check if a string is a valid CUID (for real modifier IDs)
function isValidModifierId(modId: string) {
  // CUIDs are typically 25 chars starting with 'c', combo IDs start with 'combo-'
  return modId && !modId.startsWith('combo-') && modId.length >= 20
}

/**
 * Calculate cost-at-sale for a single order item (fire-and-forget).
 * Sums base recipe ingredient costs + liquor recipe costs + pricing option link costs.
 * Returns null if no recipe/cost data exists.
 */
async function calculateCostAtSale(
  menuItemId: string,
  pricingOptionId: string | null
): Promise<number | null> {
  const menuItem = await db.menuItem.findUnique({
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

type NewItem = {
  menuItemId: string
  name: string
  price: number
  quantity: number
  pourSize?: string       // T-006: "shot", "double", "tall", "short"
  pourMultiplier?: number // T-006: 1.0, 2.0, 1.5, 0.75
  correlationId?: string // Client-provided ID for matching response items
  modifiers: {
    modifierId: string
    name: string
    price: number
    preModifier?: string
    depth?: number
    spiritTier?: string
    linkedBottleProductId?: string
  }[]
  ingredientModifications?: {
    ingredientId: string
    name: string
    modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
    priceAdjustment: number
    swappedTo?: {
      modifierId: string
      name: string
      price: number
    }
  }[]
  specialNotes?: string
  seatNumber?: number | null
  courseNumber?: number | null
  isHeld?: boolean
  delayMinutes?: number | null
  // Pizza configuration
  pizzaConfig?: {
    sizeId: string
    crustId: string
    sauceId?: string
    cheeseId?: string
    sauceAmount?: 'none' | 'light' | 'regular' | 'extra'
    cheeseAmount?: 'none' | 'light' | 'regular' | 'extra'
    toppings?: unknown[]
    sauces?: unknown[]
    cheeses?: unknown[]
    cookingInstructions?: string
    cutStyle?: string
    totalPrice: number
    priceBreakdown: {
      sizePrice: number
      crustPrice: number
      saucePrice: number
      cheesePrice: number
      toppingsPrice: number
    }
  }
  // Entertainment/timed rental fields
  blockTimeMinutes?: number
  // Weight-based pricing
  soldByWeight?: boolean
  weight?: number       // NET weight (post-tare)
  weightUnit?: string   // "lb" | "kg" | "oz" | "g"
  unitPrice?: number    // Price per weight unit
  grossWeight?: number  // Weight before tare subtracted
  tareWeight?: number   // Container weight
  // Pricing option (size/variant selection)
  pricingOptionId?: string
  pricingOptionLabel?: string
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
    const { items, idempotencyKey } = body as { items: NewItem[], idempotencyKey?: string }

    if (!items || items.length === 0) {
      return apiError.badRequest('No items provided', ERROR_CODES.ORDER_EMPTY)
    }

    // Bug 13 fix: Validate quantity on each item (must be >= 1)
    for (const item of items) {
      if (!item.quantity || item.quantity < 1) {
        return apiError.badRequest(
          `Invalid quantity for item "${item.name || item.menuItemId}": must be at least 1`,
          ERROR_CODES.VALIDATION_ERROR
        )
      }
      // Validate weight-based items: weight and unitPrice must be > 0
      if (item.soldByWeight) {
        if (!item.weight || item.weight <= 0) {
          return apiError.badRequest(
            `Weight is required for sold-by-weight item "${item.name || item.menuItemId}"`,
            ERROR_CODES.VALIDATION_ERROR
          )
        }
        if (!item.unitPrice || item.unitPrice <= 0) {
          return apiError.badRequest(
            `Unit price is required for sold-by-weight item "${item.name || item.menuItemId}"`,
            ERROR_CODES.VALIDATION_ERROR
          )
        }
      }
    }

    // Idempotency check — if this key was already processed, return current order
    if (idempotencyKey) {
      const existing = await db.orderItem.findFirst({
        where: { orderId, idempotencyKey, deletedAt: null },
      })
      if (existing) {
        const order = await db.order.findUniqueOrThrow({
          where: { id: orderId },
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
        return NextResponse.json({ data: mapOrderForResponse(order) })
      }
    }

    // Use a transaction to ensure atomic append
    const result = await db.$transaction(async (tx) => {
      // Lock the order row to prevent concurrent modifications (FOR UPDATE)
      const [lockedOrder] = await tx.$queryRaw<any[]>`
        SELECT id, status FROM "Order" WHERE id = ${orderId} FOR UPDATE
      `

      if (!lockedOrder) {
        throw new Error('Order not found')
      }

      if (!['open', 'draft', 'in_progress'].includes(lockedOrder.status)) {
        throw new Error('ORDER_NOT_MODIFIABLE')
      }

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

      // Block modifications if any completed payment exists
      const hasCompletedPayment = existingOrder.payments?.some(p => p.status === 'completed') || false
      if (hasCompletedPayment) {
        throw new Error('ORDER_HAS_PAYMENTS')
      }

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
        select: { id: true, commissionType: true, commissionValue: true, itemType: true, isAvailable: true, isActive: true, deletedAt: true, name: true, category: { select: { categoryType: true } } },
      })
      const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))

      // Validate menu item availability (86 check)
      for (const mi of menuItemsWithCommission) {
        if (mi.deletedAt) {
          throw new Error(`ITEM_DELETED:${mi.name}`)
        }
        if (!mi.isActive) {
          throw new Error(`ITEM_INACTIVE:${mi.name}`)
        }
        if (!mi.isAvailable) {
          throw new Error(`ITEM_86D:${mi.name}`)
        }
      }

      // For combo items, validate component availability
      const comboMenuItems = menuItemsWithCommission.filter(mi => mi.itemType === 'combo')
      if (comboMenuItems.length > 0) {
        const comboTemplates = await tx.comboTemplate.findMany({
          where: {
            menuItemId: { in: comboMenuItems.map(c => c.id) },
            deletedAt: null,
          },
          include: {
            components: {
              where: { deletedAt: null },
              include: {
                menuItem: {
                  select: { id: true, name: true, isAvailable: true, isActive: true },
                },
              },
            },
          },
        })

        for (const template of comboTemplates) {
          for (const comp of template.components) {
            if (comp.menuItem && !comp.menuItem.isAvailable) {
              throw new Error(`COMBO_COMPONENT_86D:${comp.menuItem.name}`)
            }
            if (comp.menuItem && !comp.menuItem.isActive) {
              throw new Error(`COMBO_COMPONENT_INACTIVE:${comp.menuItem.name}`)
            }
          }
        }
      }

      // Derive tax-inclusive flags + dual pricing settings
      const locSettings = existingOrder.location.settings
      const parsedSettings = locSettings ? parseSettings(locSettings) : null
      const dualPricingEnabled = parsedSettings?.dualPricing?.enabled ?? false
      const cashDiscountPct = parsedSettings?.dualPricing?.cashDiscountPercent ?? 4.0

      const [taxRules, allCategories] = await Promise.all([
        tx.taxRule.findMany({
          where: { locationId: existingOrder.locationId, isActive: true, isInclusive: true, deletedAt: null },
          select: { appliesTo: true, categoryIds: true },
        }),
        tx.category.findMany({
          where: { locationId: existingOrder.locationId, deletedAt: null },
          select: { id: true, categoryType: true },
        }),
      ])
      let taxInclusiveLiquor = false
      let taxInclusiveFood = false
      for (const rule of taxRules) {
        if (rule.appliesTo === 'all') { taxInclusiveLiquor = true; taxInclusiveFood = true; break }
        if (rule.appliesTo === 'category' && rule.categoryIds) {
          for (const cat of allCategories) {
            if ((rule.categoryIds as string[]).includes(cat.id)) {
              if (cat.categoryType && ['liquor', 'drinks'].includes(cat.categoryType)) taxInclusiveLiquor = true
              if (cat.categoryType && ['food', 'pizza', 'combos'].includes(cat.categoryType)) taxInclusiveFood = true
            }
          }
        }
      }
      const taxIncSettings = { taxInclusiveLiquor, taxInclusiveFood }

      // Create the new items
      const createdItems = []
      let newItemsSubtotal = 0
      let newItemsCommission = 0

      for (const item of items) {
        // For weight-based items, compute the effective price for backward compat
        const effectivePrice = (item.soldByWeight && item.weight && item.unitPrice)
          ? roundToCents(item.unitPrice * item.weight)
          : item.price

        // Calculate item total using centralized function
        const fullItemTotal = calculateItemTotal({
          ...item,
          price: effectivePrice,
        })
        newItemsSubtotal += fullItemTotal

        // Calculate commission using centralized function
        const menuItem = menuItemMap.get(item.menuItemId)
        const itemCommission = calculateItemCommission(
          fullItemTotal,
          item.quantity,
          menuItem?.commissionType || null,
          menuItem?.commissionValue ? Number(menuItem.commissionValue) : null
        )
        newItemsCommission += itemCommission

        // Determine item-level pricing truth
        const catType = menuItem?.category?.categoryType ?? null
        const itemTaxInclusive = isItemTaxInclusive(catType ?? undefined, taxIncSettings)

        // Create the order item
        const createdItem = await tx.orderItem.create({
          data: {
            orderId,
            locationId: existingOrder.locationId,
            menuItemId: item.menuItemId,
            name: item.name,
            price: effectivePrice,
            cardPrice: dualPricingEnabled ? calculateCardPrice(effectivePrice, cashDiscountPct) : null,
            isTaxInclusive: itemTaxInclusive,
            categoryType: catType,
            quantity: item.quantity,
            pourSize: item.pourSize ?? null,
            pourMultiplier: item.pourMultiplier ?? null,
            itemTotal: fullItemTotal,
            commissionAmount: itemCommission,
            specialNotes: item.specialNotes || null,
            seatNumber: item.seatNumber || null,
            courseNumber: item.courseNumber || null,
            isHeld: item.isHeld || false,
            delayMinutes: item.delayMinutes || null,
            // Entertainment/timed rental fields
            blockTimeMinutes: item.blockTimeMinutes || null,
            // Idempotency key for duplicate prevention
            idempotencyKey: idempotencyKey || null,
            // Weight-based pricing fields
            soldByWeight: item.soldByWeight || false,
            weight: item.weight ?? null,
            weightUnit: item.weightUnit ?? null,
            unitPrice: item.unitPrice ?? null,
            grossWeight: item.grossWeight ?? null,
            tareWeight: item.tareWeight ?? null,
            // Pricing option (size/variant selection)
            pricingOptionId: item.pricingOptionId ?? null,
            pricingOptionLabel: item.pricingOptionLabel ?? null,
            // Modifiers
            modifiers: {
              create: item.modifiers.map(mod => ({
                locationId: existingOrder.locationId,
                modifierId: isValidModifierId(mod.modifierId) ? mod.modifierId : null,
                name: mod.name,
                price: mod.price,
                quantity: 1,
                preModifier: mod.preModifier || null,
                depth: mod.depth || 0,
                spiritTier: mod.spiritTier || null,
                linkedBottleProductId: mod.linkedBottleProductId || null,
              })),
            },
            // Ingredient modifications
            ingredientModifications: item.ingredientModifications && item.ingredientModifications.length > 0
              ? {
                  create: item.ingredientModifications.map(ing => ({
                    locationId: existingOrder.locationId,
                    ingredientId: ing.ingredientId,
                    ingredientName: ing.name,
                    modificationType: ing.modificationType,
                    priceAdjustment: ing.priceAdjustment || 0,
                    swappedToModifierId: ing.swappedTo?.modifierId || null,
                    swappedToModifierName: ing.swappedTo?.name || null,
                  })),
                }
              : undefined,
            // Pizza data
            pizzaData: item.pizzaConfig
              ? {
                  create: {
                    locationId: existingOrder.locationId,
                    sizeId: item.pizzaConfig.sizeId,
                    crustId: item.pizzaConfig.crustId,
                    sauceId: item.pizzaConfig.sauceId || null,
                    cheeseId: item.pizzaConfig.cheeseId || null,
                    sauceAmount: item.pizzaConfig.sauceAmount || 'regular',
                    cheeseAmount: item.pizzaConfig.cheeseAmount || 'regular',
                    // Store full config in toppingsData JSON for easy retrieval
                    toppingsData: {
                      toppings: item.pizzaConfig.toppings,
                      sauces: item.pizzaConfig.sauces,
                      cheeses: item.pizzaConfig.cheeses,
                    } as object,
                    cookingInstructions: item.pizzaConfig.cookingInstructions || null,
                    cutStyle: item.pizzaConfig.cutStyle || null,
                    totalPrice: item.pizzaConfig.totalPrice,
                    sizePrice: item.pizzaConfig.priceBreakdown.sizePrice,
                    crustPrice: item.pizzaConfig.priceBreakdown.crustPrice,
                    saucePrice: item.pizzaConfig.priceBreakdown.saucePrice,
                    cheesePrice: item.pizzaConfig.priceBreakdown.cheesePrice,
                    toppingsPrice: item.pizzaConfig.priceBreakdown.toppingsPrice,
                  },
                }
              : undefined,
          },
          include: {
            modifiers: true,
            ingredientModifications: true,
            pizzaData: true,
          },
        })

        createdItems.push({ ...createdItem, correlationId: item.correlationId })

        // Mark entertainment items as in_use
        if (menuItem?.itemType === 'timed_rental') {
          await tx.menuItem.update({
            where: { id: item.menuItemId },
            data: {
              entertainmentStatus: 'in_use',
              currentOrderId: orderId,
              currentOrderItemId: createdItem.id,
            },
          })
        }
      }

      // Recalculate order totals from current database state
      // This ensures accuracy even if other items were added concurrently
      const allItems = await tx.orderItem.findMany({
        where: { orderId },
        include: {
          modifiers: true,
          ingredientModifications: true,
        },
      })

      // Map Prisma Decimal types to numbers for calculation
      const itemsForCalc = allItems.map(i => ({
        ...i,
        price: Number(i.price),
        itemTotal: Number(i.itemTotal),
        commissionAmount: i.commissionAmount ? Number(i.commissionAmount) : undefined,
        weight: i.weight ? Number(i.weight) : undefined,
        unitPrice: i.unitPrice ? Number(i.unitPrice) : undefined,
        soldByWeight: i.soldByWeight ?? false,
        modifiers: i.modifiers.map(m => ({ ...m, price: Number(m.price) })),
        ingredientModifications: i.ingredientModifications.map(ing => ({ ...ing, priceAdjustment: Number(ing.priceAdjustment) })),
      }))

      // Recalculate percent-based discounts against new subtotal
      const newSubtotalForDiscounts = calculateOrderSubtotal(itemsForCalc)
      const updatedDiscountTotal = await recalculatePercentDiscounts(tx, orderId, newSubtotalForDiscounts)

      // Use centralized calculation function (single source of truth)
      const totals = calculateOrderTotals(
        itemsForCalc,
        existingOrder.location.settings as LocationTaxSettings | null,
        updatedDiscountTotal,
        Number(existingOrder.tipTotal) || 0
      )

      const { subtotal: newSubtotal, taxTotal: newTaxTotal, taxFromInclusive: newTaxFromInc, taxFromExclusive: newTaxFromExc, total: newTotal, commissionTotal: newCommissionTotal } = totals

      // Update order totals + bump version for concurrency control
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: newSubtotal,
          taxTotal: newTaxTotal,
          taxFromInclusive: newTaxFromInc,
          taxFromExclusive: newTaxFromExc,
          total: newTotal,
          commissionTotal: newCommissionTotal,
          itemCount: allItems.reduce((sum, i) => sum + i.quantity, 0),
          ...(existingOrder.isBottleService ? { bottleServiceCurrentSpend: newSubtotal } : {}),
          version: { increment: 1 },
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

      return { updatedOrder, createdItems }
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

    // Fire-and-forget: calculate and store costAtSale for each new item
    void (async () => {
      try {
        for (const item of result.createdItems) {
          const cost = await calculateCostAtSale(item.menuItemId, item.pricingOptionId)
          if (cost !== null) {
            await db.orderItem.update({
              where: { id: item.id },
              data: { costAtSale: cost },
            })
          }
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
        isHeld: item.isHeld || false,
        soldByWeight: item.soldByWeight || false,
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
    dispatchOpenOrdersChanged(result.updatedOrder.locationId, { trigger: 'created', orderId: result.updatedOrder.id, tableId: result.updatedOrder.tableId || undefined }, { async: true }).catch(() => {})
    if (result.updatedOrder.tableId) {
      dispatchFloorPlanUpdate(result.updatedOrder.locationId, { async: true }).catch(() => {})
    }

    // If this is a bar tab, notify phone that items updated
    if (result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.status === 'open') {
      const updatedItemCount = await db.orderItem.count({
        where: { orderId, deletedAt: null, status: 'active' },
      })
      dispatchTabItemsUpdated(result.updatedOrder.locationId, { orderId, itemCount: updatedItemCount })
    }

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

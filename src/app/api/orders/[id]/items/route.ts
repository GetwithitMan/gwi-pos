import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

// Helper to check if a string is a valid CUID (for real modifier IDs)
function isValidModifierId(modId: string) {
  // CUIDs are typically 25 chars starting with 'c', combo IDs start with 'combo-'
  return modId && !modId.startsWith('combo-') && modId.length >= 20
}

type NewItem = {
  menuItemId: string
  name: string
  price: number
  quantity: number
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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { items } = body as { items: NewItem[] }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided' },
        { status: 400 }
      )
    }

    // Debug: Log the incoming items
    console.log('[API /orders/[id]/items] Received items:', JSON.stringify(items, null, 2))

    // Use a transaction to ensure atomic append
    const result = await db.$transaction(async (tx) => {
      // Get existing order with current items
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
        },
      })

      if (!existingOrder) {
        throw new Error('Order not found')
      }

      if (existingOrder.status !== 'open') {
        throw new Error('Cannot modify a closed order')
      }

      // Fetch menu items to get commission settings
      const menuItemIds = items.map(item => item.menuItemId)
      const menuItemsWithCommission = await tx.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: { id: true, commissionType: true, commissionValue: true, itemType: true },
      })
      const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))

      // Create the new items
      const createdItems = []
      let newItemsSubtotal = 0
      let newItemsCommission = 0

      for (const item of items) {
        // Calculate item total
        const itemBaseTotal = item.price * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, mod) => sum + mod.price, 0) * item.quantity
        const ingredientModTotal = (item.ingredientModifications || []).reduce(
          (sum, ing) => sum + (ing.priceAdjustment || 0), 0
        ) * item.quantity
        const fullItemTotal = itemBaseTotal + modifiersTotal + ingredientModTotal
        newItemsSubtotal += fullItemTotal

        // Calculate commission
        const menuItem = menuItemMap.get(item.menuItemId)
        const itemCommission = calculateItemCommission(
          fullItemTotal,
          item.quantity,
          menuItem?.commissionType || null,
          menuItem?.commissionValue ? Number(menuItem.commissionValue) : null
        )
        newItemsCommission += itemCommission

        // Create the order item
        const createdItem = await tx.orderItem.create({
          data: {
            orderId,
            locationId: existingOrder.locationId,
            menuItemId: item.menuItemId,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
            itemTotal: fullItemTotal,
            commissionAmount: itemCommission,
            specialNotes: item.specialNotes || null,
            // Entertainment/timed rental fields
            blockTimeMinutes: item.blockTimeMinutes || null,
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

      const newSubtotal = allItems.reduce((sum, item) => sum + Number(item.itemTotal), 0)
      const newCommissionTotal = allItems.reduce((sum, item) => sum + Number(item.commissionAmount || 0), 0)

      // Get tax rate from location settings
      const settings = existingOrder.location.settings as { tax?: { defaultRate?: number } } | null
      const taxRate = (settings?.tax?.defaultRate || 8) / 100

      const newTaxTotal = Math.round(newSubtotal * taxRate * 100) / 100
      const tipTotal = Number(existingOrder.tipTotal) || 0
      const discountTotal = Number(existingOrder.discountTotal) || 0
      const newTotal = Math.round((newSubtotal + newTaxTotal - discountTotal + tipTotal) * 100) / 100

      // Update order totals
      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: newSubtotal,
          taxTotal: newTaxTotal,
          total: newTotal,
          commissionTotal: newCommissionTotal,
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

      return { updatedOrder, createdItems }
    })

    // Fire-and-forget: check if bar tab or bottle service tab needs auto-increment
    if ((result.updatedOrder.orderType === 'bar_tab' || result.updatedOrder.isBottleService) && result.updatedOrder.preAuthRecordNo) {
      fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/orders/${orderId}/auto-increment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: result.updatedOrder.employeeId }),
      }).catch(err => {
        console.warn('[Auto-Increment] Background check failed:', err)
      })
    }

    // Format response
    return NextResponse.json({
      id: result.updatedOrder.id,
      orderNumber: result.updatedOrder.orderNumber,
      orderType: result.updatedOrder.orderType,
      status: result.updatedOrder.status,
      tabName: result.updatedOrder.tabName,
      guestCount: result.updatedOrder.guestCount,
      employee: {
        id: result.updatedOrder.employee.id,
        name: result.updatedOrder.employee.displayName ||
              `${result.updatedOrder.employee.firstName} ${result.updatedOrder.employee.lastName}`,
      },
      items: result.updatedOrder.items.map(item => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        itemTotal: Number(item.itemTotal),
        specialNotes: item.specialNotes,
        blockTimeMinutes: item.blockTimeMinutes,
        blockTimeStartedAt: item.blockTimeStartedAt?.toISOString() || null,
        blockTimeExpiresAt: item.blockTimeExpiresAt?.toISOString() || null,
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          modifierId: mod.modifierId,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
          depth: mod.depth || 0,
          spiritTier: mod.spiritTier,
          linkedBottleProductId: mod.linkedBottleProductId,
        })),
        ingredientModifications: item.ingredientModifications.map(ing => ({
          id: ing.id,
          ingredientId: ing.ingredientId,
          ingredientName: ing.ingredientName,
          modificationType: ing.modificationType,
          priceAdjustment: Number(ing.priceAdjustment),
          swappedToModifierId: ing.swappedToModifierId,
          swappedToModifierName: ing.swappedToModifierName,
        })),
      })),
      subtotal: Number(result.updatedOrder.subtotal),
      discountTotal: Number(result.updatedOrder.discountTotal),
      taxTotal: Number(result.updatedOrder.taxTotal),
      tipTotal: Number(result.updatedOrder.tipTotal),
      total: Number(result.updatedOrder.total),
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
    const message = error instanceof Error ? error.message : 'Failed to add items to order'
    const status = message === 'Order not found' ? 404 :
                   message === 'Cannot modify a closed order' ? 400 : 500
    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}

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

// GET - Get order details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        table: {
          select: { id: true, name: true },
        },
        items: {
          include: {
            modifiers: true,
            ingredientModifications: true,
            pizzaData: true, // Include pizza configuration
          },
        },
        payments: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      tabName: order.tabName,
      tableId: order.tableId,
      tableName: order.table?.name || null,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      items: order.items.map(item => {
        // Reconstruct pizzaConfig from pizzaData if present
        const pizzaConfig = item.pizzaData ? {
          sizeId: item.pizzaData.sizeId,
          crustId: item.pizzaData.crustId,
          sauceId: item.pizzaData.sauceId,
          cheeseId: item.pizzaData.cheeseId,
          sauceAmount: item.pizzaData.sauceAmount as 'none' | 'light' | 'regular' | 'extra',
          cheeseAmount: item.pizzaData.cheeseAmount as 'none' | 'light' | 'regular' | 'extra',
          // Get arrays from toppingsData JSON
          toppings: (item.pizzaData.toppingsData as { toppings?: unknown[] })?.toppings || [],
          sauces: (item.pizzaData.toppingsData as { sauces?: unknown[] })?.sauces,
          cheeses: (item.pizzaData.toppingsData as { cheeses?: unknown[] })?.cheeses,
          cookingInstructions: item.pizzaData.cookingInstructions,
          cutStyle: item.pizzaData.cutStyle,
          specialNotes: item.specialNotes,
          totalPrice: Number(item.pizzaData.totalPrice),
          priceBreakdown: {
            sizePrice: Number(item.pizzaData.sizePrice),
            crustPrice: Number(item.pizzaData.crustPrice),
            saucePrice: Number(item.pizzaData.saucePrice),
            cheesePrice: Number(item.pizzaData.cheesePrice),
            toppingsPrice: Number(item.pizzaData.toppingsPrice),
          },
        } : undefined

        return {
          id: item.id,
          menuItemId: item.menuItemId,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          specialNotes: item.specialNotes,

          // Item lifecycle status
          seatNumber: item.seatNumber,
          courseNumber: item.courseNumber,
          courseStatus: item.courseStatus,
          isHeld: item.isHeld,
          kitchenStatus: item.kitchenStatus,          // 'pending' | 'cooking' | 'ready' | 'delivered'
          isCompleted: item.isCompleted,              // KDS bumped
          completedAt: item.completedAt?.toISOString() || null,
          resendCount: item.resendCount,              // Number of times resent
          lastResentAt: item.lastResentAt?.toISOString() || null,
          resendNote: item.resendNote,                // Last resend note
          status: item.status,                        // 'active' | 'voided' | 'comped'
          createdAt: item.createdAt.toISOString(),    // When item was added

          // Entertainment/timed rental fields
          blockTimeMinutes: item.blockTimeMinutes,
          blockTimeStartedAt: item.blockTimeStartedAt?.toISOString() || null,
          blockTimeExpiresAt: item.blockTimeExpiresAt?.toISOString() || null,
          // Pizza configuration
          pizzaConfig,
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
        }
      }),
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      notes: order.notes,
      createdAt: order.createdAt.toISOString(),
      paidAmount: order.payments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + Number(p.totalAmount), 0),
    })
  } catch (error) {
    console.error('Failed to fetch order:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    )
  }
}

// PUT - Update order (add items, update quantities, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const {
      items,
      tabName,
      guestCount,
      notes,
      tipTotal,
    } = body as {
      items?: {
        menuItemId: string
        name: string
        price: number
        quantity: number
        modifiers: {
          modifierId: string
          name: string
          price: number
          preModifier?: string
          depth?: number
          // Spirit selection fields (Liquor Builder)
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
      }[]
      tabName?: string
      guestCount?: number
      notes?: string
      tipTotal?: number
    }

    // Get existing order
    const existingOrder = await db.order.findUnique({
      where: { id },
      include: {
        location: true,
        items: true,
      },
    })

    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    if (existingOrder.status !== 'open') {
      return NextResponse.json(
        { error: 'Cannot modify a closed order' },
        { status: 400 }
      )
    }

    // If items are provided, delete existing and re-create
    // This is simpler than trying to diff items
    if (items && items.length > 0) {
      // Get existing items to check for entertainment items being removed
      const existingItems = await db.orderItem.findMany({
        where: { orderId: id },
        select: { menuItemId: true },
      })
      const existingMenuItemIds = new Set(existingItems.map(i => i.menuItemId))
      const newMenuItemIds = new Set(items.map(i => i.menuItemId))

      // Find entertainment items that are being removed
      const removedMenuItemIds = [...existingMenuItemIds].filter(itemId => !newMenuItemIds.has(itemId))

      // Reset entertainment status for removed items
      if (removedMenuItemIds.length > 0) {
        await db.menuItem.updateMany({
          where: {
            id: { in: removedMenuItemIds },
            itemType: 'timed_rental',
            currentOrderId: id,
          },
          data: {
            entertainmentStatus: 'available',
            currentOrderId: null,
            currentOrderItemId: null,
          },
        })
      }

      // Delete existing items and their related records
      await db.orderItemModifier.deleteMany({
        where: {
          orderItem: {
            orderId: id,
          },
        },
      })
      await db.orderItemIngredient.deleteMany({
        where: {
          orderItem: {
            orderId: id,
          },
        },
      })
      await db.orderItem.deleteMany({
        where: { orderId: id },
      })

      // Helper to check if a string is a valid CUID (for real modifier IDs)
      const isValidModifierId = (modId: string) => {
        // CUIDs are typically 25 chars starting with 'c', combo IDs start with 'combo-'
        return modId && !modId.startsWith('combo-') && modId.length >= 20
      }

      // Fetch menu items to get commission settings
      const menuItemIds = items.map(item => item.menuItemId)
      const menuItemsWithCommission = await db.menuItem.findMany({
        where: { id: { in: menuItemIds } },
        select: { id: true, commissionType: true, commissionValue: true },
      })
      const menuItemMap = new Map(menuItemsWithCommission.map(mi => [mi.id, mi]))

      // Calculate new totals
      let subtotal = 0
      let commissionTotal = 0
      const orderItems = items.map(item => {
        const itemTotal = item.price * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, mod) => sum + mod.price, 0) * item.quantity
        const ingredientModTotal = (item.ingredientModifications || []).reduce((sum, ing) => sum + (ing.priceAdjustment || 0), 0) * item.quantity
        const fullItemTotal = itemTotal + modifiersTotal + ingredientModTotal
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

        return {
          locationId: existingOrder.locationId,
          menuItemId: item.menuItemId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          itemTotal: fullItemTotal,
          commissionAmount: itemCommission,
          specialNotes: item.specialNotes || null,
          modifiers: {
            create: item.modifiers.map(mod => ({
              locationId: existingOrder.locationId,
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
        }
      })

      // Get tax rate from location settings
      const settings = existingOrder.location.settings as { tax?: { defaultRate?: number } } | null
      const taxRate = (settings?.tax?.defaultRate || 8) / 100

      const taxTotal = Math.round(subtotal * taxRate * 100) / 100
      const total = Math.round((subtotal + taxTotal) * 100) / 100

      // Update order with new items and totals
      const updatedOrder = await db.order.update({
        where: { id },
        data: {
          tabName: tabName !== undefined ? tabName : undefined,
          guestCount: guestCount !== undefined ? guestCount : undefined,
          notes: notes !== undefined ? notes : undefined,
          subtotal,
          taxTotal,
          total,
          commissionTotal,
          items: {
            create: orderItems,
          },
        },
        include: {
          employee: {
            select: { id: true, displayName: true, firstName: true, lastName: true },
          },
          items: {
            include: {
              modifiers: true,
              ingredientModifications: true,
              menuItem: {
                select: { id: true, itemType: true },
              },
            },
          },
        },
      })

      // Mark entertainment items as in_use
      const entertainmentItems = updatedOrder.items.filter(
        item => item.menuItem?.itemType === 'timed_rental'
      )
      for (const item of entertainmentItems) {
        await db.menuItem.update({
          where: { id: item.menuItemId },
          data: {
            entertainmentStatus: 'in_use',
            currentOrderId: id,
            currentOrderItemId: item.id,
          },
        })
      }

      return NextResponse.json({
        id: updatedOrder.id,
        orderNumber: updatedOrder.orderNumber,
        orderType: updatedOrder.orderType,
        status: updatedOrder.status,
        tabName: updatedOrder.tabName,
        guestCount: updatedOrder.guestCount,
        employee: {
          id: updatedOrder.employee.id,
          name: updatedOrder.employee.displayName || `${updatedOrder.employee.firstName} ${updatedOrder.employee.lastName}`,
        },
        items: updatedOrder.items.map(item => ({
          id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: item.quantity,
          itemTotal: Number(item.itemTotal),
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
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
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        total: Number(updatedOrder.total),
      })
    }

    // If no items, just update metadata
    // Calculate new total if tipTotal is being updated
    let newTotal = undefined
    if (tipTotal !== undefined) {
      const subtotal = Number(existingOrder.subtotal)
      const taxTotal = Number(existingOrder.taxTotal)
      const discountTotal = Number(existingOrder.discountTotal)
      newTotal = Math.round((subtotal + taxTotal - discountTotal + tipTotal) * 100) / 100
    }

    const updatedOrder = await db.order.update({
      where: { id },
      data: {
        tabName: tabName !== undefined ? tabName : undefined,
        guestCount: guestCount !== undefined ? guestCount : undefined,
        notes: notes !== undefined ? notes : undefined,
        tipTotal: tipTotal !== undefined ? tipTotal : undefined,
        total: newTotal !== undefined ? newTotal : undefined,
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            modifiers: true,
            ingredientModifications: true,
          },
        },
      },
    })

    return NextResponse.json({
      id: updatedOrder.id,
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      tabName: updatedOrder.tabName,
      guestCount: updatedOrder.guestCount,
      tipTotal: Number(updatedOrder.tipTotal),
      total: Number(updatedOrder.total),
    })
  } catch (error) {
    console.error('Failed to update order:', error)
    return NextResponse.json(
      { error: 'Failed to update order' },
      { status: 500 }
    )
  }
}

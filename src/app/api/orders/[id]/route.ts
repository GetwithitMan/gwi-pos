import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
        items: {
          include: {
            modifiers: true,
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
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      items: order.items.map(item => ({
        id: item.id,
        menuItemId: item.menuItemId,
        name: item.name,
        price: Number(item.price),
        quantity: item.quantity,
        itemTotal: Number(item.itemTotal),
        specialNotes: item.specialNotes,
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          modifierId: mod.modifierId,
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
        }[]
        specialNotes?: string
      }[]
      tabName?: string
      guestCount?: number
      notes?: string
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
      // Delete existing items
      await db.orderItemModifier.deleteMany({
        where: {
          orderItem: {
            orderId: id,
          },
        },
      })
      await db.orderItem.deleteMany({
        where: { orderId: id },
      })

      // Calculate new totals
      let subtotal = 0
      const orderItems = items.map(item => {
        const itemTotal = item.price * item.quantity
        const modifiersTotal = item.modifiers.reduce((sum, mod) => sum + mod.price, 0) * item.quantity
        subtotal += itemTotal + modifiersTotal

        return {
          menuItemId: item.menuItemId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          itemTotal: itemTotal + modifiersTotal,
          specialNotes: item.specialNotes || null,
          modifiers: {
            create: item.modifiers.map(mod => ({
              modifierId: mod.modifierId,
              name: mod.name,
              price: mod.price,
              quantity: 1,
              preModifier: mod.preModifier || null,
            })),
          },
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
            },
          },
        },
      })

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
        })),
        subtotal: Number(updatedOrder.subtotal),
        taxTotal: Number(updatedOrder.taxTotal),
        total: Number(updatedOrder.total),
      })
    }

    // If no items, just update metadata
    const updatedOrder = await db.order.update({
      where: { id },
      data: {
        tabName: tabName !== undefined ? tabName : undefined,
        guestCount: guestCount !== undefined ? guestCount : undefined,
        notes: notes !== undefined ? notes : undefined,
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        items: {
          include: {
            modifiers: true,
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
    })
  } catch (error) {
    console.error('Failed to update order:', error)
    return NextResponse.json(
      { error: 'Failed to update order' },
      { status: 500 }
    )
  }
}

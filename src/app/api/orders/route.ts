import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Create a new order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      employeeId,
      locationId,
      orderType,
      tableId,
      tabName,
      guestCount,
      items,
      notes,
    } = body as {
      employeeId: string
      locationId: string
      orderType: 'dine_in' | 'takeout' | 'delivery' | 'bar_tab'
      tableId?: string
      tabName?: string
      guestCount?: number
      items: {
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
        seatNumber?: number
        courseNumber?: number
      }[]
      notes?: string
    }

    if (!employeeId || !locationId) {
      return NextResponse.json(
        { error: 'Employee ID and Location ID are required' },
        { status: 400 }
      )
    }

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Order must have at least one item' },
        { status: 400 }
      )
    }

    // Get next order number for today
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const lastOrder = await db.order.findFirst({
      where: {
        locationId,
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
      },
      orderBy: { orderNumber: 'desc' },
    })

    const orderNumber = (lastOrder?.orderNumber || 0) + 1

    // Calculate totals
    let subtotal = 0
    let commissionTotal = 0

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
        seatNumber: item.seatNumber || null,
        courseNumber: item.courseNumber || null,
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

    // Get tax rate from location settings (default 8%)
    const location = await db.location.findUnique({
      where: { id: locationId },
    })
    const settings = location?.settings as { tax?: { defaultRate?: number } } | null
    const taxRate = (settings?.tax?.defaultRate || 8) / 100

    const taxTotal = Math.round(subtotal * taxRate * 100) / 100
    const total = Math.round((subtotal + taxTotal) * 100) / 100

    // Create the order
    const order = await db.order.create({
      data: {
        locationId,
        employeeId,
        orderNumber,
        orderType,
        tableId: tableId || null,
        tabName: tabName || null,
        guestCount: guestCount || 1,
        status: 'open',
        subtotal,
        discountTotal: 0,
        taxTotal,
        tipTotal: 0,
        total,
        commissionTotal,
        notes: notes || null,
        items: {
          create: orderItems,
        },
      },
      include: {
        items: {
          include: {
            modifiers: true,
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
      },
    })

    return NextResponse.json({
      id: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      tabName: order.tabName,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      items: order.items.map(item => ({
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
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      createdAt: order.createdAt.toISOString(),
    })
  } catch (error) {
    console.error('Failed to create order:', error)
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    )
  }
}

// GET - List orders (for order history, kitchen display, etc.)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const status = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const limit = parseInt(searchParams.get('limit') || '50')

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
        items: {
          include: {
            modifiers: true,
          },
        },
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        status: order.status,
        tabName: order.tabName,
        guestCount: order.guestCount,
        employee: {
          id: order.employee.id,
          name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
        },
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Number(order.subtotal),
        total: Number(order.total),
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
        createdAt: order.createdAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}

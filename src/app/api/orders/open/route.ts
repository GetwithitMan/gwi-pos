import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - List all open orders (any type)
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')
    const orderType = searchParams.get('orderType') // optional filter

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    const orders = await db.order.findMany({
      where: {
        locationId,
        status: 'open',
        ...(employeeId ? { employeeId } : {}),
        ...(orderType ? { orderType } : {}),
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
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      orders: orders.map(order => ({
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tabName: order.tabName,
        tableId: order.tableId,
        guestCount: order.guestCount,
        status: order.status,
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
          isCompleted: item.isCompleted,
          completedAt: item.completedAt?.toISOString() || null,
          resendCount: item.resendCount,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            modifierId: mod.modifierId,
            name: mod.name,
            price: Number(mod.price),
            preModifier: mod.preModifier,
          })),
        })),
        itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        total: Number(order.total),
        // Pre-auth info (for bar tabs)
        hasPreAuth: !!order.preAuthId,
        preAuth: order.preAuthId ? {
          cardBrand: order.preAuthCardBrand,
          last4: order.preAuthLast4,
          amount: order.preAuthAmount ? Number(order.preAuthAmount) : null,
          expiresAt: order.preAuthExpiresAt?.toISOString(),
        } : null,
        createdAt: order.createdAt.toISOString(),
        openedAt: order.openedAt.toISOString(),
        // Payment status
        paidAmount: order.payments
          .filter(p => p.status === 'completed')
          .reduce((sum, p) => sum + Number(p.totalAmount), 0),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch open orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch open orders' },
      { status: 500 }
    )
  }
}

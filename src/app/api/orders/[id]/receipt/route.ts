import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET - Get receipt data for an order
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    const order = await db.order.findUnique({
      where: { id },
      include: {
        employee: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            settings: true,
          },
        },
        table: {
          select: {
            id: true,
            name: true,
          },
        },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            loyaltyPoints: true,
          },
        },
        items: {
          include: {
            modifiers: true,
          },
        },
        payments: {
          where: {
            status: 'completed',
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify location access if locationId provided
    if (locationId && order.locationId !== locationId) {
      return NextResponse.json(
        { error: 'Order does not belong to this location' },
        { status: 403 }
      )
    }

    // Format receipt data
    const receiptData = {
      id: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      orderType: order.orderType,
      tabName: order.tabName,
      tableName: order.table?.name || null,
      guestCount: order.guestCount,
      employee: {
        id: order.employee.id,
        name: order.employee.displayName || `${order.employee.firstName} ${order.employee.lastName}`,
      },
      location: {
        name: order.location.name,
        address: order.location.address,
        phone: order.location.phone,
      },
      items: order.items.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: Number(item.price),
        itemTotal: Number(item.itemTotal),
        specialNotes: item.specialNotes,
        status: item.status,
        modifiers: item.modifiers.map(mod => ({
          id: mod.id,
          name: mod.name,
          price: Number(mod.price),
          preModifier: mod.preModifier,
        })),
      })),
      payments: order.payments.map(payment => ({
        method: payment.paymentMethod,
        amount: Number(payment.amount),
        tipAmount: Number(payment.tipAmount),
        totalAmount: Number(payment.totalAmount),
        cardBrand: payment.cardBrand,
        cardLast4: payment.cardLast4,
        authCode: payment.authCode,
        amountTendered: payment.amountTendered ? Number(payment.amountTendered) : null,
        changeGiven: payment.changeGiven ? Number(payment.changeGiven) : null,
      })),
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      tipTotal: Number(order.tipTotal),
      total: Number(order.total),
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() || null,
      // Loyalty data
      customer: order.customer ? {
        name: order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`,
        loyaltyPoints: order.customer.loyaltyPoints,
      } : null,
      // Points earned/redeemed are calculated from payments
      // Points redeemed from loyalty_points payments
      loyaltyPointsRedeemed: order.payments
        .filter(p => p.paymentMethod === 'loyalty_points')
        .reduce((sum, p) => {
          // Extract points from transactionId like "LOYALTY:100pts"
          const match = p.transactionId?.match(/LOYALTY:(\d+)pts/)
          return sum + (match ? parseInt(match[1]) : 0)
        }, 0) || null,
      // Loyalty points earned requires Customer loyalty system implementation
      // Would calculate based on order total and loyalty program rules
      loyaltyPointsEarned: order.customer?.loyaltyPoints ? Math.floor(Number(order.total)) : null,
    }

    return NextResponse.json({ data: receiptData })
  } catch (error) {
    console.error('Failed to fetch receipt:', error)
    return NextResponse.json(
      { error: 'Failed to fetch receipt' },
      { status: 500 }
    )
  }
})

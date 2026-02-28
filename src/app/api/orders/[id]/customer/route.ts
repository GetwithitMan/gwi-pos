import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { dispatchOrderUpdated } from '@/lib/socket-dispatch'
import { emitOrderEvent } from '@/lib/order-events/emitter'

// PUT - Link or unlink customer to/from order
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params
    const body = await request.json()
    const { customerId } = body as { customerId: string | null }

    // Get the order
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { location: true },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify customer exists if linking
    let customer = null
    if (customerId) {
      customer = await db.customer.findUnique({
        where: { id: customerId },
      })

      if (!customer) {
        return NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        )
      }

      // Ensure customer belongs to same location
      if (customer.locationId !== order.locationId) {
        return NextResponse.json(
          { error: 'Customer does not belong to this location' },
          { status: 400 }
        )
      }
    }

    // Update order with customer
    await db.order.update({
      where: { id: orderId },
      data: { customerId: customerId || null },
    })

    // Fire-and-forget event emission
    void emitOrderEvent(order.locationId, orderId, 'ORDER_METADATA_UPDATED', {
      customerId: customerId || null,
    }).catch(console.error)

    // Fire-and-forget socket dispatch for cross-terminal sync
    void dispatchOrderUpdated(order.locationId, {
      orderId,
      changes: ['customer'],
    }).catch(() => {})

    // Get loyalty settings
    const settings = parseSettings(order.location.settings)

    const customerTags = customer ? ((customer.tags ?? []) as string[]) : []

    return NextResponse.json({ data: {
      success: true,
      customerId: customerId || null,
      customer: customer ? {
        id: customer.id,
        name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
        firstName: customer.firstName,
        lastName: customer.lastName,
        loyaltyPoints: customer.loyaltyPoints,
        totalSpent: Number(customer.totalSpent),
        totalOrders: customer.totalOrders,
        tags: customerTags,
        isBanned: customerTags.includes('banned'),
        notes: customer.notes,
      } : null,
      loyaltyEnabled: settings.loyalty.enabled,
      loyaltySettings: settings.loyalty.enabled ? {
        pointsPerDollar: settings.loyalty.pointsPerDollar,
        redemptionEnabled: settings.loyalty.redemptionEnabled,
        pointsPerDollarRedemption: settings.loyalty.pointsPerDollarRedemption,
        minimumRedemptionPoints: settings.loyalty.minimumRedemptionPoints,
        maximumRedemptionPercent: settings.loyalty.maximumRedemptionPercent,
      } : null,
    } })
  } catch (error) {
    console.error('Failed to link customer:', error)
    return NextResponse.json(
      { error: 'Failed to link customer' },
      { status: 500 }
    )
  }
})

// GET - Get customer linked to order with loyalty info
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: orderId } = await params

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        location: true,
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    const settings = parseSettings(order.location.settings)

    const orderCustomerTags = order.customer ? ((order.customer.tags ?? []) as string[]) : []

    return NextResponse.json({ data: {
      customerId: order.customerId,
      customer: order.customer ? {
        id: order.customer.id,
        name: order.customer.displayName || `${order.customer.firstName} ${order.customer.lastName}`,
        firstName: order.customer.firstName,
        lastName: order.customer.lastName,
        loyaltyPoints: order.customer.loyaltyPoints,
        totalSpent: Number(order.customer.totalSpent),
        totalOrders: order.customer.totalOrders,
        tags: orderCustomerTags,
        isBanned: orderCustomerTags.includes('banned'),
        notes: order.customer.notes,
      } : null,
      loyaltyEnabled: settings.loyalty.enabled,
      loyaltySettings: settings.loyalty.enabled ? {
        pointsPerDollar: settings.loyalty.pointsPerDollar,
        redemptionEnabled: settings.loyalty.redemptionEnabled,
        pointsPerDollarRedemption: settings.loyalty.pointsPerDollarRedemption,
        minimumRedemptionPoints: settings.loyalty.minimumRedemptionPoints,
        maximumRedemptionPercent: settings.loyalty.maximumRedemptionPercent,
      } : null,
    } })
  } catch (error) {
    console.error('Failed to get customer:', error)
    return NextResponse.json(
      { error: 'Failed to get customer' },
      { status: 500 }
    )
  }
})

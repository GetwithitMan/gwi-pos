import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { getLocationId } from '@/lib/location-cache'

// GET - Get customer details with order history
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const customer = await db.customer.findFirst({
      where: { id, locationId },
      include: {
        orders: {
          where: { status: { in: ['completed', 'paid'] } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            orderNumber: true,
            orderType: true,
            subtotal: true,
            total: true,
            status: true,
            createdAt: true,
            items: {
              select: {
                name: true,
                quantity: true,
                itemTotal: true,
              },
            },
          },
        },
      },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Get favorite items (most ordered)
    const favoriteItems = await db.orderItem.groupBy({
      by: ['menuItemId', 'name'],
      where: {
        locationId,
        order: {
          customerId: id,
          status: { in: ['completed', 'paid'] },
        },
      },
      _count: { menuItemId: true },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    })

    return NextResponse.json({
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      displayName: customer.displayName,
      name: customer.displayName || `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
      tags: customer.tags,
      loyaltyPoints: customer.loyaltyPoints,
      totalSpent: Number(customer.totalSpent),
      totalOrders: customer.totalOrders,
      averageTicket: Number(customer.averageTicket),
      lastVisit: customer.lastVisit?.toISOString() || null,
      marketingOptIn: customer.marketingOptIn,
      birthday: customer.birthday?.toISOString() || null,
      createdAt: customer.createdAt.toISOString(),
      recentOrders: customer.orders.map(o => ({
        id: o.id,
        orderNumber: o.orderNumber,
        orderType: o.orderType,
        subtotal: Number(o.subtotal),
        total: Number(o.total),
        status: o.status,
        itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
        createdAt: o.createdAt.toISOString(),
      })),
      favoriteItems: favoriteItems.map(f => ({
        menuItemId: f.menuItemId,
        name: f.name,
        orderCount: f._count.menuItemId,
        totalQuantity: f._sum.quantity || 0,
      })),
    })
  } catch (error) {
    console.error('Failed to fetch customer:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customer' },
      { status: 500 }
    )
  }
})

// PUT - Update customer
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const locationId = body.locationId || request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const customer = await db.customer.findFirst({
      where: { id, locationId },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    const {
      firstName,
      lastName,
      displayName,
      email,
      phone,
      notes,
      tags,
      marketingOptIn,
      birthday,
      loyaltyPoints,
    } = body

    // Check for duplicate email if changing
    if (email && email !== customer.email) {
      const existingEmail = await db.customer.findFirst({
        where: {
          locationId: customer.locationId,
          email,
          isActive: true,
          id: { not: id },
        },
      })
      if (existingEmail) {
        return NextResponse.json(
          { error: 'A customer with this email already exists' },
          { status: 409 }
        )
      }
    }

    // Check for duplicate phone if changing
    if (phone && phone !== customer.phone) {
      const existingPhone = await db.customer.findFirst({
        where: {
          locationId: customer.locationId,
          phone,
          isActive: true,
          id: { not: id },
        },
      })
      if (existingPhone) {
        return NextResponse.json(
          { error: 'A customer with this phone number already exists' },
          { status: 409 }
        )
      }
    }

    const updated = await db.customer.update({
      where: { id, locationId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(displayName !== undefined && { displayName: displayName || null }),
        ...(email !== undefined && { email: email || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(tags !== undefined && { tags }),
        ...(marketingOptIn !== undefined && { marketingOptIn }),
        ...(birthday !== undefined && { birthday: birthday ? new Date(birthday) : null }),
        ...(loyaltyPoints !== undefined && { loyaltyPoints }),
      },
    })

    return NextResponse.json({
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      displayName: updated.displayName,
      name: updated.displayName || `${updated.firstName} ${updated.lastName}`,
      email: updated.email,
      phone: updated.phone,
      notes: updated.notes,
      tags: updated.tags,
      loyaltyPoints: updated.loyaltyPoints,
      totalSpent: Number(updated.totalSpent),
      totalOrders: updated.totalOrders,
      averageTicket: Number(updated.averageTicket),
      lastVisit: updated.lastVisit?.toISOString() || null,
      marketingOptIn: updated.marketingOptIn,
      birthday: updated.birthday?.toISOString() || null,
    })
  } catch (error) {
    console.error('Failed to update customer:', error)
    return NextResponse.json(
      { error: 'Failed to update customer' },
      { status: 500 }
    )
  }
})

// DELETE - Soft delete customer
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = request.nextUrl.searchParams.get('locationId') || await getLocationId()
    if (!locationId) {
      return NextResponse.json({ error: 'No location found' }, { status: 400 })
    }

    const customer = await db.customer.findFirst({
      where: { id, locationId },
    })

    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }

    // Soft delete
    await db.customer.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete customer:', error)
    return NextResponse.json(
      { error: 'Failed to delete customer' },
      { status: 500 }
    )
  }
})

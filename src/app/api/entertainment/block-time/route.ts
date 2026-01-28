import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST - Start block time for an order item
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, minutes } = body

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!minutes || minutes < 1) {
      return NextResponse.json(
        { error: 'Minutes must be a positive number' },
        { status: 400 }
      )
    }

    // Get the order item and verify it's an entertainment item
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
          select: {
            id: true,
            name: true,
            itemType: true,
            blockTimeMinutes: true,
          },
        },
        order: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    if (orderItem.menuItem.itemType !== 'timed_rental') {
      return NextResponse.json(
        { error: 'This item is not an entertainment rental' },
        { status: 400 }
      )
    }

    if (orderItem.order.status === 'paid' || orderItem.order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify a paid or closed order' },
        { status: 400 }
      )
    }

    // Calculate expiration time
    const now = new Date()
    const expiresAt = new Date(now.getTime() + minutes * 60 * 1000)

    // Update the order item with block time info
    const updatedItem = await db.orderItem.update({
      where: { id: orderItemId },
      data: {
        blockTimeMinutes: minutes,
        blockTimeStartedAt: now,
        blockTimeExpiresAt: expiresAt,
      },
      select: {
        id: true,
        name: true,
        blockTimeMinutes: true,
        blockTimeStartedAt: true,
        blockTimeExpiresAt: true,
        menuItemId: true,
      },
    })

    // Update the menu item status to in_use
    await db.menuItem.update({
      where: { id: orderItem.menuItemId },
      data: {
        entertainmentStatus: 'in_use',
        currentOrderId: orderItem.orderId,
        currentOrderItemId: orderItemId,
      },
    })

    return NextResponse.json({
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      message: `Started ${minutes} minute block time, expires at ${expiresAt.toLocaleTimeString()}`,
    })
  } catch (error) {
    console.error('Failed to start block time:', error)
    return NextResponse.json(
      { error: 'Failed to start block time' },
      { status: 500 }
    )
  }
}

// PATCH - Extend block time
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderItemId, additionalMinutes } = body

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    if (!additionalMinutes || additionalMinutes < 1) {
      return NextResponse.json(
        { error: 'Additional minutes must be a positive number' },
        { status: 400 }
      )
    }

    // Get the order item
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        order: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    if (orderItem.order.status === 'paid' || orderItem.order.status === 'closed') {
      return NextResponse.json(
        { error: 'Cannot modify a paid or closed order' },
        { status: 400 }
      )
    }

    if (!orderItem.blockTimeExpiresAt) {
      return NextResponse.json(
        { error: 'This item does not have active block time' },
        { status: 400 }
      )
    }

    // Calculate new expiration
    const currentExpires = new Date(orderItem.blockTimeExpiresAt)
    const now = new Date()

    // If already expired, extend from now; otherwise extend from current expiration
    const baseTime = currentExpires > now ? currentExpires : now
    const newExpiresAt = new Date(baseTime.getTime() + additionalMinutes * 60 * 1000)
    const newTotalMinutes = (orderItem.blockTimeMinutes || 0) + additionalMinutes

    // Update the order item
    const updatedItem = await db.orderItem.update({
      where: { id: orderItemId },
      data: {
        blockTimeMinutes: newTotalMinutes,
        blockTimeExpiresAt: newExpiresAt,
      },
      select: {
        id: true,
        name: true,
        blockTimeMinutes: true,
        blockTimeStartedAt: true,
        blockTimeExpiresAt: true,
      },
    })

    return NextResponse.json({
      orderItem: {
        id: updatedItem.id,
        name: updatedItem.name,
        blockTimeMinutes: updatedItem.blockTimeMinutes,
        startedAt: updatedItem.blockTimeStartedAt?.toISOString(),
        expiresAt: updatedItem.blockTimeExpiresAt?.toISOString(),
      },
      message: `Extended by ${additionalMinutes} minutes, new expiration at ${newExpiresAt.toLocaleTimeString()}`,
    })
  } catch (error) {
    console.error('Failed to extend block time:', error)
    return NextResponse.json(
      { error: 'Failed to extend block time' },
      { status: 500 }
    )
  }
}

// DELETE - Stop block time early
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const orderItemId = searchParams.get('orderItemId')

    if (!orderItemId) {
      return NextResponse.json(
        { error: 'Order item ID is required' },
        { status: 400 }
      )
    }

    // Get the order item
    const orderItem = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: {
        menuItem: {
          select: {
            id: true,
          },
        },
      },
    })

    if (!orderItem) {
      return NextResponse.json(
        { error: 'Order item not found' },
        { status: 404 }
      )
    }

    // Calculate actual minutes used
    const startedAt = orderItem.blockTimeStartedAt
    const now = new Date()
    let actualMinutes = 0

    if (startedAt) {
      actualMinutes = Math.ceil((now.getTime() - startedAt.getTime()) / 1000 / 60)
    }

    // Update the order item - set expiration to now
    await db.orderItem.update({
      where: { id: orderItemId },
      data: {
        blockTimeExpiresAt: now,
      },
    })

    // Reset the menu item status
    await db.menuItem.update({
      where: { id: orderItem.menuItemId },
      data: {
        entertainmentStatus: 'available',
        currentOrderId: null,
        currentOrderItemId: null,
      },
    })

    return NextResponse.json({
      success: true,
      actualMinutesUsed: actualMinutes,
      message: `Stopped block time. ${actualMinutes} minutes used.`,
    })
  } catch (error) {
    console.error('Failed to stop block time:', error)
    return NextResponse.json(
      { error: 'Failed to stop block time' },
      { status: 500 }
    )
  }
}

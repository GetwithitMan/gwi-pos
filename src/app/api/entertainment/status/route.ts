import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get all entertainment items with their status
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get all entertainment items (timed_rental type)
    const entertainmentItems = await db.menuItem.findMany({
      where: {
        locationId,
        itemType: 'timed_rental',
        isActive: true,
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
        entertainmentWaitlist: {
          where: { status: 'waiting' },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [
        { category: { sortOrder: 'asc' } },
        { sortOrder: 'asc' },
      ],
    })

    // For items that are in use, get the linked order info
    const itemsWithOrders = await Promise.all(
      entertainmentItems.map(async (item) => {
        let currentOrder = null
        let timeInfo = null

        if (item.entertainmentStatus === 'in_use' && item.currentOrderId) {
          const order = await db.order.findUnique({
            where: { id: item.currentOrderId },
            select: {
              id: true,
              tabName: true,
              orderNumber: true,
              displayNumber: true,
              openedAt: true,
              items: {
                where: { menuItemId: item.id },
                select: {
                  id: true,
                  blockTimeMinutes: true,
                  blockTimeStartedAt: true,
                  blockTimeExpiresAt: true,
                  createdAt: true,
                },
                take: 1,
              },
            },
          })

          if (order) {
            const orderItem = order.items[0]
            const now = new Date()

            currentOrder = {
              orderId: order.id,
              tabName: order.tabName || `Order #${order.displayNumber || order.orderNumber}`,
              orderNumber: order.orderNumber,
              displayNumber: order.displayNumber,
            }

            // Calculate time info
            if (orderItem?.blockTimeMinutes && orderItem.blockTimeExpiresAt) {
              // Block time - calculate remaining
              const expiresAt = new Date(orderItem.blockTimeExpiresAt)
              const remaining = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000 / 60))

              timeInfo = {
                type: 'block',
                blockMinutes: orderItem.blockTimeMinutes,
                startedAt: orderItem.blockTimeStartedAt?.toISOString(),
                expiresAt: orderItem.blockTimeExpiresAt.toISOString(),
                minutesRemaining: remaining,
                isExpired: remaining <= 0,
                isExpiringSoon: remaining > 0 && remaining <= 10,
              }
            } else {
              // Per-minute billing - calculate elapsed
              const startedAt = orderItem?.createdAt || order.openedAt
              const elapsed = Math.floor((now.getTime() - startedAt.getTime()) / 1000 / 60)

              timeInfo = {
                type: 'per_minute',
                startedAt: startedAt.toISOString(),
                minutesElapsed: elapsed,
              }
            }
          }
        }

        // Parse timed pricing
        let timedPricing = null
        if (item.timedPricing) {
          try {
            timedPricing = typeof item.timedPricing === 'string'
              ? JSON.parse(item.timedPricing)
              : item.timedPricing
          } catch {
            timedPricing = null
          }
        }

        return {
          id: item.id,
          name: item.name,
          displayName: item.displayName || item.name,
          description: item.description,
          category: item.category,
          status: item.entertainmentStatus || 'available',
          currentOrder,
          timeInfo,
          waitlistCount: item.entertainmentWaitlist.length,
          waitlist: item.entertainmentWaitlist.map((w, index) => ({
            id: w.id,
            customerName: w.customerName,
            phoneNumber: w.phoneNumber,
            partySize: w.partySize,
            position: index + 1,
            status: w.status,
            notes: w.notes,
            menuItemId: item.id,
            // Tab info
            tabId: w.tabId,
            tabName: w.tabName,
            // Deposit info
            depositAmount: w.depositAmount ? Number(w.depositAmount) : null,
            depositMethod: w.depositMethod,
            depositCardLast4: w.depositCardLast4,
            depositRefunded: w.depositRefunded,
            createdAt: w.createdAt.toISOString(),
            waitMinutes: Math.floor((new Date().getTime() - w.createdAt.getTime()) / 1000 / 60),
          })),
          // Pricing info
          price: Number(item.price),
          timedPricing,
          blockTimeMinutes: item.blockTimeMinutes,
          minimumMinutes: item.minimumMinutes,
          // Capacity
          maxConcurrentUses: item.maxConcurrentUses || 1,
          currentUseCount: item.currentUseCount || 0,
        }
      })
    )

    return NextResponse.json({
      items: itemsWithOrders,
      summary: {
        total: itemsWithOrders.length,
        available: itemsWithOrders.filter(i => i.status === 'available').length,
        inUse: itemsWithOrders.filter(i => i.status === 'in_use').length,
        maintenance: itemsWithOrders.filter(i => i.status === 'maintenance').length,
        totalWaitlist: itemsWithOrders.reduce((sum, i) => sum + i.waitlistCount, 0),
      },
    })
  } catch (error) {
    console.error('Failed to fetch entertainment status:', error)
    return NextResponse.json(
      { error: 'Failed to fetch entertainment status' },
      { status: 500 }
    )
  }
}

// PATCH - Update entertainment item status
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { menuItemId, status, currentOrderId, currentOrderItemId } = body

    if (!menuItemId) {
      return NextResponse.json(
        { error: 'Menu item ID is required' },
        { status: 400 }
      )
    }

    const validStatuses = ['available', 'in_use', 'maintenance']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const updateData: {
      entertainmentStatus?: string
      currentOrderId?: string | null
      currentOrderItemId?: string | null
    } = {}

    if (status) {
      updateData.entertainmentStatus = status
    }

    if (status === 'available') {
      updateData.currentOrderId = null
      updateData.currentOrderItemId = null
    } else if (currentOrderId !== undefined) {
      updateData.currentOrderId = currentOrderId
    }

    if (currentOrderItemId !== undefined) {
      updateData.currentOrderItemId = currentOrderItemId
    }

    const updatedItem = await db.menuItem.update({
      where: { id: menuItemId },
      data: updateData,
      select: {
        id: true,
        name: true,
        entertainmentStatus: true,
        currentOrderId: true,
        currentOrderItemId: true,
      },
    })

    return NextResponse.json({ item: updatedItem })
  } catch (error) {
    console.error('Failed to update entertainment status:', error)
    return NextResponse.json(
      { error: 'Failed to update entertainment status' },
      { status: 500 }
    )
  }
}

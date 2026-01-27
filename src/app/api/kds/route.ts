import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET - Get orders for KDS display
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const locationId = searchParams.get('locationId')
    const stationId = searchParams.get('stationId')
    const showAll = searchParams.get('showAll') === 'true' // Expo mode

    if (!locationId) {
      return NextResponse.json(
        { error: 'Location ID is required' },
        { status: 400 }
      )
    }

    // Get the station info if specified
    let station = null
    if (stationId) {
      station = await db.prepStation.findUnique({
        where: { id: stationId },
        include: {
          categories: { select: { id: true } },
          menuItems: { select: { id: true } },
        },
      })
    }

    // Get open orders that have been sent to kitchen
    const orders = await db.order.findMany({
      where: {
        locationId,
        status: { in: ['open', 'in_progress'] },
        // Only orders with items (sent to kitchen)
        items: { some: {} },
      },
      include: {
        employee: {
          select: {
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        table: {
          select: {
            name: true,
          },
        },
        items: {
          include: {
            menuItem: {
              select: {
                id: true,
                name: true,
                categoryId: true,
                prepStationId: true,
                category: {
                  select: {
                    id: true,
                    name: true,
                    prepStationId: true,
                  },
                },
              },
            },
            modifiers: {
              select: {
                id: true,
                name: true,
                preModifier: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    // Filter and format orders for KDS
    const kdsOrders = orders.map(order => {
      // Filter items for this station
      let filteredItems = order.items

      if (station && !station.showAllItems) {
        // Get station's assigned category and item IDs
        const stationCategoryIds = station.categories.map(c => c.id)
        const stationItemIds = station.menuItems.map(i => i.id)

        filteredItems = order.items.filter(item => {
          // Check if item has direct station override
          if (item.menuItem.prepStationId) {
            return item.menuItem.prepStationId === stationId
          }
          // Check if item's category is assigned to this station
          if (item.menuItem.category?.prepStationId) {
            return item.menuItem.category.prepStationId === stationId
          }
          // Check if category is in station's assigned categories
          if (stationCategoryIds.includes(item.menuItem.categoryId)) {
            return true
          }
          // Check if item is specifically assigned
          if (stationItemIds.includes(item.menuItemId)) {
            return true
          }
          return false
        })
      }

      // Skip orders with no items for this station
      if (filteredItems.length === 0) {
        return null
      }

      // Calculate time since order was created
      const createdAt = new Date(order.createdAt)
      const now = new Date()
      const elapsedMs = now.getTime() - createdAt.getTime()
      const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60))

      // Determine status color based on elapsed time
      let timeStatus: 'fresh' | 'aging' | 'late' = 'fresh'
      if (elapsedMinutes >= 15) {
        timeStatus = 'late'
      } else if (elapsedMinutes >= 8) {
        timeStatus = 'aging'
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        orderType: order.orderType,
        tableName: order.table?.name || null,
        tabName: order.tabName,
        employeeName: order.employee?.displayName ||
          `${order.employee?.firstName || ''} ${order.employee?.lastName || ''}`.trim(),
        createdAt: order.createdAt.toISOString(),
        elapsedMinutes,
        timeStatus,
        notes: order.notes,
        items: filteredItems.map(item => ({
          id: item.id,
          name: item.menuItem.name,
          quantity: item.quantity,
          categoryName: item.menuItem.category?.name,
          specialNotes: item.specialNotes,
          isCompleted: item.isCompleted || false,
          completedAt: item.completedAt?.toISOString() || null,
          resendCount: item.resendCount || 0,
          lastResentAt: item.lastResentAt?.toISOString() || null,
          modifiers: item.modifiers.map(mod => ({
            id: mod.id,
            name: mod.preModifier
              ? `${mod.preModifier.charAt(0).toUpperCase() + mod.preModifier.slice(1)} ${mod.name}`
              : mod.name,
          })),
        })),
      }
    }).filter(Boolean)

    return NextResponse.json({
      orders: kdsOrders,
      station: station ? {
        id: station.id,
        name: station.name,
        displayName: station.displayName,
        color: station.color,
        stationType: station.stationType,
        showAllItems: station.showAllItems,
      } : null,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to fetch KDS orders:', error)
    return NextResponse.json(
      { error: 'Failed to fetch KDS orders' },
      { status: 500 }
    )
  }
}

// PUT - Mark item(s) as complete (bump) or resend
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemIds, action } = body as {
      itemIds: string[]
      action: 'complete' | 'uncomplete' | 'bump_order' | 'resend'
    }

    if (!itemIds || itemIds.length === 0) {
      return NextResponse.json(
        { error: 'Item IDs are required' },
        { status: 400 }
      )
    }

    const now = new Date()

    if (action === 'complete') {
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: true,
          completedAt: now,
        },
      })
    } else if (action === 'uncomplete') {
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: false,
          completedAt: null,
        },
      })
    } else if (action === 'bump_order') {
      // Complete all items in the order
      await db.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          isCompleted: true,
          completedAt: now,
        },
      })
    } else if (action === 'resend') {
      // Resend items to kitchen - increment count and reset completion
      for (const itemId of itemIds) {
        await db.orderItem.update({
          where: { id: itemId },
          data: {
            resendCount: { increment: 1 },
            lastResentAt: now,
            isCompleted: false,
            completedAt: null,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      itemIds,
      action,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('Failed to update KDS items:', error)
    return NextResponse.json(
      { error: 'Failed to update items' },
      { status: 500 }
    )
  }
}
